import { asTutorialScript, useGame, type TutRestrict } from '../../store';
import { legalMoves, movesLeft, slotsLeft, unitById } from '../../game/rules';
import type { Callout } from './useTutorial';
import type { Cell, GameState } from '../../game/types';
import { useTutorial } from './useTutorial';
import {
  MOVE_RESTRICT,
  TASKS,
  freshGo,
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

// Pacing. A playtester found the run "too fast": pieces were re-laid before
// they had taken in what just happened. So every lesson now lingers on its
// result, and a fresh board sits still for a moment before the next note.
/** After a task is done: time to see what it did. */
const SEE_RESULT_MS = 2400;
/** After a new lesson board appears: time to look at it before the note. */
const SEE_BOARD_MS = 1400;
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
export async function runTutorial(onDone: (completed: boolean) => void) {
  const myEpoch = ++epoch; // cancels any still-unwinding previous run
  stepNo = 0;
  let completed = false;
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
      body: 'You are Red. Each go you get 8 squares of movement, shared by up to 3 units. Press End Turn when done.',
      anchor: '.budget-tray',
      placement: 'bottom',
    });

    // 2 ---- YOU move ----------------------------------------------------------
    await playerTask(
      null,
      {
        id: 'task-move',
        title: 'Move a unit',
        body: 'Units move in one straight line: up, down, left or right, and other units block the way. Click any unit except the three Warriors around Blue (they are for the next step), then a glowing square.',
        placement: 'bottom',
      },
      () => g().game.unitsMovedThisTurn.length >= 1,
      () => {
        // The Warrior from the back row nearest the middle walks forward.
        if (!stepToward('red-w4', { r: 8, c: 8 })) stepToward('red-m', { r: 8, c: 8 });
      },
      // The units outside the attack ring, any legal square bar Blue's open
      // side — but not ending the go yet.
      { restrict: MOVE_RESTRICT },
    );
    await wait(SEE_RESULT_MS);

    // 3 ---- YOU attack --------------------------------------------------------
    // Same board, nothing re-laid: Red's go ends, Blue passes, and Red starts
    // a fresh go with the ring already standing. (Only a retry re-stages it.)
    beat(freshGo);
    const stageFight = () => stage(TASKS.attack.build);
    await wait(600);
    // Keep the dice and their result on screen until the result note is read.
    g().setHoldCombat(true);
    await playerTask(
      stageFight,
      {
        id: 'task-attack',
        title: 'Attack',
        body: 'Blue passed, so it is your go again. Each Warrior beside an enemy adds a die to the attack: click one of your three Warriors next to Blue, then press TRIPLE ATTACK.',
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
        body: `Your three dice made ${a} against Blue’s ${d}. The higher total wins (a tie is rolled again) and the loser is removed. Attacking also ends that unit’s go.`,
        anchor: '.combat-announce',
        placement: 'bottom',
      });
      g().setHoldCombat(false);
    }
    await wait(900);

    // 5 ---- YOU resurrect -----------------------------------------------------
    const stageRes = () => stage(TASKS.resurrect.build);
    stageRes();
    await wait(SEE_BOARD_MS);
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
    await wait(SEE_RESULT_MS);

    // 6 ---- YOU collect -------------------------------------------------------
    const stageCollect = () => stage(TASKS.collect.build);
    stageCollect();
    await wait(SEE_BOARD_MS);
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
    await wait(SEE_RESULT_MS);

    // 7 ---- YOU carry it home -------------------------------------------------
    const stageHome = () => stage(TASKS.home.build);
    stageHome();
    await wait(SEE_BOARD_MS);
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
    await wait(SEE_RESULT_MS);

    // 8 ---- YOU cast Bolt -----------------------------------------------------
    const stageBolt = () => stage(TASKS.bolt.build);
    stageBolt();
    await wait(SEE_BOARD_MS);
    await playerTask(
      stageBolt,
      {
        id: 'task-bolt',
        title: 'Cast Bolt',
        body: 'Spend 1 activated stone to hit the first unit in a straight line, using your squares. Click your Mage, press BOLT, then the Blue Warrior.',
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
    await wait(SEE_RESULT_MS);

    // 9 ---- YOU cast Nova -----------------------------------------------------
    const stageNova = () => stage(TASKS.nova.build);
    stageNova();
    await wait(SEE_BOARD_MS);
    await playerTask(
      stageNova,
      {
        id: 'task-nova',
        title: 'Cast Nova',
        body: 'Spend 4 stones to destroy every enemy on the 8 squares around your Mage, diagonals too: they glow when your Mage is selected. Click your Mage, then press NOVA. The 4 spent stones then drop on the diagonal squares.',
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
    await wait(SEE_RESULT_MS + 600);

    // 10 ---- YOU win: MageStone -----------------------------------------------
    const stageWin1 = () => stage(TASKS.win1.build);
    stageWin1();
    await wait(SEE_BOARD_MS);
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
    await wait(3000); // let the victory land

    // 11 ---- YOU win: Ritual --------------------------------------------------
    const stageWin2 = () => stage(TASKS.win2.build);
    stageWin2();
    await wait(SEE_BOARD_MS);
    await playerTask(
      stageWin2,
      {
        id: 'task-win2',
        title: 'Win with a Ritual',
        body: 'Move your Priest into the glowing Nexus and press BEGIN RITUAL. If Blue can’t break it in its next two goes, you win.',
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
    // Play the hold out: Blue's army is home, and the Rite pays out the second
    // time play comes back to Red.
    for (let i = 0; i < 12 && !g().game.winner; i++) {
      beat(ritualBeat);
      await wait(1000);
    }

    // 12 ---- Conquest + wrap up ----------------------------------------------
    await note({
      id: 'wrap',
      title: 'One more way to win',
      body: 'Conquest: kill every enemy Warrior. A player with no Warriors left is out at once, even with a Mage and Priest alive. Next, a practice game against the Easy bot: press Hint any time you are stuck.',
      anchor: '.winner',
      placement: 'left',
      gotItLabel: 'Play practice game',
    });
    completed = true;
  } catch (e) {
    if (e !== CANCELLED) throw e;
  } finally {
    // A cancelled run must not tear down the NEWER run that replaced it.
    if (epoch === myEpoch) {
      useGame.getState().setTutRestrict(null); // never leak guardrails into real play
      useGame.getState().setHoldCombat(false);
      onDone(completed);
    }
  }
}
