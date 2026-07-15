// AI opponents. Pure decision functions over GameState — no React, no store, no
// side effects. The UI's BotDriver asks "what next?" one step at a time (one
// discard, one move, one action per call) and executes the answer through the
// same store actions a human uses, so bots stay engine-legal by construction.
//
// Three difficulties:
//   easy   — mostly random: wanders, only takes obvious opportunities.
//   medium — greedy objectives: collects/activates stones, decent attacks,
//            resurrections, marches units somewhere useful.
//   hard   — a SEARCH BRAIN. It plans several plays ahead through the pure
//            engine: candidate plays are simulated for real (move → collect →
//            activate chains, coordinated attacks, sorcery), combats branch
//            into win/lose futures weighted by their true odds (expectimax),
//            and every end position is scored by a positional evaluation that
//            prices in the opponent's best likely reply. Discards are chosen
//            by test-planning the turn with each possible keep-set of dice.
//
// NO CHEATING: the brain sees exactly what a human sees — the board and its
// own already-rolled dice. Future rolls are handled as probabilities, never
// peeked (hypothetical combat branches are built with rigged RNGs on scratch
// states; the live game still rolls real dice). It acts only through the same
// legal, engine-validated plays a human has.

import {
  MAX_WARRIORS,
  STONES_TO_WIN,
  activate,
  attackTargets,
  availableDice,
  beginRitual,
  boltTargets,
  canAct,
  canActivate,
  canBolt,
  canCollect,
  canDieMoveUnit,
  canNova,
  canResurrect,
  canRitual,
  collect,
  combatOdds,
  discardDie,
  graveAt,
  legalMoves,
  magePowerDie,
  moveUnit,
  novaVictims,
  plannedAttackers,
  resolveAttack,
  resolveBolt,
  resolveNova,
  resurrect,
  stonesAt,
  unitById,
  warriorCount,
} from './rules';
import { NEXUS_CELLS, allCells, edgeRotation, sameCell } from './board';
import type { Cell, Die, GameState, PlayerColor, Unit, UnitKind } from './types';

export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];
export const BOT_LABEL: Record<BotLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** One step of a bot's act phase. `null` = nothing worth doing → end the turn. */
export type BotAction =
  | { type: 'move'; unitId: string; dieId: string; dest: Cell }
  | { type: 'attack'; unitId: string; targetId: string }
  | { type: 'bolt'; unitId: string; targetId: string }
  | { type: 'nova'; unitId: string }
  | { type: 'collect' | 'activate' | 'resurrect' | 'ritual'; unitId: string };

interface Cfg {
  eps: number; // chance of picking a random candidate instead of the best
  atkOdds: number; // minimum win chance to consider an attack at all
  plan: boolean; // seek objectives (stones, base runs, nexus) when moving
  avoid: boolean; // penalise walking soft units next to enemies
  endBar: number; // candidates scoring below this end the turn instead
}
const CFG: Record<BotLevel, Cfg> = {
  easy: { eps: 0.5, atkOdds: 0.4, plan: false, avoid: false, endBar: 8 },
  // medium learned self-preservation and spends its dice rather than passing.
  medium: { eps: 0.15, atkOdds: 0.55, plan: true, avoid: true, endBar: 12 },
  // hard's cfg feeds candidate GENERATION (move ordering for the search);
  // its final choices come from the search, not from eps/endBar.
  hard: { eps: 0, atkOdds: 0.45, plan: true, avoid: true, endBar: 8 },
};

const manhattan = (a: Cell, b: Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
const minDist = (from: Cell, targets: Cell[]) =>
  targets.length ? Math.min(...targets.map((t) => manhattan(from, t))) : 99;

/** A player's 8 base cells (their home edge, resolved through seats). Cached
 *  per seat — the search evaluates thousands of positions per decision. */
const baseCache = new Map<number, Cell[]>();
function baseCells(state: GameState, player: PlayerColor): Cell[] {
  const seat = state.seats[player];
  let cells = baseCache.get(seat);
  if (!cells) {
    cells = allCells().filter((c) => edgeRotation(c.r, c.c) === seat);
    baseCache.set(seat, cells);
  }
  return cells;
}

// ---- Probability toolkit ---------------------------------------------------

/** P(win | not draw) for n summed d6 vs one defender die — the engine's combat
 *  maths in miniature, used to score attack set-ups before the move is made. */
const quickOddsCache = new Map<number, number>();
function quickOdds(nd6: number, defFaces: number): number {
  const key = nd6 * 100 + defFaces;
  const hit = quickOddsCache.get(key);
  if (hit !== undefined) return hit;
  let dist = new Map<number, number>([[0, 1]]);
  for (let k = 0; k < nd6; k++) {
    const next = new Map<number, number>();
    for (const [s, p] of dist) for (let v = 1; v <= 6; v++) next.set(s + v, (next.get(s + v) ?? 0) + p / 6);
    dist = next;
  }
  let win = 0;
  let lose = 0;
  for (const [a, pa] of dist) {
    for (let d = 1; d <= defFaces; d++) {
      const p = pa / defFaces;
      if (a > d) win += p;
      else if (a < d) lose += p;
    }
  }
  const dec = win + lose;
  const odds = dec > 0 ? win / dec : 0;
  quickOddsCache.set(key, odds);
  return odds;
}

/** P(win | not draw) for one aF-faced die against one dF-faced die (duels). */
const faceOddsCache = new Map<number, number>();
function faceOdds(aF: number, dF: number): number {
  const key = aF * 100 + dF;
  const hit = faceOddsCache.get(key);
  if (hit !== undefined) return hit;
  let win = 0;
  let lose = 0;
  for (let a = 1; a <= aF; a++)
    for (let d = 1; d <= dF; d++) {
      if (a > d) win++;
      else if (a < d) lose++;
    }
  const dec = win + lose;
  const odds = dec > 0 ? win / dec : 0;
  faceOddsCache.set(key, odds);
  return odds;
}

/** Chance a unit can cover `steps` squares on its owner's NEXT turn with dice
 *  it hasn't rolled yet: warriors pick the best of three warrior dice, mage /
 *  priest get one die each (which might also be discarded — hence the trim).
 *  Blocking is ignored; the slight overestimate keeps the bot cautious. */
function reachProb(kind: UnitKind, steps: number): number {
  if (steps <= 0) return 1;
  if (steps > 6) return 0;
  const single = (7 - steps) / 6;
  if (kind === 'warrior') return 1 - Math.pow(1 - single, 3);
  return single * 0.92;
}

/** How much killing this unit is worth (breaking a live ritual dwarfs all). */
function targetValue(state: GameState, t: Unit): number {
  const base = t.kind === 'mage' ? 34 + t.activated * 8 + t.carried * 4 : t.kind === 'priest' ? 22 : 12;
  return base + (state.ritual && state.ritual.priestId === t.id ? 60 : 0);
}

/** Enemies orthogonally adjacent to a cell (threat when parking a soft unit). */
function adjacentEnemies(state: GameState, cell: Cell, me: PlayerColor): number {
  return state.units.filter(
    (u) => u.owner !== me && Math.abs(u.cell.r - cell.r) + Math.abs(u.cell.c - cell.c) === 1,
  ).length;
}

// ---- Discard phase ---------------------------------------------------------

/** Per-die usefulness scorer shared by the medium heuristic and (as a combo
 *  ordering hint) the hard planner. */
function dieUsefulness(state: GameState, level: BotLevel): (d: Die) => number {
  const me = state.current;
  const mine = state.units.filter((u) => u.owner === me);
  const mage = mine.find((u) => u.kind === 'mage');
  const priest = mine.find((u) => u.kind === 'priest');
  const warriors = mine.filter((u) => u.kind === 'warrior');
  const stones = state.stones.filter((s) => !s.collected).map((s) => s.cell);
  const enemies = state.units.filter((u) => u.owner !== me).map((u) => u.cell);
  const graves = state.gravestones.map((g) => g.cell);
  const home = baseCells(state, me);

  return (d: Die): number => {
    if (d.kind === 'mage') {
      if (!mage) return 0;
      let s = 4 + d.value * 0.3;
      if (minDist(mage.cell, stones) <= d.value) s += 5;
      if (mage.carried > 0) s += minDist(mage.cell, home) <= d.value ? 6 : 3;
      // a mage die is also BOLT range — keep it when sorcery is on the table
      if (level === 'hard' && mage.activated >= 1) {
        const inRange = state.units.filter(
          (x) => x.owner !== me && manhattan(x.cell, mage.cell) <= d.value,
        ).length;
        if (inRange) s += 4 + Math.min(2, inRange);
      }
      return s;
    }
    if (d.kind === 'priest') {
      if (!priest) return 0;
      let s = 2.5 + d.value * 0.2;
      if (graves.length && warriorCount(state, me) < MAX_WARRIORS && minDist(priest.cell, graves) <= d.value) s += 5;
      if (minDist(priest.cell, NEXUS_CELLS) <= d.value) s += 3;
      return s;
    }
    if (!warriors.length) return 0;
    const near = Math.min(...warriors.map((w) => minDist(w.cell, enemies)));
    return 3 + d.value * 0.35 + (near <= d.value + 1 ? 2.5 : 0);
  };
}

/** All k-element subsets of `ids` (k is 1 or 2 in practice). */
function kSubsets(ids: string[], k: number): string[][] {
  if (k <= 0) return [[]];
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i++) {
    if (k === 1) out.push([ids[i]]);
    else for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  }
  return out;
}

/** Hard's discard plan for the current roll, cached so both discard steps of a
 *  turn agree (die ids are unique per roll, so the key never collides). */
let discardPlan: { key: string; ids: string[] } | null = null;

/** The next die to throw away (one per call; the driver re-asks until the
 *  engine flips the phase). Medium scores each die by what its unit could
 *  plausibly do with it; hard test-plans the turn with every keep-set and
 *  discards its way to the best one. */
export function chooseDiscard(state: GameState, level: BotLevel): string | null {
  if (state.turnPhase !== 'discard') return null;
  const live = state.dice.filter((d) => !d.discarded);
  if (live.length <= 3) return null;
  if (level === 'easy') return live[(Math.random() * live.length) | 0].id;

  if (level === 'hard') {
    try {
      const key = `${state.turn}:${state.current}:${state.dice.map((d) => d.id).join(',')}`;
      if (discardPlan?.key !== key) {
        const sr: Search = { deadline: performance.now() + SEARCH_BUDGET_MS * 1.3 };
        const usefulness = dieUsefulness(state, level);
        const byId = new Map(live.map((d) => [d.id, usefulness(d)]));
        // Try discarding every pair; most promising combos (dropping the least
        // useful dice) go first so a deadline cut still leaves a good plan.
        const combos = kSubsets(live.map((d) => d.id), live.length - 3).sort(
          (a, b) =>
            a.reduce((s, id) => s + (byId.get(id) ?? 0), 0) -
            b.reduce((s, id) => s + (byId.get(id) ?? 0), 0),
        );
        let best = combos[0];
        let bestV = -Infinity;
        for (const combo of combos) {
          let s2: GameState = state;
          for (const id of combo) s2 = discardDie(s2, id);
          const v = turnValue(s2, state.current, 2, sr);
          if (v > bestV) {
            bestV = v;
            best = combo;
          }
          if (performance.now() > sr.deadline) break;
        }
        discardPlan = { key, ids: best };
      }
      const next = discardPlan.ids.find((id) => live.some((d) => d.id === id));
      if (next) return next;
    } catch {
      /* fall through to the heuristic — never let the planner stall a turn */
    }
  }

  return heuristicDiscard(state, level);
}

/** The pre-search discard rule: throw the least useful die (medium's chooser,
 *  hard's fallback, and the arena's A/B baseline). */
function heuristicDiscard(state: GameState, level: BotLevel): string | null {
  const live = state.dice.filter((d) => !d.discarded);
  if (live.length <= 3) return null;
  const usefulness = dieUsefulness(state, level);
  return [...live].sort((a, b) => usefulness(a) - usefulness(b))[0].id;
}

// ---- Candidate generation (all levels; move ordering for the search) -------

interface Cand {
  a: BotAction;
  score: number;
}

/** Every play worth considering, scored by the fast heuristic. Easy/medium
 *  pick straight from this list; hard uses it to ORDER its search. */
function candidateActions(state: GameState, level: BotLevel): Cand[] {
  if (state.turnPhase !== 'act' || state.winner) return [];
  const cfg = CFG[level];
  const me = state.current;
  const mine = state.units.filter((u) => u.owner === me);
  const enemies = state.units.filter((u) => u.owner !== me);
  const stones = state.stones.filter((s) => !s.collected).map((s) => s.cell);
  const home = baseCells(state, me);
  // deterministic wander for hard: the search needs stable candidate order
  const wander = level === 'hard' ? () => 4 : () => Math.random() * 8;
  // An enemy ritual in progress is an emergency — one enemy unit standing in
  // the Nexus breaks it, so planning bots drop everything and rush it.
  const enemyRitual = !!state.ritual && state.ritual.player !== me;
  const cands: Cand[] = [];

  for (const u of mine) {
    if (canAct(state, u.id)) {
      if (canActivate(state, u.id)) cands.push({ a: { type: 'activate', unitId: u.id }, score: 95 + u.carried * 4 });
      if (canCollect(state, u.id)) cands.push({ a: { type: 'collect', unitId: u.id }, score: 90 + stonesAt(state, u.cell).length * 4 });
      if (canResurrect(state, u.id)) cands.push({ a: { type: 'resurrect', unitId: u.id }, score: 80 });
      if (canRitual(state, u.id)) {
        // Hard re-values this in search (ritual survival odds); the distance
        // gate here is medium's judgement and hard's ordering hint.
        const near = Math.min(99, ...enemies.map((e) => minDist(e.cell, NEXUS_CELLS)));
        cands.push({
          a: { type: 'ritual', unitId: u.id },
          score: level === 'hard' ? (near >= 5 ? 97 : near >= 3 ? 68 : 26) : 75,
        });
      }
      for (const t of attackTargets(state, u.id)) {
        const ids = plannedAttackers(state, u.id, t.id);
        if (!ids.length) continue;
        const odds = combatOdds(state, ids, t.id).win;
        const value = targetValue(state, t);
        // hard trades on expected value; easy/medium use a flat odds floor
        if (odds < cfg.atkOdds && !(level === 'hard' && odds * value > 16)) continue;
        cands.push({ a: { type: 'attack', unitId: u.id, targetId: t.id }, score: odds * 70 + odds * value - 10 });
      }

      // ---- Mage sorcery (hard only): spend activated stones like a human ----
      if (level === 'hard' && u.kind === 'mage') {
        if (canBolt(state, u.id)) {
          for (const t of boltTargets(state, u.id)) {
            const value = targetValue(state, t);
            let score: number;
            if (t.kind === 'mage') {
              // duel: power die vs power die — only worth it against fat mages
              const odds = faceOdds(magePowerDie(u.activated), magePowerDie(t.activated));
              score = odds * value - 14;
            } else {
              // guaranteed kill for one stone
              score = 22 + value * 0.9;
            }
            // one stone from the win? don't burn it on small game
            if (u.activated >= 5 && value < 60) score -= 30;
            cands.push({ a: { type: 'bolt', unitId: u.id, targetId: t.id }, score });
          }
        }
        if (canNova(state, u.id)) {
          const vs = novaVictims(state, u.id);
          let gain = 0;
          for (const v of vs) gain += v.owner === me ? -targetValue(state, v) * 1.1 : targetValue(state, v);
          // the classic human nova: cornered mage clears the mob around it
          const cornered = adjacentEnemies(state, u.cell, me);
          const score = gain - 26 + (cornered >= 2 ? cornered * 9 : 0);
          cands.push({ a: { type: 'nova', unitId: u.id }, score });
        }
      }
    }

    // ---- moves (a die of the unit's kind must be free, unit not yet used) ----
    if (state.unitsMovedThisTurn.includes(u.id) || state.unitsActedThisTurn.includes(u.id)) continue;
    const seen = new Set<number>();
    const dice = availableDice(state).filter(
      (d) => canDieMoveUnit(d, u, state) && !seen.has(d.value) && !!seen.add(d.value),
    );
    for (const die of dice) {
      const dests = legalMoves(state, u, die.value);
      for (const dest of dests) {
        let score: number;
        if (u.kind === 'mage') {
          const onStone = stonesAt(state, dest).length > 0;
          const onHome = home.some((c) => sameCell(c, dest));
          if (onStone) score = 86 + stonesAt(state, dest).length * 4;
          else if (u.carried > 0 && onHome) score = 84; // activate next step
          else if (cfg.plan && u.carried > 0) score = 34 + (minDist(u.cell, home) - minDist(dest, home)) * 6;
          else if (cfg.plan && stones.length) score = 28 + (minDist(u.cell, stones) - minDist(dest, stones)) * 6;
          else score = 8 + wander();
          if (cfg.avoid) {
            score -= adjacentEnemies(state, dest, me) * 22;
            // FLEE: a threatened mage runs — humans never leave the win
            // condition standing next to swords.
            const threatNow = adjacentEnemies(state, u.cell, me);
            const threatAfter = adjacentEnemies(state, dest, me);
            if (threatNow > 0 && threatAfter < threatNow) {
              score = Math.max(
                score,
                42 + (threatNow - threatAfter) * 10 + (u.carried + u.activated) * 3,
              );
            }
          }
        } else if (u.kind === 'priest') {
          const grave = graveAt(state, dest);
          const revivable = grave && warriorCount(state, me) < MAX_WARRIORS;
          const nexusDest = NEXUS_CELLS.some((c) => sameCell(c, dest));
          if (revivable) score = 82;
          else if (nexusDest && !state.ritual) score = 58;
          else if (cfg.plan && !state.ritual) score = 20 + (minDist(u.cell, NEXUS_CELLS) - minDist(dest, NEXUS_CELLS)) * 4;
          else score = 6 + wander();
          if (cfg.avoid) {
            score -= adjacentEnemies(state, dest, me) * 20;
            // FLEE: a cornered priest backs off (unless mid-ritual — it must hold).
            const holding = state.ritual?.priestId === u.id;
            const threatNow = adjacentEnemies(state, u.cell, me);
            if (!holding && threatNow > 0 && adjacentEnemies(state, dest, me) < threatNow) {
              score = Math.max(score, 38 + threatNow * 8);
            }
          }
        } else {
          // warrior: set up attacks, march on enemies, besiege empty thrones
          const adjTargets = enemies.filter((e) => manhattan(e.cell, dest) === 1);
          if (adjTargets.length) {
            const best = adjTargets.reduce((a, b) => (targetValue(state, a) >= targetValue(state, b) ? a : b));
            const allies = mine.filter(
              (w) => w.kind === 'warrior' && w.id !== u.id && manhattan(w.cell, best.cell) === 1,
            ).length;
            const defFaces = best.kind === 'mage' ? (best.activated >= 4 ? 20 : best.activated >= 2 ? 12 : 6) : 6;
            const odds = quickOdds(Math.min(3, 1 + allies), defFaces);
            score = odds * 55 + odds * targetValue(state, best) * 0.8 - 4;
            // DISCIPLINE: humans don't dangle a lone warrior beside an enemy
            // warrior — it just gets coordinated to death on the reply.
            if (level === 'hard' && allies === 0 && best.kind === 'warrior') score -= 16;
          } else if (cfg.plan && enemies.length) {
            const cells = enemies.map((e) => e.cell);
            score = 12 + (minDist(u.cell, cells) - minDist(dest, cells)) * 3;
          } else {
            score = 5 + wander();
          }
          if (level === 'hard') {
            // Parking on a base that owes an enemy a respawn keeps them dead.
            for (const p of state.players) {
              if (p === me || !state.pendingRespawns.some((pr) => pr.owner === p)) continue;
              if (baseCells(state, p).some((c) => sameCell(c, dest))) score += 42;
            }
            // BODYGUARDS: while our own ritual burns, warriors ring the Nexus.
            if (state.ritual && state.ritual.player === me) {
              const nearNexus = NEXUS_CELLS.some((c) => manhattan(c, dest) === 1);
              if (nearNexus) score += 14;
            }
          }
        }
        // Ritual denial: any of our units standing in the Nexus breaks an enemy
        // ritual, so planning bots sprint for it the moment one begins.
        if (cfg.plan && enemyRitual && u.kind !== 'priest') {
          const breakIn = NEXUS_CELLS.some((c) => sameCell(c, dest))
            ? 92
            : 26 + (minDist(u.cell, NEXUS_CELLS) - minDist(dest, NEXUS_CELLS)) * 8;
          score = Math.max(score, breakIn);
        }
        if (score > 0) cands.push({ a: { type: 'move', unitId: u.id, dieId: die.id, dest }, score });
      }
    }
  }
  return cands;
}

// ---- Position evaluation (the search's judge) ------------------------------

const WIN = 1_000_000;

/** Search time budget per decision, ms. The DEV arena lowers this to mass-play
 *  games; live games keep the full think. */
let SEARCH_BUDGET_MS = 110;
export function setSearchBudget(ms: number): void {
  SEARCH_BUDGET_MS = ms;
}

/** Board worth of a unit on the evaluation scale. */
function worth(u: Unit): number {
  if (u.kind === 'mage') return 42 + u.activated * 13 + u.carried * 7;
  return u.kind === 'priest' ? 26 : 13;
}

/** Expected value of `vic`'s units that `atk` can destroy on their next turn:
 *  warrior gang-ups, mage melee and bolts, each discounted by the chance the
 *  attacker's unknown dice actually get it there. Only the best three
 *  opportunities count (a turn is three dice), with diminishing weight. */
function expectedDamage(state: GameState, atk: PlayerColor, vic: PlayerColor): number {
  const aUnits = state.units.filter((u) => u.owner === atk);
  const warriors = aUnits.filter((u) => u.kind === 'warrior');
  const mage = aUnits.find((u) => u.kind === 'mage');
  const items: number[] = [];
  for (const v of state.units) {
    if (v.owner !== vic) continue;
    const defFaces = v.kind === 'mage' ? magePowerDie(v.activated) : 6;
    const val = worth(v);
    if (warriors.length) {
      const reaches = warriors
        .map((w) => reachProb('warrior', manhattan(w.cell, v.cell) - 1))
        .filter((p) => p > 0.05)
        .sort((a, b) => b - a);
      if (reaches.length) {
        const n = Math.max(1, Math.min(3, Math.round(reaches[0] + (reaches[1] ?? 0) + (reaches[2] ?? 0))));
        items.push(reaches[0] * quickOdds(n, defFaces) * val);
      }
    }
    if (mage) {
      const pm = reachProb('mage', manhattan(mage.cell, v.cell) - 1);
      if (pm > 0.05) items.push(pm * faceOdds(magePowerDie(mage.activated), defFaces) * val);
      // bolt: range = the mage die's roll; only a mage can repel it
      if (mage.activated >= 1) {
        const d = manhattan(mage.cell, v.cell);
        if (d <= 6) {
          const pDie = ((7 - Math.max(1, d)) / 6) * 0.92;
          const kill =
            v.kind === 'mage' ? faceOdds(magePowerDie(mage.activated), magePowerDie(v.activated)) : 1;
          items.push(pDie * kill * Math.max(0, val - 8)); // −8: the spent stone lands back on the board
        }
      }
    }
  }
  items.sort((a, b) => b - a);
  return (items[0] ?? 0) + (items[1] ?? 0) * 0.75 + (items[2] ?? 0) * 0.5;
}

/** Is the ritual (if any) currently intact — priest alive, in the Nexus, no
 *  enemy standing on a Nexus cell? */
function ritualStands(state: GameState): boolean {
  const rit = state.ritual;
  if (!rit) return false;
  const priest = unitById(state, rit.priestId);
  if (!priest || !NEXUS_CELLS.some((c) => sameCell(c, priest.cell))) return false;
  return NEXUS_CELLS.every((c) => {
    const u = state.units.find((x) => sameCell(x.cell, c));
    return !u || u.owner === rit.player;
  });
}

/** Chance a standing ritual survives the coming round: every enemy must fail
 *  both to step into an open Nexus cell and to kill the Priest (melee or
 *  bolt). Open cells matter — a Nexus packed with the ritualist's own units
 *  can only be broken by killing through to the Priest. */
function ritualSurvival(state: GameState): number {
  const rit = state.ritual;
  const priest = rit && unitById(state, rit.priestId);
  if (!rit || !priest) return 0;
  const open = NEXUS_CELLS.filter((c) => !state.units.some((u) => sameCell(u.cell, c)));
  let survive = 1;
  for (const p of state.players) {
    if (p === rit.player || state.eliminated.includes(p)) continue;
    let fail = 1; // chance this enemy CANNOT break the ritual
    for (const u of state.units) {
      if (u.owner !== p) continue;
      if (open.length) {
        const d = Math.min(...open.map((c) => manhattan(u.cell, c)));
        fail *= 1 - reachProb(u.kind, d);
      }
      if (u.kind !== 'priest') {
        // melee the Priest (it defends d6; a repel leaves the ritual standing)
        const reach = reachProb(u.kind, manhattan(u.cell, priest.cell) - 1);
        const odds = u.kind === 'mage' ? faceOdds(magePowerDie(u.activated), 6) : quickOdds(1, 6);
        fail *= 1 - reach * odds;
      }
      if (u.kind === 'mage' && u.activated >= 1) {
        // bolt the Priest — unrepellable for a priest
        const d = manhattan(u.cell, priest.cell);
        if (d <= 6) fail *= 1 - ((7 - Math.max(1, d)) / 6) * 0.92;
      }
    }
    survive *= fail;
  }
  return survive;
}

/** One side's standing: material plus progress toward its win conditions. */
function sideScore(state: GameState, p: PlayerColor): number {
  const units = state.units.filter((u) => u.owner === p);
  let s = 0;
  for (const u of units) s += worth(u);

  const mage = units.find((u) => u.kind === 'mage');
  if (mage) {
    const dBase = minDist(mage.cell, baseCells(state, p));
    const total = mage.activated + mage.carried;
    if (mage.activated >= STONES_TO_WIN) {
      s += 900 - 45 * dBase; // walking home IS the win — a giant magnet
    } else if (total >= STONES_TO_WIN) {
      s += 380 - 20 * dBase; // get home, activate, win
    } else {
      const stoneCells = state.stones.filter((st) => !st.collected).map((st) => st.cell);
      if (stoneCells.length) s += 22 - 3 * Math.min(minDist(mage.cell, stoneCells), 7);
      if (mage.carried > 0) s += 10 - 2 * Math.min(dBase, 5);
    }
  } else {
    s -= 30; // mage off the board (queued respawn) — tempo and vulnerability
  }

  const priest = units.find((u) => u.kind === 'priest');
  if (priest) {
    if (state.gravestones.length && warriorCount(state, p) < MAX_WARRIORS) {
      s += 8 - 1.4 * Math.min(minDist(priest.cell, state.gravestones.map((g) => g.cell)), 6);
    }
    if (!state.ritual) s += 6 - 1.1 * Math.min(minDist(priest.cell, NEXUS_CELLS), 6);
  }

  // tempo: idle armies lose — a gentle pull keeps warriors advancing on the
  // foe (the threat/opportunity terms decide how CLOSE is wise).
  const foes = state.units.filter((u) => u.owner !== p);
  if (foes.length) {
    const fCells = foes.map((f) => f.cell);
    for (const u of units) {
      if (u.kind === 'warrior') s += Math.max(0, 10 - minDist(u.cell, fCells)) * 0.7;
    }
  }

  // fragility: a nearly-eliminated player lives one bad round from conquest
  if (units.length <= 2) s -= (3 - units.length) * 45;
  s -= state.pendingRespawns.filter((pr) => pr.owner === p).length * 24;
  return s;
}

/** The first still-active player after `after` in turn order, or null. */
function nextActivePlayer(state: GameState, after: PlayerColor): PlayerColor | null {
  const idx = state.players.indexOf(after);
  for (let hop = 1; hop < state.players.length; hop++) {
    const cand = state.players[(idx + hop) % state.players.length];
    if (!state.eliminated.includes(cand)) return cand;
  }
  return null;
}

/**
 * Full positional judgement of `state` from `me`'s seat, as if `me` ended the
 * turn here: my standing minus every rival's, minus what each rival's best
 * likely reply destroys (they move before I do again), plus a discounted read
 * of my own follow-up threats — the "think what they do next" half of the
 * bot's 3-4 step lookahead. Ritual positions collapse to near-terminal scores.
 */
function evaluate(state: GameState, me: PlayerColor): number {
  if (state.winner) return state.winner === me ? WIN : -WIN;
  if (state.eliminated.includes(me)) return -WIN * 0.8;
  const nextP = nextActivePlayer(state, me);
  let v = sideScore(state, me);
  for (const e of state.players) {
    if (e === me || state.eliminated.includes(e)) continue;
    const w = state.players.length === 2 || e === nextP ? 1 : 0.7;
    v -= sideScore(state, e);
    v -= w * expectedDamage(state, e, me);
    v += 0.45 * expectedDamage(state, me, e);
  }
  v += state.eliminated.filter((p) => p !== me).length * 200;

  if (state.ritual && ritualStands(state)) {
    if (state.ritual.player === me) {
      // Squared: a coin-flip ritual is a cheap lottery ticket that bleeds the
      // Priest — only near-unstoppable rituals should outshine the board game.
      const p = ritualSurvival(state);
      v += 5200 * p * p;
    } else {
      // If the ritualist plays next, nobody else gets a turn to break it —
      // ending our turn like this is close to losing outright.
      v -= state.ritual.player === nextP ? 6500 : 2600;
    }
  }
  return v;
}

// ---- Simulation (hypothetical futures — real games still roll real dice) ---

type Rng = () => number;
const HI = 0.999999; // rigs a die to its top face
const LO = 0; //         …and to a 1
function seqRng(vals: number[]): Rng {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
}

/**
 * The outcome states of playing `a`, with probabilities. Deterministic plays
 * return one state; combat splits into its decisive win/lose branches at the
 * true odds (rigged RNGs construct each branch — this is how the bot reasons
 * about luck WITHOUT peeking at any real roll). An engine-rejected play
 * returns the input state unchanged, which the search treats as illegal.
 */
function outcomes(state: GameState, a: BotAction): { p: number; s: GameState }[] {
  switch (a.type) {
    case 'move':
      return [{ p: 1, s: moveUnit(state, a.unitId, a.dieId, a.dest) }];
    case 'collect':
      return [{ p: 1, s: collect(state, a.unitId) }];
    case 'activate':
      return [{ p: 1, s: activate(state, a.unitId) }];
    case 'resurrect':
      return [{ p: 1, s: resurrect(state, a.unitId) }];
    case 'ritual':
      return [{ p: 1, s: beginRitual(state, a.unitId) }];
    case 'nova':
      // the blast itself is deterministic; the rng only scatters spent stones
      return [{ p: 1, s: resolveNova(state, a.unitId, () => 0.4999) }];
    case 'attack': {
      const ids = plannedAttackers(state, a.unitId, a.targetId);
      if (!ids.length) return [{ p: 1, s: state }];
      const pWin = combatOdds(state, ids, a.targetId).win;
      const win = resolveAttack(state, ids, a.targetId, seqRng([...ids.map(() => HI), LO]));
      const lose = resolveAttack(state, ids, a.targetId, seqRng([...ids.map(() => LO), HI]));
      return [
        { p: pWin, s: win },
        { p: 1 - pWin, s: lose },
      ];
    }
    case 'bolt': {
      const target = unitById(state, a.targetId);
      if (!target) return [{ p: 1, s: state }];
      if (target.kind !== 'mage') {
        return [{ p: 1, s: resolveBolt(state, a.unitId, a.targetId, seqRng([HI])) }];
      }
      const mage = unitById(state, a.unitId);
      if (!mage) return [{ p: 1, s: state }];
      const pWin = faceOdds(magePowerDie(mage.activated), magePowerDie(target.activated));
      return [
        { p: pWin, s: resolveBolt(state, a.unitId, a.targetId, seqRng([HI, HI, LO])) },
        { p: 1 - pWin, s: resolveBolt(state, a.unitId, a.targetId, seqRng([LO, LO, HI])) },
      ];
    }
  }
}

// ---- The search ------------------------------------------------------------
// Depth counts PLAYS within the bot's own turn (a move, an action…). Each leaf
// is judged by evaluate(), whose opponent-reply model extends the horizon a
// further step — so depth 4 reads as "my next few plays, then their answer".

interface Search {
  deadline: number;
}

/** Best achievable value for the REST of the current turn from `state`
 *  (ending the turn immediately is always on the table). */
function turnValue(state: GameState, me: PlayerColor, depth: number, sr: Search): number {
  if (state.winner) return state.winner === me ? WIN : -WIN;
  const here = evaluate(state, me);
  if (depth <= 0 || performance.now() > sr.deadline) return here;
  const cands = candidateActions(state, 'hard').sort((a, b) => b.score - a.score);
  const K = depth >= 3 ? 4 : depth === 2 ? 4 : 3;
  let best = here;
  for (const c of cands.slice(0, K)) {
    const v = actionValue(state, c.a, me, depth, sr);
    if (v > best) best = v;
    if (performance.now() > sr.deadline) break;
  }
  return best;
}

/** Expectimax value of one play: probability-weighted turnValue over its
 *  outcome branches. Unlikely branches get only a shallow look. */
function actionValue(state: GameState, a: BotAction, me: PlayerColor, depth: number, sr: Search): number {
  const outs = outcomes(state, a);
  let v = 0;
  for (const o of outs) {
    if (o.s === state) return -Infinity; // engine rejected the play — never pick it
    if (o.p <= 0.0005) continue;
    const d = outs.length > 1 && o.p < 0.25 ? Math.min(depth - 1, 1) : depth - 1;
    v += o.p * turnValue(o.s, me, d, sr);
  }
  return v;
}

/** Root shortlist: the best few plays PER UNIT, then the global best — so a
 *  quiet unit's crucial move (a mage flee, a warrior march) is never crowded
 *  out of the search by one loud unit's many options. */
function rootCandidates(cands: Cand[]): Cand[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const perUnit = new Map<string, number>();
  const picked: Cand[] = [];
  for (const c of sorted) {
    const n = perUnit.get(c.a.unitId) ?? 0;
    if (n >= 3) continue;
    perUnit.set(c.a.unitId, n + 1);
    picked.push(c);
    if (picked.length >= 14) break;
  }
  return picked;
}

/**
 * Hard's chooser: a two-pass, deadline-bounded search. Pass 1 gives every
 * shortlisted candidate a shallow (depth-2) look; pass 2 re-searches the best
 * survivors at full depth. The turn ends when nothing beats standing pat.
 */
function searchAction(state: GameState): BotAction | null {
  const me = state.current;
  const sr: Search = { deadline: performance.now() + SEARCH_BUDGET_MS };
  const cands = candidateActions(state, 'hard');
  if (!cands.length) return null;
  const endNow = evaluate(state, me);

  const pass1 = rootCandidates(cands).map((c) => ({ c, v: actionValue(state, c.a, me, 2, sr) }));
  pass1.sort((a, b) => b.v - a.v);

  let bestA: BotAction | null = null;
  let bestV = -Infinity;
  for (const e of pass1.slice(0, 6)) {
    if (e.v === -Infinity) continue;
    const v = performance.now() > sr.deadline ? e.v : actionValue(state, e.c.a, me, 4, sr);
    // a sliver of the fast heuristic breaks value ties toward human-shaped play
    const vv = v + e.c.score * 0.01;
    if (vv > bestV) {
      bestV = vv;
      bestA = e.c.a;
    }
  }
  // Dice don't carry over — on a measured tie, playing beats passing. Only
  // stand pat when every play is clearly WORSE than the current position.
  return bestA && bestV > endNow - 1 ? bestA : null;
}

// ---- Public chooser --------------------------------------------------------

/** The greedy one-ply brain (easy/medium's chooser, hard's safety net). */
function greedyAction(state: GameState, level: BotLevel): BotAction | null {
  if (state.turnPhase !== 'act' || state.winner) return null;
  const cfg = CFG[level];
  const cands = candidateActions(state, level);
  if (!cands.length) return null;
  if (Math.random() < cfg.eps) return cands[(Math.random() * cands.length) | 0].a;
  const best = cands.reduce((a, b) => (a.score >= b.score ? a : b));
  return best.score >= cfg.endBar ? best.a : null;
}

/** The bot's next play. Easy/medium pick greedily; hard runs the search brain
 *  (falling back to greedy if the search ever throws). `null` ends the turn. */
export function chooseAction(state: GameState, level: BotLevel): BotAction | null {
  if (state.turnPhase !== 'act' || state.winner) return null;
  if (level !== 'hard') return greedyAction(state, level);
  try {
    return searchAction(state);
  } catch {
    return greedyAction(state, 'hard');
  }
}

// DEV-only: expose the brain for the headless balance arena (tools/recorder).
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __bot?: object }).__bot = {
    chooseAction,
    chooseDiscard,
    greedyAction,
    heuristicDiscard,
    setSearchBudget,
    evaluate,
  };
}
