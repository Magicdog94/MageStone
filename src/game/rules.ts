// Turn flow, dice, movement, combat, and actions. Pure functions: each takes a
// state and returns a new state. The engine is the single source of truth; the
// 3D layer only renders it.

import {
  cellExists,
  edgeRotation,
  inNexus,
  sameCell,
  rotateCell,
  PLAYER_ROTATION,
  NEXUS_CELLS,
} from './board';
import type {
  Cell,
  CombatResult,
  Die,
  DieKind,
  GameState,
  PlayerColor,
  Unit,
} from './types';

type RNG = () => number;
const defaultRng: RNG = () => Math.random();

let dieCounter = 0;
let graveCounter = 0;
function dN(n: number, rng: RNG): number {
  return 1 + Math.floor(rng() * n);
}

/** Mage combat power tier from activated MageStones (page 5). */
export function magePowerDie(activated: number): 6 | 12 | 20 {
  if (activated >= 4) return 20;
  if (activated >= 2) return 12;
  return 6;
}

export const MAX_WARRIORS = 6;
export const STONES_TO_WIN = 6;

// ---- Lookups -------------------------------------------------------------

export function unitAt(state: GameState, cell: Cell): Unit | undefined {
  return state.units.find((u) => sameCell(u.cell, cell));
}

export function unitById(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

/** MageStone tokens lying loose on `cell` (carried stones are not on the board). */
export function stonesAt(state: GameState, cell: Cell) {
  return state.stones.filter((s) => !s.carrier && sameCell(s.cell, cell));
}

// ---- MageStone tokens ----------------------------------------------------
// Activation lives on the TOKEN, so it follows the stone through every hand it
// passes: carried, dropped on death, spent on Bolt or Nova, and stolen. The
// only permitted transition is false -> true; nothing here ever writes false
// over a true. `Unit.carried`/`Unit.activated` are derived mirrors of these
// tokens — `syncStones` is their single writer.

/** Every token a unit is holding (board stones excluded). */
export function carriedStones(state: GameState, unitId: string) {
  return state.stones.filter((s) => s.carrier === unitId);
}

/**
 * Recompute every unit's `carried`/`activated` mirror from the token list. Call
 * this after ANY mutation of `state.stones` or of stone carriers — it is the
 * one place those two numbers are written.
 */
export function syncStones(state: GameState): GameState {
  const carried = new Map<string, number>();
  const activated = new Map<string, number>();
  for (const s of state.stones) {
    if (!s.carrier) continue;
    const m = s.activated ? activated : carried;
    m.set(s.carrier, (m.get(s.carrier) ?? 0) + 1);
  }
  return {
    ...state,
    units: state.units.map((u) => {
      const c = carried.get(u.id) ?? 0;
      const a = activated.get(u.id) ?? 0;
      return u.carried === c && u.activated === a ? u : { ...u, carried: c, activated: a };
    }),
  };
}

/** Move a set of tokens onto the board at `cell` (carrier cleared). Activation
 *  is untouched — an Activated stone stays Activated wherever it lands. */
function dropStones(state: GameState, ids: Set<string>, cell: Cell): GameState {
  if (!ids.size) return state;
  return {
    ...state,
    stones: state.stones.map((s) =>
      ids.has(s.id) ? { ...s, carrier: null, cell: { ...cell } } : s,
    ),
  };
}

export function graveAt(state: GameState, cell: Cell) {
  return state.gravestones.find((g) => sameCell(g.cell, cell));
}

function orthAdjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

/** The board seat (quarter-turns from the top) a colour occupies this game. */
function seatOf(state: GameState, player: PlayerColor): number {
  return state.seats?.[player] ?? PLAYER_ROTATION[player];
}

/** A player's home cell for a given formation slot column (top-frame). */
function homeCell(state: GameState, player: PlayerColor, col: number): Cell {
  return rotateCell({ r: 0, c: col }, seatOf(state, player));
}

/** The 8 cells of a player's home edge (its base). */
function baseCellsOf(state: GameState, player: PlayerColor): Cell[] {
  return [4, 5, 6, 7, 8, 9, 10, 11].map((c) => homeCell(state, player, c));
}

/** Is the unit standing on its own home edge (its base)? */
export function onOwnBase(state: GameState, unit: Unit): boolean {
  return edgeRotation(unit.cell.r, unit.cell.c) === seatOf(state, unit.owner);
}

/** Is an enemy unit currently occupying any of this player's base cells? */
function enemyInBase(state: GameState, player: PlayerColor): boolean {
  const cells = baseCellsOf(state, player);
  return state.units.some(
    (u) => u.owner !== player && cells.some((bc) => sameCell(bc, u.cell)),
  );
}

/**
 * Players whose base an enemy unit is currently standing on — i.e. under siege.
 * A besieged base can't respawn that player's felled Mage/Priest (they queue in
 * `pendingRespawns` until it clears — see `respawnOrQueue`). Derived purely from
 * live positions, so it appears/clears the instant a unit enters or leaves a base.
 */
export function siegedPlayers(state: GameState): PlayerColor[] {
  return state.players.filter((p) => !state.eliminated.includes(p) && enemyInBase(state, p));
}

/**
 * Colours of the enemy units standing on `player`'s base, dominant first — the
 * besieged base glows in the besieger's colour (ties broken by unit count).
 */
export function besiegersOf(state: GameState, player: PlayerColor): PlayerColor[] {
  const cells = baseCellsOf(state, player);
  const counts = new Map<PlayerColor, number>();
  for (const u of state.units) {
    if (u.owner === player) continue;
    if (cells.some((bc) => sameCell(bc, u.cell))) counts.set(u.owner, (counts.get(u.owner) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

/** Free base cell for a respawn: the unit's own home slot if it's empty,
 *  otherwise the CLOSEST free square of the base (ties resolve leftward). */
function freeBaseCell(state: GameState, player: PlayerColor, preferred: Cell): Cell | null {
  if (!unitAt(state, preferred)) return preferred;
  const free = baseCellsOf(state, player).filter((c) => !unitAt(state, c));
  if (!free.length) return null;
  const d = (c: Cell) => Math.abs(c.r - preferred.r) + Math.abs(c.c - preferred.c);
  return free.reduce((a, b) => (d(b) < d(a) ? b : a));
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Respawn a felled Mage/Priest at its base — unless an enemy holds the base, in
 * which case it is queued and brought back later once the base clears.
 */
function respawnOrQueue(
  state: GameState,
  owner: PlayerColor,
  kind: 'mage' | 'priest',
  id: string,
  log: string[],
  activated: number,
): GameState {
  const home = homeCell(state, owner, kind === 'mage' ? 8 : 7);
  if (!enemyInBase(state, owner)) {
    const cell = freeBaseCell(state, owner, home);
    if (cell) {
      log.push(`${owner}'s ${cap(kind)} respawns at base.`);
      // The Mage's remaining Activated tokens are still bound to this unit id,
      // so syncStones restores its counts the moment it is back on the board.
      return syncStones({
        ...state,
        units: [...state.units, { id, kind, owner, cell, carried: 0, activated }],
      });
    }
  }
  log.push(`${owner}'s ${cap(kind)} cannot respawn — an enemy holds the base.`);
  return { ...state, pendingRespawns: [...state.pendingRespawns, { id, owner, kind, activated }] };
}

/** Bring back any queued Mage/Priest whose base is now clear. */
export function resolveRespawns(state: GameState): GameState {
  if (state.pendingRespawns.length === 0) return state;
  let units = state.units;
  const log = [...state.log];
  const remaining: GameState['pendingRespawns'] = [];
  for (const p of state.pendingRespawns) {
    const scratch = { ...state, units };
    if (!enemyInBase(scratch, p.owner)) {
      const home = homeCell(scratch, p.owner, p.kind === 'mage' ? 8 : 7);
      const cell = freeBaseCell(scratch, p.owner, home);
      if (cell) {
        units = [
          ...units,
          { id: p.id, kind: p.kind, owner: p.owner, cell, carried: 0, activated: p.activated ?? 0 },
        ];
        log.push(`${p.owner}'s ${cap(p.kind)} returns to the board.`);
        continue;
      }
    }
    remaining.push(p);
  }
  // A returning Mage's stone TOKENS are still bound to its unit id, so syncing
  // restores its carried/activated counts the moment it is back on the board.
  return syncStones({ ...state, units, pendingRespawns: remaining, log });
}

export function warriorCount(state: GameState, owner: PlayerColor): number {
  return state.units.filter((u) => u.owner === owner && u.kind === 'warrior').length;
}

// ---- Gravestone bank -----------------------------------------------------

/** Gravestone markers each participating player contributes to the shared bank
 *  at setup: 8 in a 2-player game, 16 in a 4-player game. */
export const GRAVES_PER_PLAYER = 4;

/** Players still in the game — not eliminated, and holding a unit or with one
 *  queued to respawn. (Same test conquest victory uses, so the two agree.) */
export function activePlayers(state: GameState): PlayerColor[] {
  return state.players.filter(
    (p) =>
      !state.eliminated.includes(p) &&
      (state.units.some((u) => u.owner === p) ||
        state.pendingRespawns.some((pr) => pr.owner === p)),
  );
}

/** The bank's STARTING size for this game — `GRAVES_PER_PLAYER` per seat at
 *  setup (8 for 2p, 16 for 4p). Fixed for the whole match: eliminating a player
 *  does not shrink it, and nothing ever adds to it. */
export function gravestoneCapacity(state: GameState): number {
  return GRAVES_PER_PLAYER * state.players.length;
}

/**
 * Markers left in the shared, FINITE gravestone bank.
 *
 * This is a stored counter, not a derived one. It only ever DECREASES: a
 * Warrior's death spends one, and a resurrection removes that token from the
 * game entirely rather than returning it. Once it hits zero, Warrior losses are
 * permanent — the attrition half of the endgame clock.
 */
export function gravestoneBank(state: GameState): number {
  return Math.max(0, state.graveBank ?? 0);
}

// ---- The round: roll, then alternating activations -----------------------
//
// At the start of a round EVERY player rolls the same five dice — 3 Standard,
// 1 Mage, 1 Priest. Nothing is discarded and all five stay visible. Players
// then take turns ACTIVATING: one die, one unit, move-and-act, pass. A player
// may spend at most three of their five dice per round; whatever is left over
// is simply ignored when the round ends.
//
// The one exception to strict alternation is the SAME-COLOUR bundle: 2 or 3
// unused dice of the same kind may be committed to a single activation, moving
// and resolving all their units (a coordinated Warrior attack, say) before play
// passes. `GameState.activationDice` holds the dice committed to the activation
// in progress, and every die in it must share a kind.

const DIE_KINDS: DieKind[] = ['mage', 'priest', 'warrior', 'warrior', 'warrior'];

/** How many of the five shared dice each player may spend per round. */
export const DICE_PER_ROUND = 3;

/**
 * Roll the round's dice — FIVE, shared by everybody.
 *
 * The player starting the round throws them, and those same five serve every
 * player for the whole round: each draws their three from the one pool, and two
 * players may take the same die. Nothing here is per-seat any more.
 */
export function rollDice(state: GameState, rng: RNG = defaultRng): GameState {
  if (state.turnPhase !== 'roll') return state;
  const dice: Die[] = DIE_KINDS.map((kind) => ({
    id: `die-${dieCounter++}`,
    value: dN(6, rng),
    kind,
    usedBy: {},
  }));
  return {
    ...state,
    dice,
    activationDice: [],
    turnPhase: 'act',
    log: [
      ...state.log,
      `Round ${state.turn}: ${state.current} rolls the 5 shared dice. Everyone picks 3 of them.`,
    ],
  };
}

/** The unit `player` spent this die on, or null if they have not used it. Other
 *  players' claims on the same die are irrelevant — the pool is shared. */
export function dieSpentBy(die: Die, player: PlayerColor): string | null {
  return die.usedBy[player] ?? null;
}

/** Dice `player` has already spent this round (max `DICE_PER_ROUND`). */
export function diceSpent(state: GameState, player: PlayerColor): number {
  return state.dice.filter((d) => dieSpentBy(d, player) !== null).length;
}

/** Dice `player` may still spend this round. */
export function diceLeft(state: GameState, player: PlayerColor): number {
  return Math.max(0, DICE_PER_ROUND - diceSpent(state, player));
}

/** The round's dice. Shared, so this is the same five for every player — the
 *  parameter is kept for call-site clarity about whose view is being drawn. */
export function diceOf(state: GameState, _player: PlayerColor): Die[] {
  return state.dice;
}

/** The kind an activation is locked to once it has begun — only same-kind dice
 *  may join it. Null when no activation is in progress. */
export function activationKind(state: GameState): DieKind | null {
  const first = state.activationDice
    .map((id) => state.dice.find((d) => d.id === id))
    .find((d): d is Die => !!d);
  return first?.kind ?? null;
}

/** Is this die one the current player may commit right now — not already spent
 *  BY THEM (an opponent having used it is fine), within their three-dice
 *  budget, and matching any activation already begun? */
export function canCommitDie(state: GameState, die: Die): boolean {
  if (dieSpentBy(die, state.current) !== null) return false;
  if (diceLeft(state, state.current) <= 0) return false;
  const kind = activationKind(state);
  return kind === null || kind === die.kind;
}

/** Replace the round's five die values with the physically-rolled results, in
 *  order. One shared pool, one throw, so this is a straight positional map. */
export function setRolledValues(state: GameState, values: number[]): GameState {
  return {
    ...state,
    dice: state.dice.map((d, i) => (values[i] === undefined ? d : { ...d, value: values[i] })),
  };
}

// ---- Dice / activation ---------------------------------------------------

/** The current player's dice that are still free AND legal to commit to the
 *  activation in progress (see `canCommitDie`). */
export function availableDice(state: GameState): Die[] {
  return state.dice.filter((d) => canCommitDie(state, d));
}

/** Dice the current player has not spent yet, ignoring the same-kind activation
 *  lock — what is still theirs to take from the shared pool this round. */
export function unspentDice(state: GameState): Die[] {
  return state.dice.filter((d) => dieSpentBy(d, state.current) === null);
}

/** The die already spent activating this unit (from a move), if any. Unit ids
 *  carry their colour, so a scan across every player's claims is unambiguous. */
export function unitDie(state: GameState, unitId: string): Die | undefined {
  return state.dice.find((d) => Object.values(d.usedBy).includes(unitId));
}

/** A die may move/activate only the CURRENT player's matching unit kind, only
 *  within their three-dice round budget, and only if it fits the same-colour
 *  rule for the activation already in progress. */
export function canDieMoveUnit(die: Die, unit: Unit, state: GameState): boolean {
  if (unit.owner !== state.current) return false;
  if (state.unitsActedThisTurn.includes(unit.id)) return false;
  if (state.unitsMovedThisTurn.includes(unit.id)) return false;
  if (!canCommitDie(state, die)) return false;
  return die.kind === unit.kind;
}

// ---- Phase 3: movement ---------------------------------------------------

const DIRS = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
];

/**
 * All cells reachable by an orthogonal route of up to `steps` squares. The
 * route may turn at each step but never moves diagonally, and may only pass
 * through / land on empty existing cells (units block; stones/graves do not).
 */
export function legalMoves(state: GameState, unit: Unit, steps: number): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<string>([`${unit.cell.r},${unit.cell.c}`]);
  let frontier: Cell[] = [unit.cell];
  for (let dist = 1; dist <= steps; dist++) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      for (const { dr, dc } of DIRS) {
        const n = { r: cell.r + dr, c: cell.c + dc };
        const key = `${n.r},${n.c}`;
        if (seen.has(key)) continue;
        if (!cellExists(n)) continue;
        if (unitAt(state, n)) continue;
        seen.add(key);
        out.push(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

export function moveUnit(state: GameState, unitId: string, dieId: string, dest: Cell): GameState {
  if (state.turnPhase !== 'act') return state;
  const unit = unitById(state, unitId);
  const die = state.dice.find((d) => d.id === dieId);
  if (!unit || !die) return state;
  if (!canDieMoveUnit(die, unit, state)) return state;
  if (!legalMoves(state, unit, die.value).some((c) => sameCell(c, dest))) return state;

  // A move may vacate an enemy from someone's base → let queued units return.
  // And a Mage stepping onto its own base with 6+ activated stones wins on the
  // spot, so victory is checked immediately (not deferred to the next action).
  return checkVictory(
    pruneRitual(
      resolveRespawns({
        ...state,
        units: state.units.map((u) =>
          u.id === unitId ? { ...u, prevCell: u.cell, cell: dest } : u,
        ),
        dice: spendDie(state.dice, dieId, state.current, unitId),
        // Committing a die opens (or joins) the current activation. Everything
        // in it must share a kind — that IS the same-colour bundle rule.
        activationDice: state.activationDice.includes(dieId)
          ? state.activationDice
          : [...state.activationDice, dieId],
        unitsMovedThisTurn: [...state.unitsMovedThisTurn, unitId],
      }),
    ),
  );
}

// ---- Actions: shared activation -----------------------------------------

/** Can this unit still take an action (owned, hasn't acted, has/can get a matching die)? */
export function canAct(state: GameState, unitId: string): boolean {
  const unit = unitById(state, unitId);
  if (!unit || unit.owner !== state.current) return false;
  if (state.unitsActedThisTurn.includes(unitId)) return false;
  if (unitDie(state, unitId)) return true;
  return availableDice(state).some((d) => d.kind === unit.kind);
}

/**
 * Spend a matching-kind die on this unit's action, reusing its move die when it
 * has one. A fresh die must still pass `canCommitDie` — the owner's three-dice
 * round budget and the activation's same-colour lock both apply — so returns
 * both the new dice array and the activation it belongs to.
 */
function spendActionDie(state: GameState, unitId: string): Die[] | null {
  const existing = unitDie(state, unitId);
  if (existing) return state.dice;
  const unit = unitById(state, unitId);
  if (!unit) return null;
  const free = availableDice(state).find((d) => d.kind === unit.kind);
  if (!free) return null;
  return spendDie(state.dice, free.id, state.current, unitId);
}

/** Record that `player` has spent `dieId` on `unitId`. Other players' claims on
 *  that die are untouched — the five dice are shared, not consumed. */
function spendDie(dice: Die[], dieId: string, player: PlayerColor, unitId: string): Die[] {
  return dice.map((d) =>
    d.id === dieId ? { ...d, usedBy: { ...d.usedBy, [player]: unitId } } : d,
  );
}

/**
 * The activation ids after an action spent `dice`. An action-only activation
 * (a unit that acts without moving first) still has to register its die, or the
 * same-colour lock would not apply to whatever the player commits next.
 */
function withActivation(state: GameState, dice: Die[]): string[] {
  const opened = state.activationDice.slice();
  for (const d of dice) {
    if (dieSpentBy(d, state.current) === null || opened.includes(d.id)) continue;
    const before = state.dice.find((x) => x.id === d.id);
    if (before && dieSpentBy(before, state.current) === null) opened.push(d.id);
  }
  return opened;
}

function markActed(state: GameState, unitId: string): string[] {
  return state.unitsActedThisTurn.includes(unitId)
    ? state.unitsActedThisTurn
    : [...state.unitsActedThisTurn, unitId];
}

// ---- Combat --------------------------------------------------------------

/** Enemy units orthogonally adjacent to `unit` (valid attack targets). */
export function attackTargets(state: GameState, unitId: string): Unit[] {
  const unit = unitById(state, unitId);
  if (!unit || unit.kind === 'priest') return []; // priests cannot attack
  if (!canAct(state, unitId)) return [];
  return state.units.filter((u) => u.owner !== unit.owner && orthAdjacent(u.cell, unit.cell));
}

/** Warriors of the current player adjacent to `targetId` that could join in. */
export function coordinationCandidates(state: GameState, targetId: string): Unit[] {
  const target = unitById(state, targetId);
  if (!target) return [];
  return state.units.filter(
    (u) =>
      u.owner === state.current &&
      u.kind === 'warrior' &&
      orthAdjacent(u.cell, target.cell) &&
      canAct(state, u.id),
  );
}

/**
 * The attackers an attack on `targetId` led by `attackerId` would actually use:
 * a lone Mage/Warrior, or a Warrior plus auto-coordinating adjacent Warriors
 * (capped at 3 and at the number of free Warrior dice). The store and the
 * pre-attack odds preview both call this so the preview matches what happens.
 */
export function plannedAttackers(state: GameState, attackerId: string, targetId: string): string[] {
  const sel = unitById(state, attackerId);
  if (!sel) return [];
  if (sel.kind !== 'warrior') return [attackerId];
  const others = coordinationCandidates(state, targetId).filter((w) => w.id !== sel.id);
  const chosen = [sel, ...others].slice(0, 3);
  const freeCount = availableDice(state).filter((d) => d.kind === 'warrior').length;
  const needing = () => chosen.filter((w) => !unitDie(state, w.id)).length;
  while (needing() > freeCount && chosen.length > 1) chosen.pop();
  return chosen.map((w) => w.id);
}

/**
 * Win/lose probabilities for an attack (attacker's summed roll vs the defender's
 * die — d6, or a defending Mage's power die). Warriors contribute n×d6; a lone
 * Mage attacks with its power die.
 *
 * Neither side has an edge: a tie is **re-rolled** until the result is decisive,
 * so the odds are conditioned on a decisive outcome —
 * `P(win | not draw) = win / (win + lose)`. An even fight (1d6 against 1d6) is
 * therefore exactly 50:50. `draw` is always 0 here — kept in the shape for
 * compatibility with existing callers.
 */
export function combatOdds(
  state: GameState,
  attackerIds: string[],
  targetId: string,
): { win: number; draw: number; lose: number } {
  const attackers = attackerIds.map((id) => unitById(state, id)).filter((u): u is Unit => !!u);
  const target = unitById(state, targetId);
  if (attackers.length === 0 || !target) return { win: 0, draw: 0, lose: 0 };
  const isMage = attackers.length === 1 && attackers[0].kind === 'mage';
  const faces = isMage ? [magePowerDie(attackers[0].activated)] : attackers.map(() => 6);
  // Distribution of the attacker's summed roll (convolution of the dice).
  let dist = new Map<number, number>([[0, 1]]);
  for (const f of faces) {
    const next = new Map<number, number>();
    for (const [s, p] of dist) {
      for (let v = 1; v <= f; v++) next.set(s + v, (next.get(s + v) ?? 0) + p / f);
    }
    dist = next;
  }
  // The defender rolls a d6, unless it's a Mage — then its power die (d12/d20).
  const defFaces = target.kind === 'mage' ? magePowerDie(target.activated) : 6;
  let win = 0;
  let lose = 0;
  for (const [a, pa] of dist) {
    for (let d = 1; d <= defFaces; d++) {
      const p = pa / defFaces;
      if (a > d) win += p;
      else if (a < d) lose += p;
      // a === d is a draw → re-rolled, so it favours neither side.
    }
  }
  // Renormalise over decisive outcomes (draws are re-rolled away).
  const decisive = win + lose;
  if (decisive === 0) return { win: 0, draw: 0, lose: 0 };
  return { win: win / decisive, draw: 0, lose: lose / decisive };
}

/**
 * Resolve an attack by one or more attackers on a target. Warriors combine
 * (n d6); a lone Mage rolls its power die. The defender rolls 1d6 (a Mage rolls
 * its power die). Higher wins and a **tie is re-rolled**, so neither side has an
 * advantage and an even fight is 50:50. On a loss exactly one attacker falls —
 * except against a Priest, which never kills its attacker: it simply repels the
 * attack and both units stay put.
 */
export function resolveAttack(
  state: GameState,
  attackerIds: string[],
  targetId: string,
  rng: RNG = defaultRng,
): GameState {
  if (state.turnPhase !== 'act' || state.winner) return state;
  const target = unitById(state, targetId);
  const attackers = attackerIds.map((id) => unitById(state, id)).filter((u): u is Unit => !!u);
  if (!target || attackers.length === 0) return state;
  if (attackers.some((a) => a.owner !== state.current || !canAct(state, a.id))) return state;
  if (attackers.some((a) => !orthAdjacent(a.cell, target.cell))) return state;
  if (target.owner === state.current) return state;

  const isMage = attackers.length === 1 && attackers[0].kind === 'mage';
  if (!isMage && attackers.some((a) => a.kind !== 'warrior')) return state;

  // Spend a die for each attacker (reusing move dice where present).
  let dice = state.dice;
  let scratch: GameState = { ...state, dice };
  for (const a of attackers) {
    const updated = spendActionDie(scratch, a.id);
    if (!updated) return state; // not enough dice
    scratch = { ...scratch, dice: updated };
  }
  dice = scratch.dice;
  const activationDice = withActivation(state, dice);

  // Roll attack vs the defender's die, RE-ROLLING any tie so the fight is always
  // decisive and neither side is favoured (an even matchup is 50:50). A
  // defending Mage rolls its own power die (d12/d20 by activated stones), not a
  // d6, so a powered-up Mage is much harder to kill.
  const attackFaces = isMage ? magePowerDie(attackers[0].activated) : 6;
  const defenseFaces = target.kind === 'mage' ? magePowerDie(target.activated) : 6;
  let attackDice: number[];
  let attackRoll: number;
  let defenseRoll: number;
  // BOUNDED. With real dice a run of ties dies out immediately (a d6 duel ties
  // 1 time in 6), but `rng` is injectable — the bot's scratch simulations and
  // the tutorial's staged fights both feed rigged sequences, and a constant one
  // would tie forever. After the guard the tie falls through to the comparison
  // below, which resolves it as "the attacker did not beat the defender".
  let guard = 0;
  do {
    attackDice = isMage
      ? [dN(attackFaces, rng)]
      : Array.from({ length: attackers.length }, () => dN(6, rng));
    attackRoll = attackDice.reduce((a, b) => a + b, 0);
    defenseRoll = dN(defenseFaces, rng);
  } while (attackRoll === defenseRoll && ++guard < 64);

  // Highest roll wins; the loser is defeated outright. (Draws never reach here.)
  let outcome: CombatResult['outcome'];
  let defeatedId: string | null = null;
  let next: GameState = {
    ...state,
    dice,
    activationDice,
    unitsActedThisTurn: attackers.reduce((acc, a) => {
      return acc.includes(a.id) ? acc : [...acc, a.id];
    }, state.unitsActedThisTurn),
  };

  if (attackRoll > defenseRoll) {
    outcome = 'win';
    defeatedId = target.id;
    next = bumpKill(defeatUnit(next, target.id), state.current);
  } else {
    // attackRoll < defenseRoll (a tie was re-rolled away above). A Priest never
    // kills its attacker: winning its defence simply REPELS the attack and both
    // units stay exactly where they are — a Priest that is not defeated does not
    // move. Any other defender defeats exactly one attacker.
    outcome = 'lose';
    if (target.kind !== 'priest') {
      defeatedId = attackers[0].id; // coordinated: only one attacker falls
      next = bumpKill(defeatUnit(next, attackers[0].id), target.owner);
    }
  }

  const combat: CombatResult = {
    attackerIds,
    defenderId: targetId,
    attackerOwner: state.current,
    defenderOwner: target.owner,
    attackerKind: attackers[0].kind,
    defenderKind: target.kind,
    attackRoll,
    attackDice,
    attackFaces,
    defenseRoll,
    defenseFaces,
    outcome,
    defeatedId,
    defenderCell: target.cell,
  };
  const verb = outcome === 'win' ? 'defeats' : 'is repelled by';
  const label = isMage ? 'Mage' : attackers.length > 1 ? `${attackers.length} Warriors` : 'Warrior';
  next = {
    ...next,
    lastCombat: combat,
    log: [
      ...next.log,
      `${state.current}'s ${label} (${attackRoll}) ${verb} ${target.owner}'s ${target.kind} (def ${defenseRoll}).`,
    ],
  };
  // Defeating an enemy may clear a base and free a queued respawn.
  return checkVictory(resolveRespawns(next));
}

// ---- Defeat handling -----------------------------------------------------

/** Credit a kill to `killer`. */
function bumpKill(state: GameState, killer: PlayerColor): GameState {
  return { ...state, kills: { ...state.kills, [killer]: state.kills[killer] + 1 } };
}

export function defeatUnit(state: GameState, unitId: string): GameState {
  const unit = unitById(state, unitId);
  if (!unit) return state;
  const units = state.units.filter((u) => u.id !== unitId);
  const log = [...state.log];

  if (unit.kind === 'warrior') {
    // A Warrior leaves one Gravestone where it fell — but only if the finite
    // shared bank still holds a token, the square has no gravestone already (no
    // stacking), and it isn't a Nexus square. A token is spent only when one is
    // actually placed; a blocked square costs the bank nothing.
    const blocked = !!graveAt(state, unit.cell) || inNexus(unit.cell.r, unit.cell.c);
    let gravestones = state.gravestones;
    let graveBank = state.graveBank;
    if (graveBank > 0 && !blocked) {
      gravestones = [...gravestones, { id: `grave-${graveCounter++}`, cell: unit.cell }];
      graveBank -= 1;
      log.push(
        `${unit.owner}'s Warrior falls — a Gravestone marks the square (bank ${graveBank}).`,
      );
    } else if (graveBank <= 0) {
      log.push(`${unit.owner}'s Warrior falls for good — the Gravestone bank is empty.`);
    } else {
      log.push(`${unit.owner}'s Warrior falls (no Gravestone placed).`);
    }
    return { ...state, units, gravestones, graveBank, log };
  }

  if (unit.kind === 'priest') {
    log.push(`${unit.owner}'s Priest is slain.`);
    const ritual = state.ritual?.priestId === unitId ? null : state.ritual;
    const base = { ...state, units, ritual, log };
    return respawnOrQueue(base, unit.owner, 'priest', unit.id, log, 0);
  }

  // Mage: drop every Unactivated token it carries, PLUS exactly one Activated
  // token if it has any. The rest of its Activated tokens stay bound to the unit
  // id and so return with it on respawn. The dropped Activated stone stays
  // ACTIVATED on the board — activation is never undone.
  const held = carriedStones(state, unit.id);
  const unactivated = held.filter((s) => !s.activated);
  const activatedHeld = held.filter((s) => s.activated);
  const droppedIds = new Set([
    ...unactivated.map((s) => s.id),
    ...activatedHeld.slice(0, 1).map((s) => s.id),
  ]);
  const retainedActivated = Math.max(0, activatedHeld.length - 1);
  log.push(
    `${unit.owner}'s Mage is struck down, scattering ${droppedIds.size} MageStone(s)` +
      (activatedHeld.length ? ` (1 still Activated)` : '') +
      '.',
  );

  const base = syncStones(
    dropStones({ ...state, units, log }, droppedIds, unit.cell),
  );
  return respawnOrQueue(base, unit.owner, 'mage', unit.id, log, retainedActivated);
}

// ---- Mage actions: collect / activate ------------------------------------

export function canCollect(state: GameState, unitId: string): boolean {
  const u = unitById(state, unitId);
  return !!u && u.kind === 'mage' && canAct(state, unitId) && stonesAt(state, u.cell).length > 0;
}

export function collect(state: GameState, unitId: string): GameState {
  if (!canCollect(state, unitId)) return state;
  const unit = unitById(state, unitId)!;
  const dice = spendActionDie(state, unitId);
  if (!dice) return state;
  const activationDice = withActivation(state, dice);
  const here = stonesAt(state, unit.cell);
  const ids = new Set(here.map((s) => s.id));
  // Each token keeps the activation state it already had. An ALREADY-ACTIVATED
  // stone counts for this Mage the instant it is picked up — no trip home, and
  // it works just the same for an opponent who takes it off the battlefield.
  const gainedActivated = here.filter((s) => s.activated).length;
  const note = gainedActivated > 0 ? ` (${gainedActivated} already Activated)` : '';
  return checkVictory(
    syncStones({
      ...state,
      dice,
      activationDice,
      stones: state.stones.map((s) => (ids.has(s.id) ? { ...s, carrier: unitId } : s)),
      unitsActedThisTurn: markActed(state, unitId),
      log: [...state.log, `${unit.owner}'s Mage collects ${here.length} MageStone(s)${note}.`],
    }),
  );
}

export function canActivate(state: GameState, unitId: string): boolean {
  const u = unitById(state, unitId);
  // A Mage may only activate carried MageStones while standing on its own base.
  return !!u && u.kind === 'mage' && canAct(state, unitId) && u.carried > 0 && onOwnBase(state, u);
}

export function activate(state: GameState, unitId: string): GameState {
  if (!canActivate(state, unitId)) return state;
  const unit = unitById(state, unitId)!;
  const dice = spendActionDie(state, unitId);
  if (!dice) return state;
  const activationDice = withActivation(state, dice);
  // Flip the Mage's Unactivated tokens. This is the ONLY false -> true
  // transition in the engine, and it is irreversible for the rest of the game.
  const moved = carriedStones(state, unitId).filter((s) => !s.activated);
  const ids = new Set(moved.map((s) => s.id));
  return checkVictory(
    syncStones({
      ...state,
      dice,
      activationDice,
      stones: state.stones.map((s) => (ids.has(s.id) ? { ...s, activated: true } : s)),
      unitsActedThisTurn: markActed(state, unitId),
      log: [
        ...state.log,
        `${unit.owner}'s Mage activates ${moved.length} MageStone(s) (now ${
          unit.activated + moved.length
        }).`,
      ],
    }),
  );
}

// ---- Mage powers: Bolt / Nova ---------------------------------------------
// Activated MageStones can be SPENT as sorcery. The spent stones stay
// activated but leave the Mage and land back on the board for anyone to claim.

export const BOLT_COST = 1;
export const NOVA_COST = 4;

const manhattan = (a: Cell, b: Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
const chebyshev = (a: Cell, b: Cell) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));

/** The die value a Mage action would use (its move die, else the best free
 *  mage die) — the Bolt's RANGE. 0 when no die is available. */
export function mageActionDieValue(state: GameState, unitId: string): number {
  const existing = unitDie(state, unitId);
  if (existing) return existing.value;
  const free = availableDice(state)
    .filter((d) => d.kind === 'mage')
    .sort((a, b) => b.value - a.value)[0];
  return free?.value ?? 0;
}

export function canBolt(state: GameState, unitId: string): boolean {
  const u = unitById(state, unitId);
  if (!u || u.kind !== 'mage' || !canAct(state, unitId)) return false;
  if (u.activated < BOLT_COST) return false;
  return mageActionDieValue(state, unitId) > 0;
}

/** Enemy units within Bolt range (the mage die's value, orthogonal steps). */
export function boltTargets(state: GameState, unitId: string): Unit[] {
  if (!canBolt(state, unitId)) return [];
  const mage = unitById(state, unitId)!;
  const range = mageActionDieValue(state, unitId);
  return state.units.filter(
    (u) => u.owner !== mage.owner && manhattan(u.cell, mage.cell) <= range,
  );
}

/**
 * BOLT — spend 1 Activated stone to strike any enemy in range.
 *
 * It is **indefensible**: no defence roll is made by anything, a Mage included.
 * The target is defeated immediately by its normal defeat rules. The spent
 * stone is NOT destroyed — the same token leaves the Mage and lands on the
 * square that was hit, STILL ACTIVATED, so any Mage (including the enemy's) can
 * pick it up and count it immediately.
 */
export function resolveBolt(
  state: GameState,
  mageId: string,
  targetId: string,
  _rng: RNG = defaultRng,
): GameState {
  if (state.turnPhase !== 'act' || state.winner) return state;
  const mage = unitById(state, mageId);
  const target = unitById(state, targetId);
  if (!mage || !target || !canBolt(state, mageId)) return state;
  if (target.owner === mage.owner) return state;
  if (manhattan(target.cell, mage.cell) > mageActionDieValue(state, mageId)) return state;

  const dice = spendActionDie(state, mageId);
  if (!dice) return state;
  const activationDice = withActivation(state, dice);

  // The stone spent is a real token: it moves to the target square and keeps
  // its activation. Nothing is minted and nothing is destroyed.
  const spent = carriedStones(state, mageId).filter((s) => s.activated).slice(0, BOLT_COST);
  if (spent.length < BOLT_COST) return state;
  const spentIds = new Set(spent.map((s) => s.id));

  let next: GameState = syncStones(
    dropStones(
      {
        ...state,
        dice,
        activationDice,
        unitsActedThisTurn: markActed(state, mageId),
        // A Bolt has no defence roll at all, so there are no combat dice to
        // throw — the physical dice layer keys off `lastCombat`.
        lastCombat: null,
        log: [
          ...state.log,
          `${mage.owner}'s Mage bolts ${target.owner}'s ${target.kind} — indefensible! ` +
            `The spent MageStone drops (still Activated) where it struck.`,
        ],
      },
      spentIds,
      target.cell,
    ),
  );
  next = bumpKill(defeatUnit(next, targetId), mage.owner);
  return checkVictory(resolveRespawns(next));
}

export function canNova(state: GameState, unitId: string): boolean {
  const u = unitById(state, unitId);
  if (!u || u.kind !== 'mage' || !canAct(state, unitId)) return false;
  if (u.activated < NOVA_COST) return false;
  if (mageActionDieValue(state, unitId) === 0) return false;
  return novaVictims(state, unitId).length > 0;
}

/** Every **ENEMY** unit in the 8 squares surrounding the Mage. Friendly units
 *  stand in the blast unharmed. */
export function novaVictims(state: GameState, unitId: string): Unit[] {
  const mage = unitById(state, unitId);
  if (!mage) return [];
  return state.units.filter(
    (u) => u.owner !== mage.owner && chebyshev(u.cell, mage.cell) === 1,
  );
}

/** The four diagonal neighbours of `cell` that exist on the board, in a fixed
 *  order (NW, NE, SW, SE) — where Nova's four spent stones land. */
function diagonalsOf(cell: Cell): Cell[] {
  const out: Cell[] = [];
  for (const [dr, dc] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    const c = { r: cell.r + dr, c: cell.c + dc };
    if (cellExists(c)) out.push(c);
  }
  return out;
}

/**
 * NOVA — spend 4 Activated stones for an indefensible area attack.
 *
 * Every ENEMY unit in the 8 squares surrounding the Mage is defeated
 * immediately, with no defence rolls. Friendly units are untouched. The four
 * spent tokens are then placed on the four DIAGONAL squares around the Mage,
 * all still ACTIVATED and free for any Mage to collect.
 */
export function resolveNova(state: GameState, mageId: string, _rng: RNG = defaultRng): GameState {
  if (state.turnPhase !== 'act' || state.winner) return state;
  const mage = unitById(state, mageId);
  if (!mage || !canNova(state, mageId)) return state;
  const dice = spendActionDie(state, mageId);
  if (!dice) return state;
  const activationDice = withActivation(state, dice);

  const victims = novaVictims(state, mageId);
  const spent = carriedStones(state, mageId).filter((s) => s.activated).slice(0, NOVA_COST);
  if (spent.length < NOVA_COST) return state;

  // One stone per diagonal. If a diagonal is off the board (the Mage is against
  // a cut corner or an edge) that stone falls on the Mage's own square instead,
  // so no token is ever lost.
  const diagonals = diagonalsOf(mage.cell);
  let next: GameState = {
    ...state,
    dice,
    activationDice,
    stones: state.stones.map((s) => {
      const i = spent.findIndex((x) => x.id === s.id);
      if (i < 0) return s;
      return { ...s, carrier: null, cell: { ...(diagonals[i] ?? mage.cell) }, activated: true };
    }),
    unitsActedThisTurn: markActed(state, mageId),
    lastCombat: null, // no dice duel — the blast is absolute
    log: [
      ...state.log,
      `${mage.owner}'s Mage unleashes a NOVA — ${victims.length} enemy unit(s) consumed! ` +
        `4 Activated MageStones fall to the diagonals.`,
    ],
  };
  next = syncStones(next);
  for (const v of victims) {
    next = defeatUnit(next, v.id);
    next = bumpKill(next, mage.owner);
  }
  return checkVictory(resolveRespawns(next));
}

// ---- Priest actions: resurrect / ritual ----------------------------------

export function canResurrect(state: GameState, unitId: string): boolean {
  const u = unitById(state, unitId);
  if (!u || u.kind !== 'priest' || !canAct(state, unitId)) return false;
  if (!graveAt(state, u.cell)) return false;
  if (warriorCount(state, u.owner) >= MAX_WARRIORS) return false;
  // Only one Gravestone per player per turn (the flee-resurrection below is the
  // deliberate exception and does not go through here).
  if (state.resurrectedThisTurn.includes(u.owner)) return false;
  // Need an empty adjacent cell for the Priest to step back into.
  return stepBackCell(state, u) !== null;
}

/**
 * Where the Priest steps back to after resurrecting — one square back the way
 * it came (toward `prevCell`). Falls back to any free orthogonal neighbour.
 */
function stepBackCell(state: GameState, priest: Unit): Cell | null {
  const free = (c: Cell) => cellExists(c) && !unitAt(state, c);
  if (priest.prevCell) {
    const dr = Math.sign(priest.prevCell.r - priest.cell.r);
    const dc = Math.sign(priest.prevCell.c - priest.cell.c);
    // Prefer the axis the Priest actually travelled along.
    const order =
      Math.abs(priest.prevCell.r - priest.cell.r) >= Math.abs(priest.prevCell.c - priest.cell.c)
        ? [{ dr, dc: 0 }, { dr: 0, dc }]
        : [{ dr: 0, dc }, { dr, dc: 0 }];
    for (const { dr: r, dc: c } of order) {
      if (r === 0 && c === 0) continue;
      const cell = { r: priest.cell.r + r, c: priest.cell.c + c };
      if (free(cell)) return cell;
    }
  }
  for (const { dr, dc } of DIRS) {
    const c = { r: priest.cell.r + dr, c: priest.cell.c + dc };
    if (free(c)) return c;
  }
  return null;
}

export function resurrect(state: GameState, unitId: string): GameState {
  if (!canResurrect(state, unitId)) return state;
  const priest = unitById(state, unitId)!;
  const dice = spendActionDie(state, unitId);
  if (!dice) return state;
  const activationDice = withActivation(state, dice);
  const grave = graveAt(state, priest.cell)!;
  const back = stepBackCell(state, priest)!;
  const newWarrior: Unit = {
    id: `${priest.owner}-w-res${graveCounter++}`,
    kind: 'warrior',
    owner: priest.owner,
    cell: priest.cell, // warrior appears on the gravestone square
    carried: 0,
    activated: 0,
  };
  // The Gravestone token is spent PERMANENTLY — it leaves the board and is NOT
  // returned to the shared bank, so `graveBank` is untouched here.
  return {
    ...state,
    dice,
    activationDice,
    gravestones: state.gravestones.filter((g) => g.id !== grave.id),
    units: [
      ...state.units.map((u) => (u.id === unitId ? { ...u, cell: back } : u)),
      newWarrior,
    ],
    unitsActedThisTurn: markActed(state, unitId),
    resurrectedThisTurn: state.resurrectedThisTurn.includes(priest.owner)
      ? state.resurrectedThisTurn
      : [...state.resurrectedThisTurn, priest.owner],
    log: [
      ...state.log,
      `${priest.owner}'s Priest resurrects a Warrior — that Gravestone leaves the game.`,
    ],
  };
}

/** The area a Rite of the Nexus needs held: the central 2x2 Nexus, and only
 *  that. Every one of its four squares must be free of enemies — friendly units
 *  are welcome to stand on the other three. */
export const RITUAL_AREA: Cell[] = NEXUS_CELLS;

/** Enemy units standing anywhere in the Nexus. */
export function ritualIntruders(state: GameState, owner: PlayerColor): Unit[] {
  return state.units.filter(
    (u) => u.owner !== owner && RITUAL_AREA.some((c) => sameCell(c, u.cell)),
  );
}

function ritualAreaClear(state: GameState, owner: PlayerColor): boolean {
  return ritualIntruders(state, owner).length === 0;
}

/** Is a declared ritual still standing — Priest alive, still in the Nexus, and
 *  no enemy on any Nexus square? */
export function ritualIntact(state: GameState): boolean {
  const rit = state.ritual;
  if (!rit) return false;
  const priest = unitById(state, rit.priestId);
  return (
    !!priest &&
    inNexus(priest.cell.r, priest.cell.c) &&
    ritualAreaClear(state, rit.player)
  );
}

/** Drop a ritual the moment one of its stop conditions fires (the Priest dies,
 *  leaves or flees out of the Nexus, or an enemy occupies a Nexus square) so
 *  the HUD's ritual flag never lingers on a broken ritual. `endTurn` still does
 *  the authoritative check when play comes back round. */
function pruneRitual(state: GameState): GameState {
  if (!state.ritual || ritualIntact(state)) return state;
  return { ...state, ritual: null, log: [...state.log, `The Ritual was broken.`] };
}

export function canRitual(state: GameState, unitId: string): boolean {
  const u = unitById(state, unitId);
  if (!u || u.kind !== 'priest' || !canAct(state, unitId)) return false;
  if (!inNexus(u.cell.r, u.cell.c)) return false;
  if (state.ritual) return false;
  // All four Nexus squares must be free of enemies to begin.
  return ritualAreaClear(state, u.owner);
}

export function beginRitual(state: GameState, unitId: string): GameState {
  if (!canRitual(state, unitId)) return state;
  const priest = unitById(state, unitId)!;
  const dice = spendActionDie(state, unitId);
  if (!dice) return state;
  const activationDice = withActivation(state, dice);
  return {
    ...state,
    dice,
    activationDice,
    // Stamped with the round it began in. That round is already part-spent, so
    // it does not count: the Rite must then survive one FULL round, and pays out
    // as the round after that opens (see RITUAL_HOLD_ROUNDS).
    ritual: { player: priest.owner, priestId: unitId, round: state.turn },
    unitsActedThisTurn: markActed(state, unitId),
    log: [...state.log, `${priest.owner}'s Priest begins the Ritual in the Nexus!`],
  };
}

// ---- Victory -------------------------------------------------------------

export function checkVictory(state: GameState): GameState {
  if (state.winner) return state;
  // Safety net: every path that can change stone ownership funnels through here,
  // so the derived mirrors are guaranteed fresh before victory is judged.
  state = syncStones(state);

  // Eliminations first: a player reduced to ZERO units on the board (their
  // Mage/Priest respawns locked out by a siege) is out of the game entirely —
  // queued respawns are voided, and endTurn skips them from here on.
  let s = state;
  for (const p of s.players) {
    if (s.eliminated.includes(p)) continue;
    if (s.units.some((u) => u.owner === p)) continue;
    s = {
      ...s,
      eliminated: [...s.eliminated, p],
      pendingRespawns: s.pendingRespawns.filter((pr) => pr.owner !== p),
      log: [...s.log, `${p} is eliminated!`],
    };
  }

  // MageStone victory: a Mage back on any cell of its own base carrying 6 OR
  // MORE activated stones wins on the spot.
  for (const player of s.players) {
    const mage = s.units.find((u) => u.kind === 'mage' && u.owner === player);
    if (mage && mage.activated >= STONES_TO_WIN && onOwnBase(s, mage)) {
      return {
        ...s,
        winner: player,
        winMethod: 'MageStone',
        log: [...s.log, `${player} wins by MageStone power!`],
      };
    }
  }

  // Conquest: only one player left standing.
  const alive = activePlayers(s);
  if (alive.length === 1 && s.players.length > 1) {
    return {
      ...s,
      winner: alive[0],
      winMethod: 'Conquest',
      log: [...s.log, `${alive[0]} wins by conquest!`],
    };
  }
  return s;
}

// ---- Phase 5: end of turn ------------------------------------------------

/**
 * Is `p` still owed an activation this round? They must be in the game, under
 * their three-dice budget, actually holding an unspent die, and able to do
 * something with it. The last test matters: without it a player whose pieces
 * are all locked would be handed activation after activation and the round
 * could never end.
 */
function hasActivationLeft(state: GameState, p: PlayerColor): boolean {
  if (state.eliminated.includes(p)) return false;
  if (state.passed.includes(p)) return false;
  if (diceLeft(state, p) <= 0) return false;
  if (!state.dice.some((d) => dieSpentBy(d, p) === null)) return false;
  return hasPlayLeft({ ...state, current: p, activationDice: [] });
}

/** The next player owed an activation, clockwise from `from` (exclusive), or
 *  null when the round is over. */
function nextActivator(state: GameState, from: PlayerColor): PlayerColor | null {
  const idx = state.players.indexOf(from);
  for (let hop = 1; hop <= state.players.length; hop++) {
    const cand = state.players[(idx + hop) % state.players.length];
    if (hasActivationLeft(state, cand)) return cand;
  }
  return null;
}

/**
 * End the current ACTIVATION and pass play on.
 *
 * Play alternates: the next player with dice left activates. When nobody has
 * dice left — every player has spent their three, or passed on what remained —
 * the round ends, the starting player rotates, and a fresh roll begins.
 */
export function endActivation(state: GameState): GameState {
  if (state.winner) return state;
  const base = state;

  // Ending an activation without having committed anything is a PASS: that
  // player is done for the round and their unused dice are simply ignored.
  // (Otherwise there would be no way to leave dice unspent, which the rules
  // explicitly allow.)
  const passing = base.activationDice.length === 0;
  const after: GameState = passing
    ? {
        ...base,
        passed: base.passed.includes(base.current) ? base.passed : [...base.passed, base.current],
        log: [...base.log, `${base.current} passes — ${diceLeft(base, base.current)} dice unused.`],
      }
    : base;

  const next = nextActivator(after, after.current);
  if (next) {
    return resolveRespawns({
      ...after,
      current: next,
      activationDice: [],
      lastCombat: null,
      log: [...after.log, `— ${next} activates (${diceLeft(after, next)} dice left).`],
    });
  }
  return newRound(after);
}

/**
 * How many rounds must tick over before a Rite pays out.
 *
 * The round it is DECLARED in is already part-spent, so it does not count: the
 * Rite has to survive one whole round after that. Declared in round 12, it is
 * won at the START of round 14 — round 13 being the full round it had to hold
 * through, in which every player, the ritualist included, gets a complete turn
 * to break it or defend it.
 */
export const RITUAL_HOLD_ROUNDS = 2;

/** The round at whose start a declared Rite pays out, or null if none is running. */
export function ritualWinsOnRound(state: GameState): number | null {
  return state.ritual ? state.ritual.round + RITUAL_HOLD_ROUNDS : null;
}

/**
 * Close the round and open the next one. The starting player rotates clockwise
 * each round (in a 2-player game that is strict alternation), unspent dice are
 * simply discarded, and the per-round records reset.
 */
function newRound(state: GameState): GameState {
  const idx = state.players.indexOf(state.roundStarter);
  let starter = state.roundStarter;
  for (let hop = 1; hop <= state.players.length; hop++) {
    const cand = state.players[(idx + hop) % state.players.length];
    if (!state.eliminated.includes(cand)) {
      starter = cand;
      break;
    }
  }
  const turn = state.turn + 1;

  let s: GameState = resolveRespawns({
    ...state,
    current: starter,
    roundStarter: starter,
    turn,
    turnPhase: 'roll',
    dice: [],
    activationDice: [],
    passed: [],
    unitsMovedThisTurn: [],
    unitsActedThisTurn: [],
    resurrectedThisTurn: [],
    lastCombat: null,
    log: [...state.log, `— Round ${turn}. ${starter} starts. Roll the dice.`],
  });

  // The Rite is judged HERE, at the round boundary, and only once a full round
  // has passed since it was declared (see RITUAL_HOLD_ROUNDS). Declared in round
  // 12: round 13 is the round it must hold through, and it pays out as round 14
  // opens — before anyone acts in it.
  if (s.ritual) {
    if (!ritualIntact(s)) {
      s = { ...s, ritual: null, log: [...s.log, `The Ritual was broken.`] };
    } else if (turn >= s.ritual.round + RITUAL_HOLD_ROUNDS) {
      return {
        ...s,
        winner: s.ritual.player,
        winMethod: 'Ritual',
        log: [...s.log, `${s.ritual.player} completes the Rite of the Nexus and wins!`],
      };
    }
  }
  return s;
}

/** Whether the current player can still do anything in this activation — a unit
 *  to act with, or a die left to commit. */
export function hasPlayLeft(state: GameState): boolean {
  if (state.turnPhase !== 'act') return false;
  if (diceLeft(state, state.current) <= 0) return false;
  return state.units.some(
    (u) =>
      u.owner === state.current &&
      (canAct(state, u.id) || (!state.unitsMovedThisTurn.includes(u.id) && !!unitDie(state, u.id))),
  );
}
