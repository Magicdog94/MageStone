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
  MageStone,
  PlayerColor,
  Unit,
} from './types';

type RNG = () => number;
const defaultRng: RNG = () => Math.random();

let dieCounter = 0;
let graveCounter = 0;
let stoneCounter = 1000;
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

export function stonesAt(state: GameState, cell: Cell) {
  return state.stones.filter((s) => !s.collected && sameCell(s.cell, cell));
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

/** First free base cell (preferring the unit's home slot), or null. */
function freeBaseCell(state: GameState, player: PlayerColor, preferred: Cell): Cell | null {
  if (!unitAt(state, preferred)) return preferred;
  for (const c of baseCellsOf(state, player)) if (!unitAt(state, c)) return c;
  return null;
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
      return {
        ...state,
        units: [...state.units, { id, kind, owner, cell, carried: 0, activated }],
      };
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
  return { ...state, units, pendingRespawns: remaining, log };
}

export function warriorCount(state: GameState, owner: PlayerColor): number {
  return state.units.filter((u) => u.owner === owner && u.kind === 'warrior').length;
}

// ---- Gravestone bank -----------------------------------------------------

/** Gravestone markers each player contributes to the shared bank. */
export const GRAVES_PER_PLAYER = 3;

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

/** Maximum gravestones allowed on the board at once: `GRAVES_PER_PLAYER` per
 *  still-active player (6 for 2p, 12 for 4p), so the cap drops by 3 each time a
 *  player is eliminated. */
export function gravestoneCapacity(state: GameState): number {
  return GRAVES_PER_PLAYER * activePlayers(state).length;
}

/** Markers left in the shared gravestone bank — capacity minus those already on
 *  the board. Placing a gravestone spends one; resurrecting returns one. */
export function gravestoneBank(state: GameState): number {
  return Math.max(0, gravestoneCapacity(state) - state.gravestones.length);
}

// ---- Phase 1-2: roll & discard ------------------------------------------

// Roll 5 dice: 1 Mage, 1 Priest, 3 Warrior. Discard 2; the remaining ≤3 dice
// each activate one matching-kind unit (so at most 3 units act per turn).
const DIE_KINDS: DieKind[] = ['mage', 'priest', 'warrior', 'warrior', 'warrior'];
const DISCARDS = 2;

export function rollDice(state: GameState, rng: RNG = defaultRng): GameState {
  if (state.turnPhase !== 'roll') return state;
  const dice: Die[] = DIE_KINDS.map((kind) => ({
    id: `die-${dieCounter++}`,
    value: dN(6, rng),
    kind,
    discarded: false,
    usedBy: null,
  }));
  return {
    ...state,
    dice,
    turnPhase: 'discard',
    log: [...state.log, `${state.current} rolled 5 dice. Discard two.`],
  };
}

export function discardsLeft(state: GameState): number {
  return DISCARDS - state.dice.filter((d) => d.discarded).length;
}

/** Replace die values with the physically-rolled results (by order). */
export function setRolledValues(state: GameState, values: number[]): GameState {
  let i = 0;
  return { ...state, dice: state.dice.map((d) => ({ ...d, value: values[i++] ?? d.value })) };
}

export function discardDie(state: GameState, dieId: string): GameState {
  if (state.turnPhase !== 'discard') return state;
  const die = state.dice.find((d) => d.id === dieId);
  if (!die || die.discarded) return state;
  const dice = state.dice.map((d) => (d.id === dieId ? { ...d, discarded: true } : d));
  const discarded = dice.filter((d) => d.discarded).length;
  const done = discarded >= DISCARDS;
  return {
    ...state,
    dice,
    turnPhase: done ? 'act' : 'discard',
    log: [...state.log, `${state.current} discards a ${die.value} (${die.kind} die).`],
  };
}

// ---- Dice / activation ---------------------------------------------------

export function availableDice(state: GameState): Die[] {
  return state.dice.filter((d) => !d.discarded && d.usedBy === null);
}

/** The die already spent activating this unit (from a move), if any. */
export function unitDie(state: GameState, unitId: string): Die | undefined {
  return state.dice.find((d) => d.usedBy === unitId);
}

/** A die may move/activate only its matching unit kind. */
export function canDieMoveUnit(die: Die, unit: Unit, state: GameState): boolean {
  if (unit.owner !== state.current) return false;
  if (state.unitsActedThisTurn.includes(unit.id)) return false;
  if (state.unitsMovedThisTurn.includes(unit.id)) return false;
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
    resolveRespawns({
      ...state,
      units: state.units.map((u) =>
        u.id === unitId ? { ...u, prevCell: u.cell, cell: dest } : u,
      ),
      dice: state.dice.map((d) => (d.id === dieId ? { ...d, usedBy: unitId } : d)),
      unitsMovedThisTurn: [...state.unitsMovedThisTurn, unitId],
    }),
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

/** Spend a matching-kind die on this unit's action (reuse its move die if any). */
function spendActionDie(state: GameState, unitId: string): Die[] | null {
  const existing = unitDie(state, unitId);
  if (existing) return state.dice;
  const unit = unitById(state, unitId);
  if (!unit) return null;
  const free = availableDice(state).find((d) => d.kind === unit.kind);
  if (!free) return null;
  return state.dice.map((d) => (d.id === free.id ? { ...d, usedBy: unitId } : d));
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
 * Mage attacks with its power die. Because combat
 * **rerolls any draw** (see `resolveAttack`), the odds are conditioned on a
 * decisive result: P(win | not draw) = win / (win + lose). `draw` is therefore
 * always 0 here — kept in the shape for compatibility.
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
      // a === d is a draw → rerolled, so it doesn't contribute to either side.
    }
  }
  // Renormalise over decisive outcomes (draws are rerolled away).
  const decisive = win + lose;
  if (decisive === 0) return { win: 0, draw: 0, lose: 0 };
  return { win: win / decisive, draw: 0, lose: lose / decisive };
}

/**
 * Resolve an attack by one or more attackers on a target. Warriors combine
 * (n d6); a lone Mage rolls its power die. Defender always rolls 1d6. Higher
 * wins; draw wastes the action; on a loss exactly one attacker falls.
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

  // Roll attack vs the defender's die, rerolling any **draw** so combat is always
  // decisive (a tie is silently re-rolled — the UI only ever sees a win or loss).
  // A defending Mage rolls its own power die (d12/d20 by activated stones), not a
  // d6 — so a powered-up Mage is much harder to kill.
  const attackFaces = isMage ? magePowerDie(attackers[0].activated) : 6;
  const defenseFaces = target.kind === 'mage' ? magePowerDie(target.activated) : 6;
  let attackDice: number[];
  let attackRoll: number;
  let defenseRoll: number;
  do {
    attackDice = isMage
      ? [dN(attackFaces, rng)]
      : Array.from({ length: attackers.length }, () => dN(6, rng));
    attackRoll = attackDice.reduce((a, b) => a + b, 0);
    defenseRoll = dN(defenseFaces, rng);
  } while (attackRoll === defenseRoll);

  // Highest roll wins; the loser is defeated outright. (Draws never reach here.)
  let outcome: CombatResult['outcome'];
  let defeatedId: string | null = null;
  let next: GameState = {
    ...state,
    dice,
    unitsActedThisTurn: attackers.reduce((acc, a) => {
      return acc.includes(a.id) ? acc : [...acc, a.id];
    }, state.unitsActedThisTurn),
  };

  if (attackRoll > defenseRoll) {
    outcome = 'win';
    defeatedId = target.id;
    next = bumpKill(defeatUnit(next, target.id), state.current);
  } else {
    // attackRoll < defenseRoll (equality was rerolled away above). A Priest never
    // kills its attacker — winning its defence simply repels the attack and both
    // units stay put. Any other defender defeats exactly one attacker.
    outcome = 'lose';
    if (target.kind !== 'priest') {
      defeatedId = attackers[0].id; // coordinated: only one attacker falls
      next = bumpKill(defeatUnit(next, attackers[0].id), target.owner);
    }
  }

  const combat: CombatResult = {
    attackerIds,
    defenderId: targetId,
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
    // A Warrior leaves one Gravestone where it fell — but only if the shared bank
    // still has a marker, the square has no gravestone already (no stacking), and
    // it isn't a Nexus square.
    const blocked = !!graveAt(state, unit.cell) || inNexus(unit.cell.r, unit.cell.c);
    let gravestones = state.gravestones;
    if (gravestoneBank(state) > 0 && !blocked) {
      gravestones = [...gravestones, { id: `grave-${graveCounter++}`, cell: unit.cell }];
      log.push(`${unit.owner}'s Warrior falls — a Gravestone marks the square.`);
    } else {
      log.push(`${unit.owner}'s Warrior falls (no Gravestone placed).`);
    }
    return { ...state, units, gravestones, log };
  }

  if (unit.kind === 'priest') {
    log.push(`${unit.owner}'s Priest is slain.`);
    const ritual = state.ritual?.priestId === unitId ? null : state.ritual;
    const base = { ...state, units, ritual, log };
    return respawnOrQueue(base, unit.owner, 'priest', unit.id, log, 0);
  }

  // Mage: drop all unactivated + 1 activated stone; keep the remaining activated
  // stones, which return with the Mage when it respawns. The dropped activated
  // stone is flagged so it shows gold on the board.
  const droppedActivated = unit.activated > 0 ? 1 : 0;
  const retainedActivated = unit.activated - droppedActivated;
  const dropCount = unit.carried + droppedActivated;
  const dropped: MageStone[] = [
    ...Array.from({ length: unit.carried }, () => ({
      id: `stone-${stoneCounter++}`,
      cell: unit.cell,
      collected: false,
    })),
    ...Array.from({ length: droppedActivated }, () => ({
      id: `stone-${stoneCounter++}`,
      cell: unit.cell,
      collected: false,
      activated: true,
    })),
  ];
  log.push(`${unit.owner}'s Mage is struck down, scattering ${dropCount} MageStone(s).`);

  const base = { ...state, units, stones: [...state.stones, ...dropped], log };
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
  const here = stonesAt(state, unit.cell);
  const ids = new Set(here.map((s) => s.id));
  // Already-activated (gold) stones a slain Mage dropped stay activated when
  // re-collected; plain (silver) stones become carried (need activating on base).
  const gainedActivated = here.filter((s) => s.activated).length;
  const gainedCarried = here.length - gainedActivated;
  const note = gainedActivated > 0 ? ` (${gainedActivated} already activated)` : '';
  return checkVictory({
    ...state,
    dice,
    stones: state.stones.map((s) => (ids.has(s.id) ? { ...s, collected: true } : s)),
    units: state.units.map((u) =>
      u.id === unitId
        ? { ...u, carried: u.carried + gainedCarried, activated: u.activated + gainedActivated }
        : u,
    ),
    unitsActedThisTurn: markActed(state, unitId),
    log: [...state.log, `${unit.owner}'s Mage collects ${here.length} MageStone(s)${note}.`],
  });
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
  const moved = unit.carried;
  return checkVictory({
    ...state,
    dice,
    units: state.units.map((u) =>
      u.id === unitId ? { ...u, carried: 0, activated: u.activated + moved } : u,
    ),
    unitsActedThisTurn: markActed(state, unitId),
    log: [
      ...state.log,
      `${unit.owner}'s Mage activates ${moved} MageStone(s) (now ${unit.activated + moved}).`,
    ],
  });
}

// ---- Priest actions: resurrect / ritual ----------------------------------

export function canResurrect(state: GameState, unitId: string): boolean {
  const u = unitById(state, unitId);
  if (!u || u.kind !== 'priest' || !canAct(state, unitId)) return false;
  if (!graveAt(state, u.cell)) return false;
  if (warriorCount(state, u.owner) >= MAX_WARRIORS) return false;
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
  return {
    ...state,
    dice,
    gravestones: state.gravestones.filter((g) => g.id !== grave.id),
    units: [
      ...state.units.map((u) => (u.id === unitId ? { ...u, cell: back } : u)),
      newWarrior,
    ],
    unitsActedThisTurn: markActed(state, unitId),
    log: [...state.log, `${priest.owner}'s Priest resurrects a Warrior.`],
  };
}

function nexusClearOfEnemies(state: GameState, owner: PlayerColor): boolean {
  return NEXUS_CELLS.every((cell) => {
    const u = unitAt(state, cell);
    return !u || u.owner === owner;
  });
}

export function canRitual(state: GameState, unitId: string): boolean {
  const u = unitById(state, unitId);
  if (!u || u.kind !== 'priest' || !canAct(state, unitId)) return false;
  if (!inNexus(u.cell.r, u.cell.c)) return false;
  if (state.ritual) return false;
  return nexusClearOfEnemies(state, u.owner);
}

export function beginRitual(state: GameState, unitId: string): GameState {
  if (!canRitual(state, unitId)) return state;
  const priest = unitById(state, unitId)!;
  const dice = spendActionDie(state, unitId);
  if (!dice) return state;
  return {
    ...state,
    dice,
    ritual: { player: priest.owner, priestId: unitId },
    unitsActedThisTurn: markActed(state, unitId),
    log: [...state.log, `${priest.owner}'s Priest begins the Ritual in the Nexus!`],
  };
}

// ---- Victory -------------------------------------------------------------

export function checkVictory(state: GameState): GameState {
  if (state.winner) return state;

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

export function endTurn(state: GameState): GameState {
  if (state.winner) return state;
  // Pass clockwise, skipping eliminated players (they take no more turns).
  const idx = state.players.indexOf(state.current);
  let next = state.current;
  for (let hop = 1; hop <= state.players.length; hop++) {
    const cand = state.players[(idx + hop) % state.players.length];
    if (!state.eliminated.includes(cand)) {
      next = cand;
      break;
    }
  }

  // A new round begins when play wraps back to an earlier (or the same) player
  // in the clockwise order — robust to eliminated players being skipped.
  const wrapped = state.players.indexOf(next) <= idx;
  let s: GameState = resolveRespawns({
    ...state,
    current: next,
    turn: state.turn + (wrapped ? 1 : 0),
    turnPhase: 'roll',
    dice: [],
    unitsMovedThisTurn: [],
    unitsActedThisTurn: [],
    lastCombat: null,
    log: [...state.log, `— ${next}'s turn. Roll the dice.`],
  });

  // Ritual victory: play has returned to the ritual player with the Priest still
  // holding a clear Nexus.
  if (s.ritual && s.ritual.player === next) {
    const priest = unitById(s, s.ritual.priestId);
    const valid =
      priest &&
      inNexus(priest.cell.r, priest.cell.c) &&
      nexusClearOfEnemies(s, s.ritual.player);
    if (valid) {
      return {
        ...s,
        winner: next,
        winMethod: 'Ritual',
        log: [...s.log, `${next} completes the Ritual and wins!`],
      };
    }
    s = { ...s, ritual: null, log: [...s.log, `${next}'s Ritual was broken.`] };
  } else if (s.ritual) {
    // Interrupted by an enemy entering the Nexus, or the Priest leaving/dying.
    const priest = unitById(s, s.ritual.priestId);
    const valid =
      priest &&
      inNexus(priest.cell.r, priest.cell.c) &&
      nexusClearOfEnemies(s, s.ritual.player);
    if (!valid) s = { ...s, ritual: null, log: [...s.log, `The Ritual was broken.`] };
  }

  return s;
}

/** Whether the current player has any remaining move/action this turn. */
export function hasPlayLeft(state: GameState): boolean {
  if (state.turnPhase !== 'act') return false;
  return state.units.some(
    (u) =>
      u.owner === state.current &&
      (canAct(state, u.id) || (!state.unitsMovedThisTurn.includes(u.id) && !!unitDie(state, u.id))),
  );
}
