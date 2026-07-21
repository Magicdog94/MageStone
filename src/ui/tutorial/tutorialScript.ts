import { useGame, type TutRestrict } from '../../store';
import { legalMoves, siegedPlayers, unitById, warriorCount } from '../../game/rules';
import { NEXUS_CELLS } from '../../game/board';
import { createGame } from '../../game/setup';
import type { Callout } from './useTutorial';
import type { Cell, Die, DieKind, GameState } from '../../game/types';
import { useTutorial } from './useTutorial';

const g = () => useGame.getState();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CANCELLED = Symbol('tutorial-cancelled');
function guard() {
  if (!useGame.getState().tutorial) throw CANCELLED;
}
async function note(c: Callout) {
  guard();
  await useTutorial.getState().note(c);
  guard();
}
async function until(pred: () => boolean, timeout = 5000, interval = 120) {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < timeout) {
    await wait(interval);
    guard();
  }
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

async function playerTask(
  setup: (() => void) | null,
  c: Callout,
  pred: () => boolean,
  fallback: () => void | Promise<void>,
  opts: { timeoutMs?: number; restrict?: TutRestrict } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 90000;
  guard();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) setup?.(); // the board may have drifted — line it up again
      await wait(attempt > 0 ? 700 : 0);
      guard();
      g().setTutRestrict(opts.restrict ?? null);
      useTutorial.getState().task(
        attempt === 0 ? c : { ...c, body: `No rush — here it is again. ${c.body}` },
      );
      const t0 = Date.now();
      while (!pred() && Date.now() - t0 < timeoutMs) {
        await wait(150);
        guard();
      }
      g().setTutRestrict(null);
      useTutorial.getState().clearTask();
      if (pred()) return;
    }
  } finally {
    // Skips/cancellations mid-task must lift the guardrails too.
    useGame.getState().setTutRestrict(null);
  }
  await fallback(); // the show must go on
  await until(pred, 8000);
}

// ---- staging ---------------------------------------------------------------

let diceNonce = 0;
function mkDice(kinds: DieKind[], values: number[]): Die[] {
  return kinds.map((kind, i) => ({
    id: `tut-die-${diceNonce++}`,
    kind,
    value: values[i],
    discarded: false,
    usedBy: null,
  }));
}

/** Replace the game with a fresh red-vs-blue board, mutated by `build`, already
 *  in red's action phase with hand-picked dice. */
function stage(build: (st: GameState) => void): void {
  const st = createGame(['red', 'blue'], 'diamond');
  st.turnPhase = 'act';
  build(st);
  useGame.setState({ game: st, selectedUnitId: null, selectedDieId: null, rolling: false });
}

/** Move `unitId` as far toward `target` as this turn's matching die allows. */
function stepToward(unitId: string, target: Cell): boolean {
  const st = g().game;
  const u = unitById(st, unitId);
  if (!u) return false;
  const die = st.dice.find((d) => !d.discarded && d.usedBy === null && d.kind === u.kind);
  if (!die) return false;
  const moves = legalMoves(st, u, die.value);
  if (moves.length === 0) return false;
  const best = moves.reduce((a, b) => (dist(b, target) < dist(a, target) ? b : a));
  g().selectUnit(unitId);
  g().selectDie(die.id);
  g().moveTo(best);
  return true;
}

/** Script-move a unit onto an exact cell (fallbacks for unfinished tasks). */
function scriptMove(unitId: string, dest: Cell): void {
  const st = g().game;
  const u = unitById(st, unitId);
  if (!u) return;
  const die = st.dice.find((d) => !d.discarded && d.usedBy === null && d.kind === u.kind);
  if (!die) return;
  g().selectUnit(unitId);
  g().selectDie(die.id);
  g().moveTo(dest);
}

/**
 * The guided game — HANDS-ON. The player rolls, discards, moves, fights,
 * resurrects, collects, casts, lays and breaks a siege (briefly playing Blue)
 * and WINS all three ways, coached step by step; only Blue's routine beats
 * (its roll/discard) play themselves.
 */
let running = false;

export async function runTutorial(onDone: () => void) {
  if (running) return; // never run two guided sequences at once
  running = true;
  try {
    // Wait for the 3D board to finish loading so the spotlights have something
    // to point at.
    await until(() => !document.querySelector('.loading-gate'), 22000);
    await wait(400);
    guard();

    await note({
      id: 'welcome',
      title: 'Welcome to MageStone',
      body: 'This tutorial is HANDS-ON: you roll, you move, you fight — the coach just points the way. Whenever the note says "Your move…", the game is yours. Let’s go.',
      placement: 'center',
    });
    await note({
      id: 'header',
      title: 'Your scoreboard',
      body: 'One card per team — Red is you. Silver stone = MageStones carried, gold = activated (6 activated on your base wins), the sword counts kills, W your living Warriors. Above: the round number and the shared gravestone bank.',
      anchor: '.player-strip',
      placement: 'bottom',
    });

    // ---- YOU roll ----------------------------------------------------------
    await playerTask(
      () => stage((st) => {
        st.turnPhase = 'roll';
        st.dice = [];
      }),
      {
        id: 'task-roll',
        title: 'Roll your dice',
        body: 'Every turn begins with 5 dice. Press ROLL DICE and watch them tumble — however they land is what you get.',
        anchor: '.actions .primary',
        placement: 'top',
      },
      () => g().game.turnPhase !== 'roll' && !g().rolling,
      () => g().roll(),
      { timeoutMs: 120000, restrict: { units: [], dests: [], actions: ['roll'] } },
    );
    await until(() => !g().rolling, 15000);
    await wait(400);

    await note({
      id: 'dice',
      title: 'Read your dice',
      body: 'The tags name each die: M is your Mage’s, P your Priest’s, W1–W3 belong to your Warriors. A die only moves its MATCHING unit, and its number is how far that unit can go.',
      anchor: '.tray',
      placement: 'top',
    });

    // ---- YOU discard -------------------------------------------------------
    await playerTask(
      null,
      {
        id: 'task-discard',
        title: 'Discard 2 dice',
        body: 'You keep only 3 — click any TWO dice to throw them away. Think about which units you want to use this turn. (Misclick? The UNDO button takes it back.)',
        anchor: '.tray',
        placement: 'top',
      },
      () => g().game.turnPhase === 'act',
      () => {
        const live = g().game.dice.filter((d) => !d.discarded);
        const worst = [...live].sort((a, b) => a.value - b.value).slice(0, 2);
        for (const d of worst) g().discard(d.id);
      },
      // Any two dice are a fine choice — but ONLY discarding (and its Undo).
      { restrict: { units: [], dests: [], actions: ['discard', 'undo'] } },
    );
    await wait(300);
    await note({
      id: 'kept',
      title: 'Three dice, three plays',
      body: 'Your kept dice are your whole turn: each one can move its unit, and a moved unit may then take ONE action — attack, collect, resurrect… Let’s move.',
      placement: 'bottom',
    });

    // ---- YOU move ----------------------------------------------------------
    await playerTask(
      null,
      {
        id: 'task-move',
        title: 'Move a unit',
        body: 'CLICK one of your units (its die is picked automatically), then click any glowing square. Paths are orthogonal — never diagonal — and may bend.',
        placement: 'bottom',
      },
      () => g().game.unitsMovedThisTurn.length >= 1,
      () => {
        const st = g().game;
        const w = st.units.find(
          (u) =>
            u.owner === st.current &&
            st.dice.some((d) => !d.discarded && !d.usedBy && d.kind === u.kind),
        );
        if (w) stepToward(w.id, { r: 8, c: 8 });
      },
      // Any unit, any legal square — but movement only (no ending the turn).
      { restrict: { actions: [] } },
    );
    await wait(500);
    await note({
      id: 'moved',
      title: 'Nicely done',
      body: 'That’s movement: up to the die’s number, through empty squares — units block the way, MageStones and gravestones don’t.',
      placement: 'bottom',
    });

    // ---- YOU attack (staged) ----------------------------------------------
    const stageFight = () =>
      stage((st) => {
        st.units.find((u) => u.id === 'blue-w1')!.cell = { r: 6, c: 7 };
        st.units.find((u) => u.id === 'red-w1')!.cell = { r: 5, c: 7 };
        st.units.find((u) => u.id === 'red-w2')!.cell = { r: 7, c: 7 };
        st.units.find((u) => u.id === 'red-w3')!.cell = { r: 6, c: 6 };
        st.dice = mkDice(['warrior', 'warrior', 'warrior'], [4, 3, 3]);
      });
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
      body: 'Your roll (row) against the defender’s die (column). Defenders roll a d6 — except a Mage, which defends with its power die. Ties always re-roll, so every fight ends decisively.',
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
      () => !unitById(g().game, 'blue-w1') || g().game.lastCombat !== null,
      () => {
        const rig = [0.7, 0.55, 0.99, 0.2];
        let i = 0;
        g().selectUnit('red-w1');
        g().attack('blue-w1', ['red-w1', 'red-w2', 'red-w3'], () => rig[Math.min(i++, rig.length - 1)]);
      },
      {
        timeoutMs: 120000,
        // The three surrounding Warriors, the one enemy, TRIPLE only — no
        // wandering off and breaking the ring.
        restrict: {
          units: ['red-w1', 'red-w2', 'red-w3'],
          dests: [],
          actions: ['attack'],
          targets: ['blue-w1'],
          minAttackers: 3,
        },
      },
    );
    await until(() => g().combatRoll !== null, 6000);
    await wait(400);
    {
      const roll = g().combatRoll;
      const a = roll?.attackRoll ?? 0;
      const d = roll?.defenseRoll ?? 0;
      const won = !unitById(g().game, 'blue-w1');
      await note({
        id: 'fight-result',
        title: won ? 'Down he goes' : 'The 1-in-100 upset!',
        body: won
          ? `Your three dice rolled ${a} against Blue’s ${d} — the defender falls. Stacking attackers is how Warriors win fights.`
          : `Your ${a} lost to Blue’s ${d} — the 1%! When a coordinated attack fails only ONE attacker falls, never the group. That’s dice — and why you stack the odds.`,
        anchor: '.combat-announce',
        placement: 'bottom',
      });
    }
    await note({
      id: 'graverules',
      title: 'A gravestone drops',
      body: 'The fallen Warrior left a gravestone — while the shared bank has stock (3 per player), and never on the Nexus. Gravestones matter, because…',
      anchor: '.grave-bank',
      placement: 'bottom',
    });

    // ---- YOU resurrect (staged) -------------------------------------------
    const stageRes = () =>
      stage((st) => {
        st.units = st.units.filter((u) => u.id !== 'red-w1'); // a warrior has fallen
        const priest = st.units.find((u) => u.id === 'red-p')!;
        priest.cell = { r: 5, c: 9 };
        st.gravestones.push({ id: 'tut-grave-1', cell: { r: 5, c: 11 } });
        st.dice = mkDice(['priest'], [2]);
      });
    stageRes();
    await wait(700);
    await note({
      id: 'priest',
      title: 'The Priest',
      body: 'Priests never attack — and if one WINS its defence it only repels the attacker (nobody dies). Their gift is RESURRECTION. One of your Warriors is down; there’s the gravestone.',
      placement: 'bottom',
    });
    await playerTask(
      stageRes,
      {
        id: 'task-resurrect',
        title: 'Bring your Warrior back',
        body: 'CLICK your Priest, walk it ONTO the gravestone, then press RESURRECT.',
        placement: 'bottom',
      },
      () => warriorCount(g().game, 'red') >= 6,
      async () => {
        scriptMove('red-p', { r: 5, c: 11 });
        await wait(700);
        g().selectUnit('red-p');
        g().doResurrect();
      },
      // Only the Priest, only the gravestone square, only Resurrect.
      { restrict: { units: ['red-p'], dests: [{ r: 5, c: 11 }], actions: ['resurrect'] } },
    );
    await wait(600);
    await note({
      id: 'res-done',
      title: 'A Warrior returns',
      body: 'The Warrior revives on the grave square and the Priest steps back the way it came; the gravestone returns to the bank. A Priest can use ANY gravestone — and you can never have more than 6 Warriors.',
      placement: 'bottom',
    });

    // ---- YOU collect + activate -------------------------------------------
    const stageCollect = () =>
      stage((st) => {
        const mage = st.units.find((u) => u.id === 'red-m')!;
        mage.cell = { r: 4, c: 8 };
        const stone = st.stones.find((x) => !x.collected)!;
        stone.cell = { r: 5, c: 8 };
        st.dice = mkDice(['mage'], [2]);
      });
    stageCollect();
    await wait(700);
    await playerTask(
      stageCollect,
      {
        id: 'task-collect',
        title: 'Collect a MageStone',
        body: 'Your Mage gathers the stones that win games. CLICK your Mage, step ONTO the stone’s square, then press COLLECT.',
        placement: 'bottom',
      },
      () => (unitById(g().game, 'red-m')?.carried ?? 0) > 0,
      async () => {
        scriptMove('red-m', { r: 5, c: 8 });
        await wait(700);
        g().selectUnit('red-m');
        g().collectStones();
      },
      // Only the Mage, only the stone's square, only Collect.
      { restrict: { units: ['red-m'], dests: [{ r: 5, c: 8 }], actions: ['collect'] } },
    );
    await note({
      id: 'carried',
      title: 'Carried — not yet yours',
      body: 'The silver counter ticked up: the stone is CARRIED. Carried stones score nothing yet — and if your Mage dies, it drops them where it fell.',
      anchor: '[data-tut="carried"]',
      placement: 'bottom',
    });
    const stageActivate = () =>
      stage((st) => {
        const mage = st.units.find((u) => u.id === 'red-m')!;
        mage.cell = { r: 0, c: 8 }; // standing on its own base
        mage.carried = 1;
        st.dice = mkDice(['mage'], [2]);
      });
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
      () => (unitById(g().game, 'red-m')?.activated ?? 0) > 0,
      () => {
        g().selectUnit('red-m');
        g().activateStones();
      },
      // The Mage stays home: no movement, just Activate.
      { restrict: { units: ['red-m'], dests: [], actions: ['activate'] } },
    );
    await note({
      id: 'gold',
      title: 'Gold stones are power',
      body: 'Activated stones score toward victory AND upgrade your Mage’s attack die: d6 normally, d12 at 2 stones, d20 at 4+. They can also be SPENT…',
      anchor: '[data-tut="activated"]',
      placement: 'bottom',
    });

    // ---- YOU cast Bolt -----------------------------------------------------
    const stageBolt = () =>
      stage((st) => {
        const mage = st.units.find((u) => u.id === 'red-m')!;
        mage.cell = { r: 8, c: 5 };
        mage.activated = 4;
        st.units.find((u) => u.id === 'blue-w1')!.cell = { r: 8, c: 8 };
        st.dice = mkDice(['mage'], [4]);
      });
    stageBolt();
    await wait(700);
    await playerTask(
      stageBolt,
      {
        id: 'task-bolt',
        title: 'Cast BOLT — 1 stone',
        body: 'A ranged kill: range = the mage die (4 here); only an enemy MAGE can repel it. CLICK your Mage, press BOLT — enemies in range glow — then click the Blue Warrior.',
        placement: 'bottom',
      },
      () => !unitById(g().game, 'blue-w1'),
      () => {
        g().selectUnit('red-m');
        g().castBolt('blue-w1');
      },
      {
        timeoutMs: 120000,
        // Only the Mage, no walking, only Bolt at the staged target.
        restrict: { units: ['red-m'], dests: [], actions: ['bolt'], targets: ['blue-w1'] },
      },
    );
    await wait(1200);
    await note({
      id: 'bolt-stone',
      title: 'The stone disperses',
      body: 'Look at the target’s square: your spent stone landed THERE — still activated, claimable by any Mage. And the cost is real: your Mage dropped from 4 stones (d20) to 3 (d12).',
      placement: 'bottom',
    });

    // ---- YOU cast Nova -----------------------------------------------------
    const stageNova = () =>
      stage((st) => {
        const mage = st.units.find((u) => u.id === 'red-m')!;
        mage.cell = { r: 5, c: 5 };
        mage.activated = 3;
        st.units.find((u) => u.id === 'blue-w1')!.cell = { r: 4, c: 5 };
        st.units.find((u) => u.id === 'blue-w2')!.cell = { r: 6, c: 6 }; // diagonal!
        st.units.find((u) => u.id === 'blue-w3')!.cell = { r: 5, c: 6 };
        st.units.find((u) => u.id === 'red-w1')!.cell = { r: 5, c: 4 }; // friendly — caught too!
        st.dice = mkDice(['mage'], [2]);
      });
    stageNova();
    await wait(700);
    await note({
      id: 'nova-intro',
      title: 'NOVA — 3 stones',
      body: 'Your Mage is mobbed — three enemies, one of them DIAGONAL. Nova destroys EVERY unit within 1 square, diagonals included… and note your own Warrior standing beside it. Nova spares nobody.',
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
      () => !unitById(g().game, 'blue-w2'),
      () => {
        const novaRig = [0.15, 0.5, 0.85];
        let ni = 0;
        g().selectUnit('red-m');
        g().castNova(() => novaRig[Math.min(ni++, novaRig.length - 1)]);
      },
      // Only the Mage, standing its ground, only Nova.
      { restrict: { units: ['red-m'], dests: [], actions: ['nova'] } },
    );
    await wait(1800);
    await note({
      id: 'nova-stones',
      title: 'Count the cost',
      body: 'All three Blue Warriors fell — and so did your own. The three spent stones lie scattered across the blast, still activated, free to claim. Your Mage is back to a d6. Sorcery is power spent — choose your moment.',
      placement: 'bottom',
    });

    // ---- YOU win: MageStone ------------------------------------------------
    const stageWin1 = () =>
      stage((st) => {
        const mage = st.units.find((u) => u.id === 'red-m')!;
        mage.cell = { r: 1, c: 8 };
        mage.carried = 6;
        st.dice = mkDice(['mage'], [2]);
      });
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
      () => g().game.winner === 'red',
      async () => {
        scriptMove('red-m', { r: 0, c: 8 });
        await wait(700);
        g().selectUnit('red-m');
        g().activateStones();
      },
      {
        timeoutMs: 120000,
        // Only the Mage, only home-base squares, only Activate. (Occupied base
        // squares never glow — legalMoves filters them before this list does.)
        restrict: {
          units: ['red-m'],
          dests: Array.from({ length: 8 }, (_, i) => ({ r: 0, c: 4 + i })),
          actions: ['activate'],
        },
      },
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
    const stageWin2 = () =>
      stage((st) => {
        const priest = st.units.find((u) => u.id === 'red-p')!;
        priest.cell = { r: 7, c: 5 };
        st.dice = mkDice(['priest'], [2]);
      });
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
      () => g().game.ritual !== null,
      async () => {
        scriptMove('red-p', { r: 7, c: 7 });
        await wait(700);
        g().selectUnit('red-p');
        g().doRitual();
      },
      // Only the Priest, only into the Nexus, only Begin Ritual.
      { restrict: { units: ['red-p'], dests: [...NEXUS_CELLS], actions: ['ritual'] } },
    );
    await wait(400);
    await note({
      id: 'ritual-lit',
      title: 'The ritual is lit',
      body: 'Now hold it one FULL ROUND: if your Priest dies, leaves, or any enemy steps into the Nexus, it breaks. Blue’s units are far away — watch its turn pass.',
      anchor: '.ritual-flag',
      placement: 'top',
    });
    g().endTurn();
    await wait(600);
    await note({
      id: 'ritual-blue',
      title: 'Blue can’t reach',
      body: 'Blue would need to touch the Nexus or kill the Priest THIS turn — its army is home. The round passes…',
      anchor: '.player-strip',
      placement: 'bottom',
    });
    g().endTurn();
    await wait(700);
    await note({
      id: 'win2-done',
      title: 'Ritual Victory!',
      body: 'Play returned to you with the Priest still holding a clear Nexus — the ritual completes. That’s the second road.',
      anchor: '.winner',
      placement: 'left',
    });

    // ---- Sieges (HANDS-ON: you lay one, then swap sides and break it) ------
    const BLUE_BASE: Cell[] = Array.from({ length: 8 }, (_, i) => ({ r: 15, c: 4 + i }));
    const stageSiege = () =>
      stage((st) => {
        st.units = st.units.filter((u) => u.owner !== 'blue' || u.id === 'blue-w1');
        st.pendingRespawns = [
          { id: 'tut-sg-m', owner: 'blue', kind: 'mage', activated: 0 },
          { id: 'tut-sg-p', owner: 'blue', kind: 'priest' },
        ];
        st.units.find((u) => u.id === 'red-w1')!.cell = { r: 14, c: 8 };
        st.units.find((u) => u.id === 'blue-w1')!.cell = { r: 15, c: 9 }; // guards its base
        st.dice = mkDice(['warrior'], [2]);
      });
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
        body: 'CLICK your Warrior by Blue’s base and march it ONTO a base square — plant your boots in their front door.',
        placement: 'bottom',
      },
      () => siegedPlayers(g().game).includes('blue'),
      () => {
        scriptMove('red-w1', { r: 15, c: 8 });
      },
      // Only that Warrior, only onto Blue's base squares.
      { restrict: { units: ['red-w1'], dests: BLUE_BASE, actions: [] } },
    );
    await wait(600);
    await note({
      id: 'siege-lock',
      title: 'Under siege — no respawns',
      body: 'That’s a SIEGE: while ANY enemy stands on a base square, the fallen Mage and Priest CANNOT return — the queue is frozen. Blue’s card carries the SIEGE flag for as long as you hold the square.',
      anchor: '.siege-alert',
      placement: 'bottom',
    });
    g().endTurn();
    await wait(600);
    g().tutorialRoll([3, 3, 6, 3, 2]);
    await wait(500);
    {
      const dice = g().game.dice;
      g().discard(dice[0].id); // mage die
      g().discard(dice[1].id); // priest die
    }
    await wait(400);
    await note({
      id: 'siege-still',
      title: 'A turn later — still locked out',
      body: 'Blue’s turn has begun and the queue hasn’t moved: no Mage, no Priest, as long as the base is held. There is one way out — and for this move, YOU play Blue.',
      anchor: '.player-strip',
      placement: 'bottom',
    });
    await playerTask(
      null,
      {
        id: 'task-siege-break',
        title: 'Break the siege — as Blue',
        body: 'Blue’s last Warrior guards the base. CLICK it, then press ATTACK and throw the intruder out.',
        placement: 'bottom',
      },
      () => !unitById(g().game, 'red-w1'),
      () => {
        const siegeRig = [0.99, 0];
        let si = 0;
        g().selectUnit('blue-w1');
        g().attack('red-w1', ['blue-w1'], () => siegeRig[Math.min(si++, siegeRig.length - 1)]);
      },
      // Only Blue's Warrior, only the intruder — with scripted dice so the
      // lesson's fight always lands.
      {
        restrict: {
          units: ['blue-w1'],
          dests: [],
          actions: ['attack'],
          targets: ['red-w1'],
          rig: [0.99, 0],
        },
      },
    );
    await until(() => g().combatRoll !== null, 6000);
    await wait(400);
    {
      const roll = g().combatRoll;
      const a = roll?.attackRoll ?? 6;
      const d = roll?.defenseRoll ?? 1;
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
      body: 'The moment the base cleared, Blue’s Mage AND Priest respawned onto it — each on its home square, or the closest free base square if something stands there. Hold an enemy base to keep their leaders dead; break the siege to bring yours home.',
      placement: 'center',
    });

    // ---- Conquest (HANDS-ON: you seal the door and finish it) --------------
    // `sealed` restores the post-siege arrangement — the kill task's re-stage
    // must come back with the base already held, or the kill wouldn't eliminate.
    const stageWin3 = (sealed = false) =>
      stage((st) => {
        st.units = st.units.filter((u) => u.owner !== 'blue' || u.id === 'blue-w1');
        const bw = st.units.find((u) => u.id === 'blue-w1')!;
        bw.cell = { r: 12, c: 8 };
        st.units.find((u) => u.id === 'red-w1')!.cell = { r: 11, c: 8 };
        st.units.find((u) => u.id === 'red-w2')!.cell = { r: 12, c: 7 };
        st.units.find((u) => u.id === 'red-w4')!.cell = sealed ? { r: 15, c: 5 } : { r: 14, c: 5 };
        st.pendingRespawns = [
          { id: 'tut-pr-m', owner: 'blue', kind: 'mage', activated: 0 },
          { id: 'tut-pr-p', owner: 'blue', kind: 'priest' },
        ];
        st.dice = mkDice(['warrior', 'warrior', 'warrior'], [3, 4, 2]);
      });
    stageWin3();
    await wait(700);
    await note({
      id: 'win3-stage',
      title: 'Victory 3 of 3 — Conquest',
      body: 'Blue is down to ONE Warrior; its fallen Mage and Priest are queued. YOU finish this: first seal the door, then destroy the last unit. Kill it too soon and the leaders respawn — the siege must come FIRST.',
      placement: 'center',
    });
    await playerTask(
      stageWin3,
      {
        id: 'task-win3-siege',
        title: 'Seal the base',
        body: 'CLICK your southern Warrior and march it ONTO Blue’s base — with the queue locked out, nobody is coming back.',
        placement: 'bottom',
      },
      () => siegedPlayers(g().game).includes('blue'),
      async () => {
        g().selectUnit('red-w4');
        await wait(250);
        g().moveTo({ r: 15, c: 5 });
      },
      // Only the sealing Warrior, only onto Blue's base squares.
      { restrict: { units: ['red-w4'], dests: BLUE_BASE, actions: [] } },
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
        placement: 'bottom',
      },
      () => !unitById(g().game, 'blue-w1'),
      async () => {
        const rig3 = [0.99, 0.99, 0];
        let i3 = 0;
        g().selectUnit('red-w1');
        g().attack('blue-w1', ['red-w1', 'red-w2'], () => rig3[Math.min(i3++, rig3.length - 1)]);
      },
      // The two flankers, the one survivor, DOUBLE only — scripted dice land it.
      {
        restrict: {
          units: ['red-w1', 'red-w2'],
          dests: [],
          actions: ['attack'],
          targets: ['blue-w1'],
          minAttackers: 2,
          rig: [0.99, 0.99, 0],
        },
      },
    );
    await until(() => g().combatRoll !== null, 6000);
    await wait(400);
    {
      const roll = g().combatRoll;
      const a = roll?.attackRoll ?? 12;
      const d = roll?.defenseRoll ?? 1;
      await note({
        id: 'win3-kill',
        title: 'The last unit falls',
        body: `You rolled ${a} against Blue’s ${d} — the final Blue Warrior is defeated. Zero units on the board and every respawn besieged: Blue is ELIMINATED.`,
        anchor: '.combat-announce',
        placement: 'bottom',
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
      body: 'You rolled, moved, fought, resurrected, collected, cast Bolt and Nova, laid a siege and broke one, and won by MageStone, Ritual AND Conquest yourself. The Rule Book (golden book, top right) has every detail. Go play!',
      placement: 'center',
      gotItLabel: 'Finish',
    });
  } catch (e) {
    if (e !== CANCELLED) throw e;
  } finally {
    useGame.getState().setTutRestrict(null); // never leak guardrails into real play
    running = false;
    onDone();
  }
}
