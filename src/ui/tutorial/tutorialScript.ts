import { asTutorialScript, useGame, type TutRestrict } from '../../store';
import { legalMoves, movesLeft, slotsLeft, unitById } from '../../game/rules';
import type { Callout } from './useTutorial';
import type { Cell, GameState } from '../../game/types';
import { useTutorial } from './useTutorial';
import {
  MOVE_RESTRICT,
  TASKS,
  ritualBeat,
  stagedGame,
} from './tutorialTasks';

/** Run store actions AS the script: the guardrails that stop the player (the
 *  live task's, or the lock between tasks) stand aside for these calls only. */
const S = asTutorialScript;

const g = () => useGame.getState();

const CANCELLED = Symbol('tutorial-cancelled');
/** Run epoch: bumped whenever a NEW guided run starts. Every await in the old
 *  run captures its epoch and throws CANCELLED the moment a newer run exists —
 *  so a skip-then-restart can never leave a zombie script driving the fresh
 *  board (the old `running` flag silently DROPPED the restart instead). */
let epoch = 0;
async function wait(ms: number) {
  const e = epoch;
  await new Promise((r) => setTimeout(r, ms));
  if (e !== epoch) throw CANCELLED;
}
function guard() {
  if (!useGame.getState().tutorial) throw CANCELLED;
}

/** Total coached steps (one per note or task below). */
const TOTAL_STEPS = 12;
let stepNo = 0;
/** Stamp "step n of m" onto a callout (shown as the box's progress counter). */
function stamp(c: Callout): Callout {
  stepNo += 1;
  return { ...c, step: Math.min(stepNo, TOTAL_STEPS), total: TOTAL_STEPS };
}

async function note(c: Callout) {
  guard();
  const e = epoch;
  await useTutorial.getState().note(stamp(c));
  if (e !== epoch) throw CANCELLED;
  guard();
}
/** Poll until `pred` holds (or time out) — TRUE when it held in time. */
async function until(pred: () => boolean, timeout = 5000, interval = 120) {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < timeout) {
    await wait(interval);
    guard();
  }
  return pred();
}
const dist = (a: Cell, b: Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);

// ---- Interactive tasks -----------------------------------------------------
// The heart of the hands-on tutorial: show a TASK note (the coach lets clicks
// through), watch the game state until the player has done it, and NEVER
// wedge — after two patient attempts (re-staging the board in case they broke
// the setup) the script quietly performs the step itself and moves on.
//
// Each task also carries GUARDRAILS (store.tutRestrict): while the task is
// live, only the interaction the step teaches is accepted — wrong units,
// wrong squares, wrong actions and End Turn simply don't respond, so the
// player can explore clicks freely without ever wrecking the staged lesson.
// Between tasks (restrict null) the board is LOCKED outright (TUT_LOCK), and
// tutorialTasks.test.ts plays every allowed interaction to prove no task can be
// left unfinishable. The script's own moves go through `S(...)`.

async function playerTask(
  setup: (() => void) | null,
  c: Callout,
  pred: () => boolean,
  fallback: () => void | Promise<void>,
  opts: { timeoutMs?: number; restrict?: TutRestrict } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 90000;
  guard();
  const myEpoch = epoch;
  const stamped = stamp(c); // one step number, even across retries
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) setup?.(); // the board may have drifted — line it up again
      await wait(attempt > 0 ? 700 : 0);
      guard();
      g().setTutRestrict(opts.restrict ?? null);
      useTutorial.getState().task(
        attempt === 0 ? stamped : { ...stamped, body: `No rush — here it is again. ${c.body}` },
      );
      const t0 = Date.now();
      let done = false;
      while (!done && Date.now() - t0 < timeoutMs) {
        await wait(150);
        guard();
        if (pred()) {
          // Let a just-dispatched click (e.g. an allowed Undo) land BEFORE the
          // guardrails lift, then confirm the state still reads done — else a
          // last-instant reversal leaves the next task facing a board this
          // one's restrict would have prevented.
          await wait(140);
          guard();
          done = pred();
        }
      }
      g().setTutRestrict(null);
      useTutorial.getState().clearTask();
      if (done || pred()) return;
    }
  } finally {
    // Skips/cancellations mid-task must lift the guardrails too — but never
    // strip a NEWER run's live restrict (this run may be a cancelled zombie).
    if (epoch === myEpoch) useGame.getState().setTutRestrict(null);
  }
  await fallback(); // the show must go on
  const ok = await until(pred, 8000);
  if (!ok && import.meta.env.DEV) console.warn('tutorial: fallback failed for', c.id);
}

// ---- staging ---------------------------------------------------------------
// Lesson boards, guardrails and "done" tests are data in tutorialTasks.ts.

function stage(build: (st: GameState) => void): void {
  // Also clear transient combat/sorcery UI from the previous lesson — an armed
  // bolt or a lingering roll announcement must not leak onto the fresh board.
  useGame.setState({
    game: stagedGame(build),
    selectedUnitId: null,
    selectedDieId: null,
    rolling: false,
    boltMode: false,
    combatIntro: null,
    combatRoll: null,
  });
}

/** Play a scripted engine beat between tasks (tutorialTasks.ts — the sweep test
 *  checks the next task from exactly these boards). */
function beat(next: (st: GameState) => GameState): void {
  useGame.setState({
    game: next(g().game),
    selectedUnitId: null,
    selectedDieId: null,
    undoPoint: null,
    rolling: false,
    boltMode: false,
  });
}

/** Move `unitId` as close to `target` as one straight-line move allows. */
function stepToward(unitId: string, target: Cell): boolean {
  const st = g().game;
  const u = unitById(st, unitId);
  if (!u) return false;
  const reach = movesLeft(st, st.current);
  if (reach <= 0 || slotsLeft(st, st.current) <= 0) return false;
  const moves = legalMoves(st, u, reach);
  if (moves.length === 0) return false;
  const best = moves.reduce((a, b) => (dist(b, target) < dist(a, target) ? b : a));
  S(() => {
    g().selectUnit(unitId);
    g().moveTo(best);
  });
  return true;
}

/** Script-move a unit onto an exact cell (fallbacks for unfinished tasks). */
function scriptMove(unitId: string, dest: Cell): void {
  S(() => {
    g().selectUnit(unitId);
    g().moveTo(dest);
  });
}

/**
 * The guided game — HANDS-ON and short: twelve steps. The player moves, fights,
 * resurrects, collects, carries a stone home, casts Bolt and Nova and wins by
 * MageStone and by Ritual; Conquest and the deeper rules are left to the Rule
 * Book.
 */
export async function runTutorial(onDone: () => void) {
  const myEpoch = ++epoch; // cancels any still-unwinding previous run
  stepNo = 0;
  try {
    // Wait for the 3D board to finish loading so the spotlights have something
    // to point at — then give the first frame a real beat to render (the note
    // must not appear over a still-materialising board).
    await until(() => !document.querySelector('.loading-gate'), 22000);
    await wait(1200);
    guard();

    // 1 ---- the go ----------------------------------------------------------
    await note({
      id: 'welcome',
      title: 'Welcome to MageStone',
      body: 'You are Red. Each go you can use up to 3 units, then press End Turn.',
      anchor: '.budget-tray',
      placement: 'bottom',
    });

    // 2 ---- YOU move ----------------------------------------------------------
    await playerTask(
      null,
      {
        id: 'task-move',
        title: 'Move like a rook',
        body: 'Units move any distance up, down, left or right, in one straight line. Units block the way. Click a unit, then a glowing square.',
        placement: 'bottom',
      },
      () => g().game.unitsMovedThisTurn.length >= 1,
      () => {
        const st = g().game;
        const w = st.units.find((u) => u.owner === st.current);
        if (w) stepToward(w.id, { r: 8, c: 8 });
      },
      // Any unit, any legal square — but not ending the go yet.
      { restrict: MOVE_RESTRICT },
    );
    await wait(1200);

    // 3 ---- YOU attack --------------------------------------------------------
    const stageFight = () => stage(TASKS.attack.build);
    stageFight();
    await wait(700);
    await playerTask(
      stageFight,
      {
        id: 'task-attack',
        title: 'Attack',
        body: 'Each Warrior beside an enemy adds a die. Click one of your three Warriors next to Blue, then press TRIPLE ATTACK.',
        placement: 'bottom',
      },
      () => TASKS.attack.done(g().game),
      () => {
        const rig = [0.7, 0.55, 0.99, 0.2];
        let i = 0;
        S(() => {
          g().selectUnit('red-w1');
          g().attack('blue-w1', ['red-w1', 'red-w2', 'red-w3'], () => rig[Math.min(i++, rig.length - 1)]);
        });
      },
      { timeoutMs: 120000, restrict: TASKS.attack.restrict },
    );
    await until(() => g().combatRoll !== null, 6000);
    await wait(400);

    // 4 ---- the result --------------------------------------------------------
    {
      // The 3D dice report the roll; if they ever don't (scene fallback), the
      // ENGINE's result is authoritative — never narrate "rolled 0 against 0".
      const roll = g().combatRoll;
      const lc = g().game.lastCombat;
      const a = roll?.attackRoll ?? lc?.attackRoll ?? 15;
      const d = roll?.defenseRoll ?? lc?.defenseRoll ?? 2;
      const won = !unitById(g().game, 'blue-w1');
      await note({
        id: 'fight-result',
        title: won ? 'Down he goes' : 'Unlucky!',
        body: `${a} against ${d}. Higher roll wins and ties re-roll. Attacking ends a unit’s go.`,
        anchor: '.combat-announce',
        placement: 'bottom',
      });
    }

    // 5 ---- YOU resurrect -----------------------------------------------------
    const stageRes = () => stage(TASKS.resurrect.build);
    stageRes();
    await wait(700);
    await playerTask(
      stageRes,
      {
        id: 'task-resurrect',
        title: 'Resurrect',
        body: 'A fallen Warrior leaves a gravestone. Move your Priest onto it to bring the Warrior back.',
        placement: 'bottom',
      },
      () => TASKS.resurrect.done(g().game),
      async () => {
        scriptMove('red-p', { r: 5, c: 11 });
        await wait(700);
        S(() => {
          g().selectUnit('red-p');
          g().doResurrect();
        });
      },
      { restrict: TASKS.resurrect.restrict },
    );
    await wait(1200);

    // 6 ---- YOU collect -------------------------------------------------------
    const stageCollect = () => stage(TASKS.collect.build);
    stageCollect();
    await wait(700);
    await playerTask(
      stageCollect,
      {
        id: 'task-collect',
        title: 'Collect a MageStone',
        body: 'Only your Mage carries stones. Move it onto the stone to pick it up.',
        placement: 'bottom',
      },
      () => TASKS.collect.done(g().game),
      async () => {
        scriptMove('red-m', { r: 5, c: 8 });
        await wait(700);
        S(() => {
          g().selectUnit('red-m');
          g().collectStones();
        });
      },
      { restrict: TASKS.collect.restrict },
    );
    await wait(900);

    // 7 ---- YOU carry it home -------------------------------------------------
    const stageHome = () => stage(TASKS.home.build);
    stageHome();
    await wait(700);
    await playerTask(
      stageHome,
      {
        id: 'task-home',
        title: 'Take it home',
        body: 'Stones count once your Mage brings them to your base. Move your Mage home and they activate by themselves.',
        placement: 'bottom',
      },
      () => TASKS.home.done(g().game),
      () => scriptMove('red-m', { r: 0, c: 8 }),
      { restrict: TASKS.home.restrict },
    );
    await wait(1200);

    // 8 ---- YOU cast Bolt -----------------------------------------------------
    const stageBolt = () => stage(TASKS.bolt.build);
    stageBolt();
    await wait(700);
    await playerTask(
      stageBolt,
      {
        id: 'task-bolt',
        title: 'Cast Bolt',
        body: 'Spend 1 activated stone to hit the first unit in a straight line. Click your Mage, press BOLT, then click the Blue Warrior.',
        placement: 'bottom',
      },
      () => TASKS.bolt.done(g().game),
      () =>
        S(() => {
          g().selectUnit('red-m');
          g().castBolt('blue-w1');
        }),
      { timeoutMs: 120000, restrict: TASKS.bolt.restrict },
    );
    await wait(1500);

    // 9 ---- YOU cast Nova -----------------------------------------------------
    const stageNova = () => stage(TASKS.nova.build);
    stageNova();
    await wait(700);
    await playerTask(
      stageNova,
      {
        id: 'task-nova',
        title: 'Cast Nova',
        body: 'Spend 4 stones to destroy every enemy around your Mage, diagonals too. Click your Mage, then press NOVA.',
        placement: 'bottom',
      },
      () => TASKS.nova.done(g().game),
      () => {
        const novaRig = [0.15, 0.5, 0.85];
        let ni = 0;
        S(() => {
          g().selectUnit('red-m');
          g().castNova(() => novaRig[Math.min(ni++, novaRig.length - 1)]);
        });
      },
      { restrict: TASKS.nova.restrict },
    );
    await wait(1800);

    // 10 ---- YOU win: MageStone -----------------------------------------------
    const stageWin1 = () => stage(TASKS.win1.build);
    stageWin1();
    await wait(700);
    await playerTask(
      stageWin1,
      {
        id: 'task-win1',
        title: 'Win with MageStones',
        body: 'Six activated stones on your base wins. Your Mage carries six: move it home.',
        placement: 'bottom',
      },
      () => TASKS.win1.done(g().game),
      () => scriptMove('red-m', { r: 0, c: 8 }),
      { timeoutMs: 120000, restrict: TASKS.win1.restrict },
    );
    await wait(2500); // let the victory land

    // 11 ---- YOU win: Ritual --------------------------------------------------
    const stageWin2 = () => stage(TASKS.win2.build);
    stageWin2();
    await wait(700);
    await playerTask(
      stageWin2,
      {
        id: 'task-win2',
        title: 'Win with a Ritual',
        body: 'Move your Priest into the glowing Nexus and press BEGIN RITUAL. If Blue can’t break it in two goes, you win.',
        placement: 'bottom',
      },
      () => TASKS.win2.done(g().game),
      async () => {
        scriptMove('red-p', { r: 7, c: 7 });
        await wait(700);
        S(() => {
          g().selectUnit('red-p');
          g().doRitual();
        });
      },
      { restrict: TASKS.win2.restrict },
    );
    await wait(600);
    // Play the hold out: Blue's army is home, and the Rite pays out once play
    // comes back round.
    for (let i = 0; i < 12 && !g().game.winner; i++) {
      beat(ritualBeat);
      await wait(650);
    }

    // 12 ---- Conquest + wrap up ----------------------------------------------
    await note({
      id: 'wrap',
      title: 'One more way to win',
      body: 'Conquest: destroy every enemy unit. Fallen Mages and Priests respawn on their base, unless an enemy stands on it. The Rule Book has the rest. Go play!',
      anchor: '.winner',
      placement: 'left',
      gotItLabel: 'Finish',
    });
  } catch (e) {
    if (e !== CANCELLED) throw e;
  } finally {
    // A cancelled run must not tear down the NEWER run that replaced it.
    if (epoch === myEpoch) {
      useGame.getState().setTutRestrict(null); // never leak guardrails into real play
      onDone();
    }
  }
}
