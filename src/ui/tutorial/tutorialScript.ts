import { asTutorialScript, useGame, type TutRestrict } from '../../store';
import { legalMoves, movesLeft, unitById } from '../../game/rules';
import type { Callout } from './useTutorial';
import type { Cell, GameState } from '../../game/types';
import { useTutorial } from './useTutorial';
import {
  MOVE_RESTRICT,
  SIEGE_DOOR,
  TASKS,
  afterSiegeLaid,
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

/** Total coached steps — keep in sync with tut-verify.mjs EXPECT. */
const TOTAL_STEPS = 44;
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

/** Move `unitId` as far toward `target` as the go's squares allow. */
function stepToward(unitId: string, target: Cell): boolean {
  const st = g().game;
  const u = unitById(st, unitId);
  if (!u) return false;
  const reach = movesLeft(st, st.current);
  if (reach <= 0) return false;
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
 * The guided game — HANDS-ON. The player moves, fights,
 * resurrects, collects, casts, lays and breaks a siege (briefly playing Blue)
 * and WINS all three ways, coached step by step; only Blue's routine beats
 * (its roll/discard) play themselves.
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

    await note({
      id: 'welcome',
      title: 'Welcome to MageStone',
      body: 'This tutorial is HANDS-ON: you move, you fight, you win — the coach just points the way. Whenever the note says "Your move…", the game is yours. Let’s go.',
      placement: 'center',
    });
    await note({
      id: 'header',
      title: 'Your scoreboard',
      body: 'One card per team — Red is you. Silver stone = MageStones carried, gold = activated, the sword counts kills, W your living Warriors.',
      anchor: '.player-strip',
      placement: 'bottom',
    });
    await note({
      id: 'chips',
      title: 'Round & gravestones',
      body: 'These chips track the round number and the shared gravestone bank. The bank is FINITE and never refills — every Warrior death and every resurrection spends one for good.',
      anchor: '.grave-bank',
      placement: 'bottom',
    });

    await note({
      id: 'allowance',
      title: 'Six squares of movement',
      body: 'No dice for your turn: on every go you have SIX squares of movement to spend, divided between AS MANY UNITS AS YOU LIKE. One unit can march all six, three can take two each, or six can take one each — your choice, every go.',
      anchor: '.budget-tray',
      placement: 'top',
    });
    await wait(300);
    await note({
      id: 'alternate',
      title: 'Your whole go, in one stretch',
      body: 'Move a unit, resolve what it does there, then carry on with the next — SIX squares in total, spread over as many units as you like. Actions cost no squares, so a Warrior already beside an enemy attacks for free. Play passes only when you press End Turn, and any squares you have not used are LOST.',
      placement: 'bottom',
    });

    // ---- YOU move ----------------------------------------------------------
    await playerTask(
      null,
      {
        id: 'task-move',
        title: 'Move a unit',
        body: 'CLICK one of your units, then click any glowing square. Paths are orthogonal — never diagonal — and may bend. However far you walk comes out of your six.',
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
    await wait(500);
    await note({
      id: 'moved',
      title: 'Nicely done',
      body: 'That’s movement: as far as your squares allow, through empty squares — units block the way, MageStones and gravestones don’t. Watch the pips: the squares you walked are gone for this go.',
      placement: 'bottom',
    });

    // ---- YOU attack (staged) ----------------------------------------------
    const stageFight = () => stage(TASKS.attack.build);
    stageFight();
    await wait(700);
    await note({
      id: 'fight-stage',
      title: 'Time to fight',
      body: 'We’ve arranged a textbook gang-up: THREE of your Warriors surround one Blue Warrior. Warriors COORDINATE — 1 rolls 1d6 (50%), 2 roll 2d6 (90%), 3 roll 3d6 (99%).',
      placement: 'bottom',
    });
    await note({
      id: 'oddsgrid',
      title: 'Know your odds',
      body: 'Your roll (row) against the defender’s die (column). Defenders roll a d6 — except a Mage, whose defence die grows with its stones (more on that soon). Ties are RE-ROLLED, so nobody gets an edge — an even fight is a straight 50:50.',
      placement: 'center',
      showOdds: true,
    });
    await playerTask(
      stageFight,
      {
        id: 'task-attack',
        title: 'Launch a Triple Attack',
        body: 'CLICK one of your three Warriors around the enemy, then press TRIPLE ATTACK — 99% — and watch the real dice decide it.',
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
        title: won ? 'Down he goes' : 'The 1-in-100 upset!',
        body: won
          ? `Your three dice rolled ${a} against Blue’s ${d} — the defender falls. Stack attackers to win fights; even when a gang-up fails, only ONE attacker falls, never the group.`
          : `Your ${a} lost to Blue’s ${d} — the 1%! When a coordinated attack fails only ONE attacker falls, never the group. That’s dice — and why you stack the odds.`,
        anchor: '.combat-announce',
        placement: 'bottom',
      });
    }
    await note({
      id: 'graverules',
      title: 'A gravestone drops',
      body: 'A fallen Warrior leaves a gravestone — but only while the shared bank (4 per player: 8 here, 16 in a 4-player game) still has one, and never on the Nexus. Once the bank is empty, Warriors die for good. Gravestones matter, because…',
      anchor: '.grave-bank',
      placement: 'bottom',
    });

    // ---- YOU resurrect (staged) -------------------------------------------
    const stageRes = () => stage(TASKS.resurrect.build);
    stageRes();
    await wait(700);
    await note({
      id: 'priest',
      title: 'The Priest',
      body: 'Priests never attack — but do not think them harmless: a Priest that WINS its defence KILLS its attacker, without moving an inch. Their gift is RESURRECTION. One of your Warriors is down; there’s the gravestone.',
      placement: 'bottom',
    });
    await playerTask(
      stageRes,
      {
        id: 'task-resurrect',
        title: 'Bring your Warrior back',
        body: 'CLICK your Priest and walk it ONTO the gravestone. The Warrior rises the moment you land — no button needed — and your Priest steps back a square to make room.',
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
    await wait(600);
    await note({
      id: 'res-done',
      title: 'A Warrior returns',
      body: 'The Warrior revives on the grave square and the Priest steps back the way it came. That gravestone is now GONE FROM THE GAME — it does not return to the bank. A Priest can use ANY gravestone, one per turn, and you can never have more than 6 Warriors.',
      placement: 'bottom',
    });

    // ---- YOU collect + activate -------------------------------------------
    const stageCollect = () => stage(TASKS.collect.build);
    stageCollect();
    await wait(700);
    await playerTask(
      stageCollect,
      {
        id: 'task-collect',
        title: 'Collect a MageStone',
        body: 'Your Mage gathers the stones that win games. CLICK your Mage and step ONTO the stone’s square — it is picked up automatically the moment you land.',
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
    await note({
      id: 'carried',
      title: 'Carried — not yet yours',
      body: 'The silver counter ticked up: the stone is CARRIED but UNACTIVATED. It scores nothing and adds no power yet — and if your Mage dies it drops every one of them where it fell.',
      anchor: '[data-tut="carried"]',
      placement: 'bottom',
    });
    const stageActivate = () => stage(TASKS.activate.build);
    stageActivate();
    await wait(700);
    await playerTask(
      stageActivate,
      {
        id: 'task-activate',
        title: 'Activate it',
        body: 'Stones only COUNT once activated ON your own base. Your Mage stands home — CLICK it, then press ACTIVATE. Silver becomes gold.',
        placement: 'bottom',
      },
      () => TASKS.activate.done(g().game),
      () =>
        S(() => {
          g().selectUnit('red-m');
          g().activateStones();
        }),
      { restrict: TASKS.activate.restrict },
    );
    await note({
      id: 'gold',
      title: 'Gold stones are power',
      body: 'Activated stones score toward victory AND upgrade your Mage’s attack die: d6 normally, d12 at 2 stones, d20 at 4+. They can also be SPENT…',
      anchor: '[data-tut="activated"]',
      placement: 'bottom',
    });

    // ---- YOU cast Bolt -----------------------------------------------------
    const stageBolt = () => stage(TASKS.bolt.build);
    stageBolt();
    await wait(700);
    await playerTask(
      stageBolt,
      {
        id: 'task-bolt',
        title: 'Cast BOLT — 1 stone',
        body: 'A ranged kill: a Bolt flies as far as the squares you have left, and the flight SPENDS them — three squares away costs three. Only a Mage can block one; anything else gets no defence roll. CLICK your Mage, press BOLT — enemies in range glow — then click the Blue Warrior.',
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
    await wait(1200);
    await note({
      id: 'bolt-stone',
      title: 'The stone disperses',
      body: 'Look at the target’s square: that same stone landed THERE — never destroyed, never deactivated, and claimable by any Mage. Once a stone has been Activated it stays Activated for the rest of the game, whoever ends up holding it. The cost is real: your Mage dropped from 4 stones (d20) to 3 (d12).',
      placement: 'bottom',
    });

    // ---- YOU cast Nova -----------------------------------------------------
    const stageNova = () => stage(TASKS.nova.build);
    stageNova();
    await wait(700);
    await note({
      id: 'nova-intro',
      title: 'NOVA — 4 stones',
      body: 'Your Mage is mobbed — three enemies, one of them DIAGONAL. Nova destroys every ENEMY unit in the 8 squares around your Mage, diagonals included, with no defence roll. Your own Warrior beside it is unharmed.',
      placement: 'bottom',
    });
    await playerTask(
      stageNova,
      {
        id: 'task-nova',
        title: 'Unleash it',
        body: 'CLICK your Mage, then press NOVA.',
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
    await note({
      id: 'nova-stones',
      title: 'Count the cost',
      body: 'All three Blue Warriors fell; your own Warrior stands untouched. The four spent stones now sit on the four DIAGONALS around your Mage — still ACTIVATED, and claimable by anyone, your enemy included. Your Mage is back to a d6. Sorcery is power lent to the battlefield — choose your moment.',
      placement: 'bottom',
    });

    // ---- YOU win: MageStone ------------------------------------------------
    const stageWin1 = () => stage(TASKS.win1.build);
    stageWin1();
    await wait(700);
    await playerTask(
      stageWin1,
      {
        id: 'task-win1',
        title: 'Now WIN a game',
        body: 'Your Mage carries SIX stones, one step from home. CLICK it, step onto your base, then press ACTIVATE — six gold on your base wins on the spot.',
        placement: 'bottom',
      },
      () => TASKS.win1.done(g().game),
      async () => {
        scriptMove('red-m', { r: 0, c: 8 });
        await wait(700);
        S(() => {
          g().selectUnit('red-m');
          g().activateStones();
        });
      },
      { timeoutMs: 120000, restrict: TASKS.win1.restrict },
    );
    await wait(600);
    await note({
      id: 'win1-done',
      title: 'MageStone Victory!',
      body: 'You did that. Six activated MageStones, carried home and lit on your base — the first of the three roads to victory.',
      anchor: '.winner',
      placement: 'left',
    });

    // ---- YOU win: Ritual ---------------------------------------------------
    const stageWin2 = () => stage(TASKS.win2.build);
    stageWin2();
    await wait(700);
    await playerTask(
      stageWin2,
      {
        id: 'task-win2',
        title: 'Victory 2 — the Ritual',
        body: 'Walk your Priest into the NEXUS — the glowing 2×2 heart of the board — and press BEGIN RITUAL.',
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
    await wait(400);
    await note({
      id: 'ritual-lit',
      title: 'The ritual is lit',
      body: 'Now HOLD it: in a two-player game Blue gets TWO goes to break it — reach the Nexus or kill your Priest — and if it survives both, the Rite completes when play comes back round to you the second time. (With four players it is one go each instead.) Blue’s units are far away. Watch.',
      anchor: '.ritual-flag',
      placement: 'top',
    });
    beat(ritualBeat); // your go ends — Blue's turn
    await wait(600);
    await note({
      id: 'ritual-blue',
      title: 'Blue can’t reach',
      body: 'Blue would need to touch the Nexus or kill the Priest, and its army is home. It takes its two goes…',
      anchor: '.player-strip',
      placement: 'bottom',
    });
    // Play the hold out: Blue takes its single go, and the Rite pays out the
    // moment play lands back on you.
    for (let i = 0; i < 12 && !g().game.winner; i++) {
      beat(ritualBeat);
      await wait(650);
    }
    await note({
      id: 'win2-done',
      title: 'Ritual Victory!',
      body: 'Blue had both its goes and could not reach you — so when play came back round the second time, the Rite completed. That’s the second road, and the fastest one when the centre is clear.',
      anchor: '.winner',
      placement: 'left',
    });

    // ---- Sieges (HANDS-ON: you lay one, then swap sides and break it) ------
    const stageSiege = () => stage(TASKS.siegeHold.build);
    stageSiege();
    await wait(700);
    await note({
      id: 'siege-intro',
      title: 'Sieges — starve the respawns',
      body: 'Blue’s Mage and Priest have fallen and wait in the respawn queue — see the P… on Blue’s card. They return to Blue’s base squares… unless someone is STANDING there. Your Warrior is one step away.',
      placement: 'center',
    });
    await playerTask(
      stageSiege,
      {
        id: 'task-siege-hold',
        title: 'Lay a siege',
        body: 'CLICK your Warrior by Blue’s base and march it ONTO the glowing base square right in front of it — beside Blue’s guard. Plant your boots in their front door.',
        placement: 'top', // the action is on the NEAR board rows — box sits high
      },
      () => TASKS.siegeHold.done(g().game),
      () => scriptMove('red-w1', SIEGE_DOOR),
      // Only that Warrior, only onto the one base square beside Blue's guard —
      // any other square leaves the intruder out of reach of the next task.
      { restrict: TASKS.siegeHold.restrict },
    );
    await wait(600);
    await note({
      id: 'siege-lock',
      title: 'Under siege — no respawns',
      body: 'That’s a SIEGE: while ANY enemy stands on a base square, the fallen Mage and Priest CANNOT return — the queue is frozen. Blue’s card carries the SIEGE flag for as long as you hold the square.',
      anchor: '.siege-alert',
      placement: 'bottom',
    });
    beat(afterSiegeLaid); // your go ends; play passes to Blue
    await wait(1100);
    await note({
      id: 'siege-still',
      title: 'A turn later — still locked out',
      body: 'Blue’s turn has begun and the queue hasn’t moved: no Mage, no Priest, as long as the base is held. There is one way out — and for this move, YOU play Blue.',
      anchor: '.player-strip',
      placement: 'bottom',
    });
    await playerTask(
      // Carries on from the siege just laid; a retry re-stages it, siege held.
      () => stage(TASKS.siegeBreak.build),
      {
        id: 'task-siege-break',
        title: 'Break the siege — as Blue',
        body: 'Blue’s last Warrior guards the base. CLICK it, then press SINGLE ATTACK and throw the intruder out.',
        placement: 'top', // the fight is on the near base row — keep it visible
      },
      () => TASKS.siegeBreak.done(g().game),
      () => {
        const siegeRig = [0.99, 0];
        let si = 0;
        S(() => {
          g().selectUnit('blue-w1');
          g().attack('red-w1', ['blue-w1'], () => siegeRig[Math.min(si++, siegeRig.length - 1)]);
        });
      },
      { restrict: TASKS.siegeBreak.restrict },
    );
    await until(() => g().combatRoll !== null, 6000);
    await wait(400);
    {
      const roll = g().combatRoll;
      const lc = g().game.lastCombat;
      const a = roll?.attackRoll ?? lc?.attackRoll ?? 6;
      const d = roll?.defenseRoll ?? lc?.defenseRoll ?? 1;
      await note({
        id: 'siege-broken',
        title: 'The besieger falls',
        body: `Blue rolled ${a}, Red rolled ${d} — the intruder is defeated and Blue’s base is CLEAR. Look at the base: the queue emptied INSTANTLY.`,
        anchor: '.combat-announce',
        placement: 'bottom',
      });
    }
    await wait(600);
    await note({
      id: 'siege-freed',
      title: 'The queue empties — they’re back!',
      body: 'The moment the base cleared, Blue’s Mage AND Priest respawned onto it. Hold an enemy base to keep their leaders dead; break a siege to bring yours home.',
      placement: 'top', // their respawned leaders stand on the near base row
    });

    // ---- Conquest (HANDS-ON: you seal the door and finish it) --------------
    // `sealed` restores the post-siege arrangement — the kill task's re-stage
    // must come back with the base already held, or the kill wouldn't eliminate.
    const stageWin3 = (sealed = false) => stage(sealed ? TASKS.win3Kill.build : TASKS.win3Siege.build);
    stageWin3();
    await wait(700);
    await note({
      id: 'win3-stage',
      title: 'Victory 3 of 3 — Conquest',
      body: 'Blue is down to ONE Warrior; its fallen Mage and Priest are queued. YOU finish this: first seal the door, then destroy the last unit. Kill it too soon and the leaders respawn — the siege must come FIRST.',
      placement: 'top', // the staged endgame sits on the near half of the board
    });
    await playerTask(
      stageWin3,
      {
        id: 'task-win3-siege',
        title: 'Seal the base',
        body: 'CLICK your Warrior standing beside Blue’s base and march it ONTO a base square — with the queue locked out, nobody is coming back.',
        placement: 'top',
      },
      () => TASKS.win3Siege.done(g().game),
      () =>
        S(() => {
          g().selectUnit('red-w4');
          g().moveTo({ r: 15, c: 5 });
        }),
      { restrict: TASKS.win3Siege.restrict },
    );
    await wait(800);
    await note({
      id: 'win3-siege',
      title: 'Under siege',
      body: 'You stand ON Blue’s base — the queued Mage and Priest are locked out, exactly like the siege you laid before. This time, nobody is coming to break it.',
      anchor: '.siege-alert',
      placement: 'bottom',
    });
    await playerTask(
      () => stageWin3(true),
      {
        id: 'task-win3-kill',
        title: 'Destroy the last unit',
        body: 'Two of your Warriors flank Blue’s survivor. CLICK one, then press DOUBLE ATTACK — no units left and no way to respawn is ELIMINATION.',
        placement: 'top',
      },
      () => TASKS.win3Kill.done(g().game),
      () => {
        const rig3 = [0.99, 0.99, 0];
        let i3 = 0;
        S(() => {
          g().selectUnit('red-w1');
          g().attack('blue-w1', ['red-w1', 'red-w2'], () => rig3[Math.min(i3++, rig3.length - 1)]);
        });
      },
      { restrict: TASKS.win3Kill.restrict },
    );
    await until(() => g().combatRoll !== null, 6000);
    await wait(400);
    {
      const roll = g().combatRoll;
      const lc = g().game.lastCombat;
      const a = roll?.attackRoll ?? lc?.attackRoll ?? 12;
      const d = roll?.defenseRoll ?? lc?.defenseRoll ?? 1;
      await note({
        id: 'win3-kill',
        title: 'The last unit falls',
        // The winner panel is already up — sit BESIDE it, never on top of it.
        body: `You rolled ${a} against Blue’s ${d} — the final Blue Warrior is defeated. Zero units on the board and every respawn besieged: Blue is ELIMINATED.`,
        anchor: '.winner',
        placement: 'left',
      });
    }
    await note({
      id: 'win3-done',
      title: 'Conquest Victory!',
      body: 'Last player standing takes the game — the third road to victory. You sealed it and you struck it.',
      anchor: '.winner',
      placement: 'left',
    });

    // ---- Wrap up -----------------------------------------------------------
    await note({
      id: 'wrap',
      title: 'You’ve played it all',
      // Anchored beside the winner panel (its position names vary by layout —
      // the golden book button lives top right on desktop, bottom left on
      // phones, so the text names the BUTTON, not a corner).
      body: 'You moved, fought, resurrected, collected, cast Bolt and Nova, laid a siege and broke one, and won by MageStone, Ritual AND Conquest yourself. The golden Rule Book button has every detail. Go play!',
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
