// The tutorial SWEEP: for every hands-on task, play every interaction its
// guardrails allow — every selectable unit, every die it could take, every
// square that glows, every allowed action, each fight both ways unless its dice
// are scripted — in every order, and prove that from EVERY position a player
// can reach, the task can still be finished. Tasks that carry on from the
// previous task's board are checked from every way that task could end.

import { describe, expect, it } from 'vitest';
import { sameCell } from '../../game/board';
import {
  activate,
  attackTargets,
  beginRitual,
  boltTargets,
  canBolt,
  collect,
  endActivation,
  gameOver,
  legalMoves,
  moveUnit,
  movesLeft,
  plannedAttackers,
  resolveAttack,
  resolveBolt,
  resolveNova,
  resurrect,
} from '../../game/rules';
import type { GameState } from '../../game/types';
import { TUT_LOCK, tutAllows, type TutRestrict } from './restrict';
import {
  MOVE_RESTRICT,
  SIEGE_DOOR,
  TASKS,
  afterSiegeLaid,
  ritualBeat,
  stagedGame,
  type TaskSpec,
} from './tutorialTasks';

const HI = 0.999999; // a die's top face
const LO = 0; //         …and a 1
const seqRng = (vals: number[]) => {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
};

/**
 * Every interaction a PLAYER can complete under `r`, mirroring the store's
 * guards (store.ts: roll, selectUnit/selectDie/moveTo, attack — HUD buttons
 * and board clicks — castBolt, castNova, collectStones, activateStones,
 * doResurrect, doRitual, endActivation). Returns only interactions that change
 * the board.
 */
function gestures(st: GameState, r: TutRestrict): GameState[] {
  const out: GameState[] = [];
  const add = (next: GameState) => {
    if (next !== st) out.push(next);
  };
  if (gameOver(st)) return out;
  const squares = movesLeft(st, st.current);
  const units = st.units.filter((u) => u.owner === st.current && (!r.units || r.units.includes(u.id)));
  for (const u of units) {
    // Moves: every square this unit's share of the round's allowance reaches,
    // that the task allows to glow.
    if (squares > 0) {
      for (const c of legalMoves(st, u, squares)) {
        if (r.dests && !r.dests.some((x) => sameCell(x, c))) continue;
        add(moveUnit(st, u.id, '', c));
      }
    }
    if (tutAllows(r, 'attack') && u.kind !== 'priest') {
      for (const t of attackTargets(st, u.id)) {
        if (r.targets && !r.targets.includes(t.id)) continue;
        const planned = plannedAttackers(st, u.id, t.id);
        // every coordination size the action bar or a board click can launch
        for (let n = r.minAttackers ?? 1; n <= planned.length; n++) {
          const ids = planned.slice(0, n);
          const rolls = r.rig ? [r.rig] : [[...ids.map(() => HI), LO], [...ids.map(() => LO), HI]];
          for (const roll of rolls) add(resolveAttack(st, ids, t.id, seqRng(roll)));
        }
      }
    }
    if (tutAllows(r, 'bolt') && canBolt(st, u.id)) {
      for (const t of boltTargets(st, u.id)) {
        if (r.targets && !r.targets.includes(t.id)) continue;
        for (const roll of [[HI, LO], [LO, HI]]) add(resolveBolt(st, u.id, t.id, seqRng(roll)));
      }
    }
    if (tutAllows(r, 'nova')) add(resolveNova(st, u.id));
    if (tutAllows(r, 'collect')) add(collect(st, u.id));
    if (tutAllows(r, 'activate')) add(activate(st, u.id));
    if (tutAllows(r, 'resurrect')) add(resurrect(st, u.id));
    if (tutAllows(r, 'ritual')) add(beginRitual(st, u.id));
  }
  if (tutAllows(r, 'endTurn')) add(endActivation(st));
  return out;
}

const DEPTH = 4; // no task takes more than two interactions; twice that is ample

/** Every position reachable from `start` within `depth` interactions. */
function reachable(start: GameState, r: TutRestrict, depth = DEPTH): GameState[] {
  const all = [start];
  let frontier = [start];
  for (let d = 0; d < depth; d++) {
    frontier = frontier.flatMap((s) => gestures(s, r));
    all.push(...frontier);
  }
  return all;
}

/** Can the task still be finished from `st` using only what it allows? */
function canFinish(st: GameState, spec: TaskSpec, depth = DEPTH): boolean {
  if (spec.done(st)) return true;
  if (depth === 0) return false;
  return gestures(st, spec.restrict).some((next) => canFinish(next, spec, depth - 1));
}

/** The core property: no position the player can reach is a dead end. */
function expectNoDeadEnds(start: GameState, spec: TaskSpec): GameState[] {
  const states = reachable(start, spec.restrict);
  const stuck = states.filter((s) => !canFinish(s, spec));
  expect(stuck).toHaveLength(0);
  return states;
}

describe('Tutorial sweep — no allowed move can strand the player', () => {
  for (const [name, spec] of Object.entries(TASKS) as [string, TaskSpec][]) {
    it(`${name}: finishable from every position its guardrails allow`, () => {
      const start = stagedGame(spec.build);
      expect(spec.done(start)).toBe(false); // it is a real task
      // A task can never be ended or undone out from under the lesson.
      expect(tutAllows(spec.restrict, 'endTurn')).toBe(false);
      expect(tutAllows(spec.restrict, 'undo')).toBe(false);
      expect(reachable(start, spec.restrict, 1).length).toBeGreaterThan(1); // the player CAN act
      expectNoDeadEnds(start, spec);
    });
  }

  it('the between-task lock allows nothing on any lesson board', () => {
    for (const spec of Object.values(TASKS) as TaskSpec[]) {
      expect(gestures(stagedGame(spec.build), TUT_LOCK)).toHaveLength(0);
    }
  });

  it('opening: the first free move is always available', () => {
    const start = stagedGame(() => {});
    const moves = gestures(start, MOVE_RESTRICT);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.unitsMovedThisTurn.length >= 1)).toBe(true);
    // and every one of them costs squares out of the round's allowance
    expect(moves.every((m) => movesLeft(m, 'red') < movesLeft(start, 'red'))).toBe(true);
  });

  it('siege: the siege can only be laid beside Blue’s guard, and Blue can always break it', () => {
    const laid = reachable(stagedGame(TASKS.siegeHold.build), TASKS.siegeHold.restrict).filter(
      TASKS.siegeHold.done,
    );
    expect(laid.length).toBeGreaterThan(0);
    for (const s of laid) {
      const blueTurn = afterSiegeLaid(s);
      expect(blueTurn.current).toBe('blue');
      const states = expectNoDeadEnds(blueTurn, TASKS.siegeBreak);
      // …and breaking it frees the queue, as the next note says
      for (const b of states.filter(TASKS.siegeBreak.done)) {
        expect(b.units.some((u) => u.owner === 'blue' && u.kind === 'mage')).toBe(true);
        expect(b.units.some((u) => u.owner === 'blue' && u.kind === 'priest')).toBe(true);
      }
    }
    // (the reported bug: (15,7) was also allowed, and left the intruder out of reach)
    for (const s of laid) expect(s.units.find((u) => u.id === 'red-w1')!.cell).toEqual(SIEGE_DOOR);
  });

  it('conquest: however the base is sealed, the last unit falls and Red wins', () => {
    const sealed = reachable(stagedGame(TASKS.win3Siege.build), TASKS.win3Siege.restrict).filter(
      TASKS.win3Siege.done,
    );
    expect(sealed.length).toBeGreaterThan(0);
    for (const s of sealed) {
      const states = expectNoDeadEnds(s, TASKS.win3Kill);
      for (const k of states.filter(TASKS.win3Kill.done)) {
        expect(k.winner).toBe('red');
        expect(k.winMethod).toBe('Conquest');
      }
    }
  });

  it('ritual: the Rite the player declares is carried through its full-round hold to a win', () => {
    const lit = reachable(stagedGame(TASKS.win2.build), TASKS.win2.restrict).filter(TASKS.win2.done);
    expect(lit.length).toBeGreaterThan(0);
    for (const s of lit) {
      let t = s;
      for (let i = 0; i < 12 && !t.winner; i++) t = ritualBeat(t);
      expect(t.winner).toBe('red');
      expect(t.winMethod).toBe('Ritual');
    }
  });

  it('MageStone: every way the lesson can end is a Red win', () => {
    const won = reachable(stagedGame(TASKS.win1.build), TASKS.win1.restrict).filter(TASKS.win1.done);
    expect(won.length).toBeGreaterThan(0);
    for (const s of won) expect(s.winMethod).toBe('MageStone');
  });
});
