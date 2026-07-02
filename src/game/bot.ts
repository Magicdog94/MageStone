// AI opponents. Pure decision functions over GameState — no React, no store, no
// side effects. The UI's BotDriver asks "what next?" one step at a time (one
// discard, one move, one action per call) and executes the answer through the
// same store actions a human uses, so bots stay engine-legal by construction.
//
// Three difficulties:
//   easy   — mostly random: wanders, only takes obvious opportunities.
//   medium — greedy objectives: collects/activates stones, decent attacks,
//            resurrections, marches units somewhere useful.
//   hard   — medium plus threat avoidance, expected-value attacks, ritual
//            timing/denial, respawn sieges and no random slips.

import {
  MAX_WARRIORS,
  attackTargets,
  availableDice,
  canAct,
  canActivate,
  canCollect,
  canDieMoveUnit,
  canResurrect,
  canRitual,
  combatOdds,
  graveAt,
  legalMoves,
  plannedAttackers,
  stonesAt,
  warriorCount,
} from './rules';
import { NEXUS_CELLS, allCells, edgeRotation, sameCell } from './board';
import type { Cell, Die, GameState, PlayerColor, Unit } from './types';

export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];
export const BOT_LABEL: Record<BotLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** One step of a bot's act phase. `null` = nothing worth doing → end the turn. */
export type BotAction =
  | { type: 'move'; unitId: string; dieId: string; dest: Cell }
  | { type: 'attack'; unitId: string; targetId: string }
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
  medium: { eps: 0.15, atkOdds: 0.55, plan: true, avoid: false, endBar: 14 },
  hard: { eps: 0, atkOdds: 0.45, plan: true, avoid: true, endBar: 14 },
};

const manhattan = (a: Cell, b: Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
const minDist = (from: Cell, targets: Cell[]) =>
  targets.length ? Math.min(...targets.map((t) => manhattan(from, t))) : 99;

/** A player's 8 base cells (their home edge, resolved through seats). */
function baseCells(state: GameState, player: PlayerColor): Cell[] {
  const seat = state.seats[player];
  return allCells().filter((c) => edgeRotation(c.r, c.c) === seat);
}

/** P(win | not draw) for n summed d6 vs one defender die — the engine's combat
 *  maths in miniature, used to score attack set-ups before the move is made. */
function quickOdds(nd6: number, defFaces: number): number {
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
  return dec > 0 ? win / dec : 0;
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

/** The next die to throw away (one per call; the driver re-asks until the
 *  engine flips the phase). Scores each die by what its unit could plausibly do
 *  with it and discards the least useful. */
export function chooseDiscard(state: GameState, level: BotLevel): string | null {
  if (state.turnPhase !== 'discard') return null;
  const live = state.dice.filter((d) => !d.discarded);
  if (live.length <= 3) return null;
  if (level === 'easy') return live[(Math.random() * live.length) | 0].id;

  const me = state.current;
  const mine = state.units.filter((u) => u.owner === me);
  const mage = mine.find((u) => u.kind === 'mage');
  const priest = mine.find((u) => u.kind === 'priest');
  const warriors = mine.filter((u) => u.kind === 'warrior');
  const stones = state.stones.filter((s) => !s.collected).map((s) => s.cell);
  const enemies = state.units.filter((u) => u.owner !== me).map((u) => u.cell);
  const graves = state.gravestones.map((g) => g.cell);
  const home = baseCells(state, me);

  const usefulness = (d: Die): number => {
    if (d.kind === 'mage') {
      if (!mage) return 0;
      let s = 4 + d.value * 0.3;
      if (minDist(mage.cell, stones) <= d.value) s += 5;
      if (mage.carried > 0) s += minDist(mage.cell, home) <= d.value ? 6 : 3;
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
  return [...live].sort((a, b) => usefulness(a) - usefulness(b))[0].id;
}

// ---- Act phase -------------------------------------------------------------

interface Cand {
  a: BotAction;
  score: number;
}

/** The bot's next play — the highest-scoring candidate among direct actions
 *  (attack, collect, activate, resurrect, ritual) and purposeful moves, with
 *  difficulty-tuned thresholds and randomness. `null` ends the turn. */
export function chooseAction(state: GameState, level: BotLevel): BotAction | null {
  if (state.turnPhase !== 'act' || state.winner) return null;
  const cfg = CFG[level];
  const me = state.current;
  const mine = state.units.filter((u) => u.owner === me);
  const enemies = state.units.filter((u) => u.owner !== me);
  const stones = state.stones.filter((s) => !s.collected).map((s) => s.cell);
  const home = baseCells(state, me);
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
        // Hard only commits when no enemy can plausibly reach the Nexus in time.
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
          else score = 8 + Math.random() * 8;
          if (cfg.avoid) score -= adjacentEnemies(state, dest, me) * 22;
        } else if (u.kind === 'priest') {
          const grave = graveAt(state, dest);
          const revivable = grave && warriorCount(state, me) < MAX_WARRIORS;
          const nexusDest = NEXUS_CELLS.some((c) => sameCell(c, dest));
          if (revivable) score = 82;
          else if (nexusDest && !state.ritual) score = 58;
          else if (cfg.plan && !state.ritual) score = 20 + (minDist(u.cell, NEXUS_CELLS) - minDist(dest, NEXUS_CELLS)) * 4;
          else score = 6 + Math.random() * 8;
          if (cfg.avoid) score -= adjacentEnemies(state, dest, me) * 20;
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
          } else if (cfg.plan && enemies.length) {
            const cells = enemies.map((e) => e.cell);
            score = 12 + (minDist(u.cell, cells) - minDist(dest, cells)) * 3;
          } else {
            score = 5 + Math.random() * 8;
          }
          if (level === 'hard') {
            // Parking on a base that owes an enemy a respawn keeps them dead.
            for (const p of state.players) {
              if (p === me || !state.pendingRespawns.some((pr) => pr.owner === p)) continue;
              if (baseCells(state, p).some((c) => sameCell(c, dest))) score += 42;
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

  if (!cands.length) return null;
  if (Math.random() < cfg.eps) return cands[(Math.random() * cands.length) | 0].a;
  const best = cands.reduce((a, b) => (a.score >= b.score ? a : b));
  return best.score >= cfg.endBar ? best.a : null;
}
