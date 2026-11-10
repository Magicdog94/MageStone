// The hands-on tutorial's TASKS as data: how each lesson's board is staged,
// which interactions its guardrails allow, and what counts as done — plus the
// scripted beats that run between two tasks. Pure engine code, no store.
//
// tutorialScript.ts narrates and paces these. tutorialTasks.test.ts plays EVERY
// interaction each task's guardrails allow, in every order, and proves the task
// (and any task that carries on from its board) can still be finished — so no
// allowed move can ever strand a player.
import { createGame } from '../../game/setup';
import { NEXUS_CELLS, allCells } from '../../game/board';
import { endActivation, syncStones, unitById, warriorCount } from '../../game/rules';
import type { Cell, GameState, Unit } from '../../game/types';
import type { TutRestrict } from './restrict';

/** Hand `unitId` real MageStone tokens for a staged lesson. Activation lives on
 *  the token, so the demo boards are built by REASSIGNING stones, never by
 *  writing the derived `carried`/`activated` counters. */
export function giveStones(st: GameState, unitId: string, carried: number, activated: number): void {
  const free = st.stones.filter((s) => !s.carrier);
  let i = 0;
  for (let n = 0; n < carried && i < free.length; n++, i++) {
    free[i].carrier = unitId;
    free[i].activated = false;
  }
  for (let n = 0; n < activated && i < free.length; n++, i++) {
    free[i].carrier = unitId;
    free[i].activated = true;
  }
}

/** A fresh Red-vs-Blue board in its action phase, laid out by `build`. */
export function stagedGame(build: (st: GameState) => void): GameState {
  const st = createGame(['red', 'blue'], 'diamond');
  st.turnPhase = 'act';
  build(st);
  // Refresh the derived stone mirrors after any staging mutation.
  return syncStones(st);
}

const at = (st: GameState, id: string): Unit => st.units.find((u) => u.id === id)!;

export interface TaskSpec {
  /** Lay out the lesson's board (also used to re-stage it on a retry). */
  build: (st: GameState) => void;
  /** Exactly what the player may do while the task is live. */
  restrict: TutRestrict;
  /** Has the player done it? */
  done: (st: GameState) => boolean;
}

/** The three Red Warriors already standing round Blue's lone Warrior from the
 *  very first frame, ready for the attack lesson. */
export const ATTACK_TRIO = ['red-w1', 'red-w2', 'red-w3'];
/** The opening board (also createTutorialGame's): Blue's Warrior in the middle
 *  with Red's three Warriors on three sides of it. The board is NOT re-staged
 *  between the move and attack lessons (a playtester saw pieces jump about and
 *  lost track), so the attack lesson starts from exactly what the player sees. */
export const OPENING: Record<string, Cell> = {
  'blue-w1': { r: 6, c: 7 },
  'red-w1': { r: 5, c: 7 },
  'red-w2': { r: 7, c: 7 },
  'red-w3': { r: 6, c: 6 },
};
/** Blue's one open side: kept clear in the move lesson so the attack lesson
 *  is still a plain TRIPLE attack. */
const OPEN_SIDE: Cell = { r: 6, c: 8 };

/** The first move: any unit except the attack trio (they wait for the next
 *  lesson), any square its allowance reaches except Blue's open side, no
 *  actions and no passing. */
export const MOVE_RESTRICT: TutRestrict = {
  units: ['red-w4', 'red-w5', 'red-w6', 'red-p', 'red-m'],
  dests: allCells().filter((c) => !(c.r === OPEN_SIDE.r && c.c === OPEN_SIDE.c)),
  actions: [],
};

/**
 * Between the move and attack lessons: Red's go ends and Blue passes, so Red
 * starts a fresh go (all eight squares and three units) on the same board.
 */
export function freshGo(st: GameState): GameState {
  let t = endActivation(st);
  for (let i = 0; i < 4 && t.current !== 'red'; i++) t = endActivation(t);
  return t;
}

/** Red's home base row. */
const RED_BASE: Cell[] = Array.from({ length: 8 }, (_, i) => ({ r: 0, c: 4 + i }));

export const TASKS = {
  attack: {
    build: (st) => {
      for (const [id, cell] of Object.entries(OPENING)) at(st, id).cell = { ...cell };
    },
    // The three surrounding Warriors, the one enemy, TRIPLE only — no wandering
    // off and breaking the ring.
    restrict: {
      units: ATTACK_TRIO,
      dests: [],
      actions: ['attack'],
      targets: ['blue-w1'],
      minAttackers: 3,
    },
    done: (st) => !unitById(st, 'blue-w1') || st.lastCombat !== null,
  },

  resurrect: {
    build: (st) => {
      st.units = st.units.filter((u) => u.id !== 'red-w1'); // a warrior has fallen
      at(st, 'red-p').cell = { r: 5, c: 9 };
      st.gravestones.push({ id: 'tut-grave-1', cell: { r: 5, c: 11 } });
    },
    // Only the Priest, only the gravestone square, only Resurrect.
    restrict: { units: ['red-p'], dests: [{ r: 5, c: 11 }], actions: ['resurrect'] },
    done: (st) => warriorCount(st, 'red') >= 6,
  },

  collect: {
    build: (st) => {
      at(st, 'red-m').cell = { r: 4, c: 8 };
      st.stones.find((x) => !x.carrier)!.cell = { r: 5, c: 8 };
    },
    // Only the Mage, only the stone's square, only Collect.
    restrict: { units: ['red-m'], dests: [{ r: 5, c: 8 }], actions: ['collect'] },
    done: (st) => (unitById(st, 'red-m')?.carried ?? 0) > 0,
  },

  home: {
    build: (st) => {
      at(st, 'red-m').cell = { r: 6, c: 8 }; // a straight run from its base
      giveStones(st, 'red-m', 1, 0);
    },
    // Only the Mage, only onto its base — the stone activates on arrival.
    restrict: { units: ['red-m'], dests: RED_BASE, actions: [] },
    done: (st) => (unitById(st, 'red-m')?.activated ?? 0) > 0,
  },

  bolt: {
    build: (st) => {
      at(st, 'red-m').cell = { r: 8, c: 5 };
      giveStones(st, 'red-m', 0, 4);
      at(st, 'blue-w1').cell = { r: 8, c: 8 };
    },
    // Only the Mage, no walking, only Bolt at the staged target.
    restrict: { units: ['red-m'], dests: [], actions: ['bolt'], targets: ['blue-w1'] },
    done: (st) => !unitById(st, 'blue-w1'),
  },

  nova: {
    build: (st) => {
      at(st, 'red-m').cell = { r: 5, c: 5 };
      giveStones(st, 'red-m', 0, 4);
      at(st, 'blue-w1').cell = { r: 4, c: 5 };
      at(st, 'blue-w2').cell = { r: 6, c: 6 }; // diagonal!
      at(st, 'blue-w3').cell = { r: 5, c: 6 };
      at(st, 'red-w1').cell = { r: 5, c: 4 }; // friendly — unharmed
    },
    // Only the Mage, standing its ground, only Nova.
    restrict: { units: ['red-m'], dests: [], actions: ['nova'] },
    done: (st) => !unitById(st, 'blue-w2'),
  },

  win1: {
    build: (st) => {
      at(st, 'red-m').cell = { r: 5, c: 8 };
      giveStones(st, 'red-m', 6, 0);
    },
    // Only the Mage, only home-base squares; the six activate on arrival and
    // win. (Occupied base squares never glow — legalMoves filters them first.)
    restrict: { units: ['red-m'], dests: RED_BASE, actions: [] },
    done: (st) => st.winner === 'red',
  },

  win2: {
    build: (st) => {
      at(st, 'red-p').cell = { r: 7, c: 5 };
    },
    // Only the Priest, only into the Nexus, only Begin Ritual.
    restrict: { units: ['red-p'], dests: [...NEXUS_CELLS], actions: ['ritual'] },
    done: (st) => st.ritual !== null,
  },

} satisfies Record<string, TaskSpec>;

// ---- Scripted beats between tasks -------------------------------------------

/**
 * One beat of the Ritual lesson's hold: end the activation in progress (with
 * nothing committed, that is a pass). Repeated, it carries the Rite through
 * Blue's two goes until play comes back to Red a second time and it pays out.
 */
export function ritualBeat(st: GameState): GameState {
  return endActivation(st);
}
