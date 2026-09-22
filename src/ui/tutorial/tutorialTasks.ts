// The hands-on tutorial's TASKS as data: how each lesson's board is staged,
// which interactions its guardrails allow, and what counts as done — plus the
// scripted beats that run between two tasks. Pure engine code, no store.
//
// tutorialScript.ts narrates and paces these. tutorialTasks.test.ts plays EVERY
// interaction each task's guardrails allow, in every order, and proves the task
// (and any task that carries on from its board) can still be finished — so no
// allowed move can ever strand a player.
import { createGame } from '../../game/setup';
import { NEXUS_CELLS } from '../../game/board';
import { endActivation, siegedPlayers, syncStones, unitById, warriorCount } from '../../game/rules';
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

/** The first move: any unit, any square its allowance reaches — just no
 *  actions and no passing. */
export const MOVE_RESTRICT: TutRestrict = { actions: [] };

export const BLUE_BASE: Cell[] = Array.from({ length: 8 }, (_, i) => ({ r: 15, c: 4 + i }));
/** The one base square the siege may be laid on: right in front of Red's
 *  Warrior AND beside Blue's guard. Any other base square within the round's
 *  squares leaves the intruder out of Blue's reach — and the "break the siege"
 *  task that follows could never be done. */
export const SIEGE_DOOR: Cell = { r: 15, c: 8 };

/** Blue down to its guard Warrior, Mage and Priest waiting to respawn. */
function siegeBoard(st: GameState): void {
  st.units = st.units.filter((u) => u.owner !== 'blue' || u.id === 'blue-w1');
  st.pendingRespawns = [
    { id: 'tut-sg-m', owner: 'blue', kind: 'mage', activated: 0 },
    { id: 'tut-sg-p', owner: 'blue', kind: 'priest' },
  ];
  at(st, 'blue-w1').cell = { r: 15, c: 9 }; // guards its base
}

/** The Conquest endgame. `sealed` restores the base ALREADY held — the kill
 *  task's re-stage must keep the siege, or the kill wouldn't eliminate. */
function win3Board(st: GameState, sealed: boolean): void {
  st.units = st.units.filter((u) => u.owner !== 'blue' || u.id === 'blue-w1');
  at(st, 'blue-w1').cell = { r: 12, c: 8 };
  at(st, 'red-w1').cell = { r: 11, c: 8 };
  at(st, 'red-w2').cell = { r: 12, c: 7 };
  at(st, 'red-w4').cell = sealed ? { r: 15, c: 5 } : { r: 14, c: 5 };
  st.pendingRespawns = [
    { id: 'tut-pr-m', owner: 'blue', kind: 'mage', activated: 0 },
    { id: 'tut-pr-p', owner: 'blue', kind: 'priest' },
  ];
}

export const TASKS = {
  attack: {
    build: (st) => {
      at(st, 'blue-w1').cell = { r: 6, c: 7 };
      at(st, 'red-w1').cell = { r: 5, c: 7 };
      at(st, 'red-w2').cell = { r: 7, c: 7 };
      at(st, 'red-w3').cell = { r: 6, c: 6 };
    },
    // The three surrounding Warriors, the one enemy, TRIPLE only — no wandering
    // off and breaking the ring.
    restrict: {
      units: ['red-w1', 'red-w2', 'red-w3'],
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

  activate: {
    build: (st) => {
      at(st, 'red-m').cell = { r: 0, c: 8 }; // standing on its own base
      giveStones(st, 'red-m', 1, 0);
    },
    // The Mage stays home: no movement, just Activate.
    restrict: { units: ['red-m'], dests: [], actions: ['activate'] },
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
      at(st, 'red-w1').cell = { r: 5, c: 4 }; // friendly — caught too!
    },
    // Only the Mage, standing its ground, only Nova.
    restrict: { units: ['red-m'], dests: [], actions: ['nova'] },
    done: (st) => !unitById(st, 'blue-w2'),
  },

  win1: {
    build: (st) => {
      at(st, 'red-m').cell = { r: 1, c: 8 };
      giveStones(st, 'red-m', 6, 0);
    },
    // Only the Mage, only home-base squares, only Activate. (Occupied base
    // squares never glow — legalMoves filters them before this list does.)
    restrict: {
      units: ['red-m'],
      dests: Array.from({ length: 8 }, (_, i) => ({ r: 0, c: 4 + i })),
      actions: ['activate'],
    },
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

  siegeHold: {
    build: (st) => {
      siegeBoard(st);
      at(st, 'red-w1').cell = { r: 14, c: 8 };
    },
    // Only that Warrior, only onto the base square in front of it.
    restrict: { units: ['red-w1'], dests: [SIEGE_DOOR], actions: [] },
    done: (st) => siegedPlayers(st).includes('blue'),
  },

  siegeBreak: {
    // Normally this carries on from the siege just laid (see afterSiegeLaid);
    // the build is the re-stage for a retry: siege held, Blue to act.
    build: (st) => {
      siegeBoard(st);
      at(st, 'red-w1').cell = { ...SIEGE_DOOR };
      st.current = 'blue';
    },
    // Only Blue's Warrior, only the intruder — with scripted dice so the
    // lesson's fight always lands.
    restrict: {
      units: ['blue-w1'],
      dests: [],
      actions: ['attack'],
      targets: ['red-w1'],
      rig: [0.99, 0],
    },
    done: (st) => !unitById(st, 'red-w1'),
  },

  win3Siege: {
    build: (st) => win3Board(st, false),
    // Only the sealing Warrior, only onto Blue's base squares.
    restrict: { units: ['red-w4'], dests: BLUE_BASE, actions: [] },
    done: (st) => siegedPlayers(st).includes('blue'),
  },

  win3Kill: {
    build: (st) => win3Board(st, true),
    // The two flankers, the one survivor, DOUBLE only — scripted dice land it.
    restrict: {
      units: ['red-w1', 'red-w2'],
      dests: [],
      actions: ['attack'],
      targets: ['blue-w1'],
      minAttackers: 2,
      rig: [0.99, 0.99, 0],
    },
    done: (st) => !unitById(st, 'blue-w1'),
  },
} satisfies Record<string, TaskSpec>;

// ---- Scripted beats between tasks -------------------------------------------

/** Between laying the siege and breaking it: Red's activation ends and play
 *  passes to Blue, whose own six squares are untouched. The break task carries
 *  on from exactly this board. */
export function afterSiegeLaid(st: GameState): GameState {
  return endActivation(st);
}

/**
 * One beat of the Ritual lesson's hold: end the activation in progress (with
 * nothing committed, that is a pass). Repeated, it carries the Rite through the
 * rest of its round AND the full round after — the hold the rules demand —
 * until it pays out as the round after that opens.
 */
export function ritualBeat(st: GameState): GameState {
  return endActivation(st);
}
