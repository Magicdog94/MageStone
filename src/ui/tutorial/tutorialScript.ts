import { useGame } from '../../store';
import { legalMoves, unitById } from '../../game/rules';
import { createGame } from '../../game/setup';
import type { Cell, Die, DieKind, GameState } from '../../game/types';
import { useTutorial } from './useTutorial';

const g = () => useGame.getState();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CANCELLED = Symbol('tutorial-cancelled');
function guard() {
  if (!useGame.getState().tutorial) throw CANCELLED;
}
async function note(c: Parameters<ReturnType<typeof useTutorial.getState>['note']>[0]) {
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

// ---- Victory-demo staging --------------------------------------------------
// Each victory is demonstrated on a freshly-staged board ("even if we have to
// rearrange the pieces") and then PLAYED OUT through the real engine, so the
// learner watches the actual moves, banners and winner panel.

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

/**
 * The guided game. A single async walk-through: it narrates and drives both
 * teams with deterministic dice, pausing on every "Got it". Throws CANCELLED if
 * the player skips (the caller swallows it).
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
      body: 'A quick guided game. Both teams play automatically — just read each note and press Got it. Let’s tour the screen first.',
      placement: 'center',
    });

    // ---- UI tour -----------------------------------------------------------
    await note({
      id: 'players',
      title: 'The players',
      body: 'Each card is a team — Red (you) vs Blue. The glowing card shows whose turn it is.',
      anchor: '.player-strip',
      placement: 'bottom',
    });
    await note({
      id: 'carried',
      title: 'MageStones carried',
      body: 'The silver stone is how many MageStones your Mage is carrying but has NOT activated yet.',
      anchor: '[data-tut="carried"]',
      placement: 'bottom',
    });
    await note({
      id: 'activated',
      title: 'Activated MageStones',
      body: 'The gold stone is your ACTIVATED MageStones. Activate 6 and stand on your base to win.',
      anchor: '[data-tut="activated"]',
      placement: 'bottom',
    });
    await note({
      id: 'kills',
      title: 'Kills',
      body: 'The sword counts enemies your team has defeated.',
      anchor: '[data-tut="kills"]',
      placement: 'bottom',
    });
    await note({
      id: 'turnchip',
      title: 'Round counter',
      body: 'This is the round number. It ticks up when play returns to the first player.',
      anchor: '.turn-chip',
      placement: 'bottom',
    });
    await note({
      id: 'grave',
      title: 'Gravestone bank',
      body: 'Gravestones left to place. When a Warrior falls it drops one here — and a Priest can resurrect a Warrior from a gravestone.',
      anchor: '.grave-bank',
      placement: 'bottom',
    });
    await note({
      id: 'gear',
      title: 'Settings',
      body: 'Options and a new game live behind the gear, any time. Beside it: the Rule Book, music, fullscreen — and the CAMERA LOCK, which fixes the camera and turns the board to face whoever is playing.',
      // BELOW the gear — a 'left' box would cover the music/fullscreen toggles
      // that share this top-right row.
      anchor: '.gear',
      placement: 'bottom',
    });

    // ---- Roll --------------------------------------------------------------
    await note({
      id: 'rollbtn',
      title: 'Your turn — roll',
      body: 'Every turn begins by rolling 5 dice: 1 Mage, 1 Priest and 3 Warrior dice.',
      anchor: '.actions .primary',
      placement: 'top',
    });
    g().tutorialRoll([2, 2, 4, 3, 2]);
    await wait(500);
    await note({
      id: 'dice',
      title: 'Your 5 dice',
      body: 'The BLUE die is your Mage’s, the GREEN one your Priest’s, and the three RED dice belong to your Warriors. A die only moves its MATCHING unit, and the number is how far it can move.',
      anchor: '.tray',
      placement: 'top',
    });

    // ---- Discard -----------------------------------------------------------
    await note({
      id: 'discard',
      title: 'Discard 2 dice',
      body: 'You must discard 2 dice and keep 3 — those 3 are all you can do this turn. Discard the Mage or Priest die and that unit sits the turn out; the Warrior dice are shared by ALL your Warriors. We’ll keep our three Warrior dice.',
      anchor: '.tray',
      placement: 'top',
    });
    {
      const dice = g().game.dice;
      g().discard(dice[0].id); // mage
      g().discard(dice[1].id); // priest
    }
    await wait(400);

    // ---- Movement ----------------------------------------------------------
    await note({
      id: 'move',
      title: 'Move your units',
      body: 'Now the action phase — move up to 3 units. Watch a Warrior march up beside the lone Blue Warrior in the middle.',
      anchor: '.tray',
      placement: 'top',
    });
    g().selectUnit('red-w3');
    await wait(250);
    g().moveTo({ r: 6, c: 6 });
    await wait(750);
    await note({
      id: 'moved',
      title: 'It moved!',
      body: 'A move is an orthogonal path (never diagonal) up to the die’s value, and it may bend. Units block the way — MageStones and gravestones don’t. Now three of your Warriors surround the enemy.',
      placement: 'center',
    });

    // ---- Attack + coordination --------------------------------------------
    g().selectUnit('red-w3');
    await wait(250);
    await note({
      id: 'attackbtns',
      title: 'Attack — and coordinate',
      body: 'Adjacent enemies can be attacked from here. Warriors COORDINATE: 1 Warrior rolls 1 die (50% to win), 2 roll 2 dice (90%), 3 roll 3 dice (99%) — every extra attacker stacks the odds. Each button shows your win chance.',
      anchor: '.unit-actions',
      placement: 'top',
    });
    await note({
      id: 'oddsgrid',
      title: 'Know your odds',
      body: 'Your roll (row) against the defender’s die (column). The defender rolls a d6 — unless it’s a Mage, which defends with its power die. Ties are always re-rolled, so a fight is never a stalemate.',
      placement: 'center',
      showOdds: true,
    });
    // Scripted dice (5+4+6 = 15 vs 2) so the lesson always ends in a win — the
    // learner should see coordination pay off, not a 1-in-100 upset.
    const rig = [0.7, 0.55, 0.99, 0.2];
    let rigI = 0;
    g().attack('blue-w1', ['red-w3', 'red-w1', 'red-w2'], () => rig[Math.min(rigI++, rig.length - 1)]);
    await until(() => g().combatRoll !== null, 5000);
    await wait(400);
    {
      const roll = g().combatRoll;
      const a = roll?.attackRoll ?? 15;
      const d = roll?.defenseRoll ?? 2;
      await note({
        id: 'combatresult',
        title: 'Why Red won',
        body: `Red rolled ${a} with its three dice; Blue’s defender rolled ${d}. ${a} beats ${d}, so Red wins this fight and the Blue Warrior is defeated.`,
        anchor: '.combat-announce',
        placement: 'bottom',
      });
    }

    // ---- Gravestones -------------------------------------------------------
    await note({
      id: 'graverules',
      title: 'A gravestone drops',
      body: 'The fallen Warrior left a gravestone on its square — but only while this shared bank has stock (3 per player). And NEVER in the Nexus: a Warrior slain on the centre 2×2 leaves nothing.',
      anchor: '.grave-bank',
      placement: 'bottom',
    });

    // ---- A coordinated attack that FAILS (and what happens next) -----------
    stage((st) => {
      st.units.find((u) => u.id === 'blue-w1')!.cell = { r: 5, c: 10 };
      st.units.find((u) => u.id === 'red-w1')!.cell = { r: 4, c: 10 };
      st.units.find((u) => u.id === 'red-w2')!.cell = { r: 6, c: 10 };
      st.units.find((u) => u.id === 'red-p')!.cell = { r: 4, c: 8 };
      st.dice = mkDice(['warrior', 'warrior', 'priest'], [3, 3, 2]);
    });
    await wait(700);
    await note({
      id: 'fail-stage',
      title: 'Attacks can fail',
      body: 'A new example: TWO Red Warriors flank a Blue Warrior — a Double Attack, 2d6 vs d6, 90% to win. But 90% is not 100%. Watch this one hit the unlucky side…',
      placement: 'bottom',
    });
    g().selectUnit('red-w1');
    await wait(250);
    {
      // rigged to LOSE: 1+1 = 2 vs the defender's 6
      const failRig = [0, 0, 0.99];
      let fi = 0;
      g().attack('blue-w1', ['red-w1', 'red-w2'], () => failRig[Math.min(fi++, failRig.length - 1)]);
    }
    await until(() => g().combatRoll !== null, 5000);
    await wait(400);
    {
      const roll = g().combatRoll;
      const a = roll?.attackRoll ?? 2;
      const d = roll?.defenseRoll ?? 6;
      await note({
        id: 'fail-result',
        title: 'The attack fails',
        body: `Red rolled ${a}, Blue rolled ${d} — the defender wins. When a coordinated attack fails, only ONE attacker falls (never the whole group), and it leaves a gravestone where it stood.`,
        anchor: '.combat-announce',
        placement: 'bottom',
      });
    }

    // ---- Priest: repel rule + a real resurrection ---------------------------
    await note({
      id: 'priest',
      title: 'The Priest',
      body: 'Priests never attack — and if one WINS its defence it only repels the attacker (no one dies). Their real power: resurrection. Red’s Priest stands two squares from that fresh gravestone. Watch.',
      placement: 'bottom',
    });
    g().selectUnit('red-p');
    await wait(250);
    g().moveTo({ r: 4, c: 10 });
    await wait(800);
    await note({
      id: 'resurrect-press',
      title: 'Resurrect',
      body: 'Standing on ANY gravestone — no matter whose Warrior fell there — unlocks RESURRECT.',
      anchor: '.unit-actions',
      placement: 'top',
    });
    g().doResurrect();
    await wait(900);
    await note({
      id: 'resurrect-done',
      title: 'A Warrior returns',
      body: 'The Warrior revives on the gravestone square and the Priest politely steps back the way it came. The gravestone returns to the bank. You can never have more than 6 Warriors alive.',
      placement: 'bottom',
    });
    // ---- MageStones (explained here; the victory is DEMONSTRATED later) ----
    await note({
      id: 'stones',
      title: 'MageStones',
      body: 'Move your Mage onto a MageStone to collect it, then back to your base to ACTIVATE it. Activated stones also upgrade the Mage’s attack die — d6, then d12 at 2, d20 at 4.',
      anchor: '[data-tut="activated"]',
      placement: 'bottom',
    });

    // ---- Collect one for real ----------------------------------------------
    stage((st) => {
      const mage = st.units.find((u) => u.id === 'red-m')!;
      mage.cell = { r: 4, c: 8 };
      const stone = st.stones.find((x) => !x.collected)!;
      stone.cell = { r: 5, c: 8 };
      st.dice = mkDice(['mage'], [2]);
    });
    await wait(700);
    await note({
      id: 'collect-stage',
      title: 'Try it: collect a stone',
      body: 'Red’s Mage stands beside a MageStone. Watch it step onto the stone’s square…',
      placement: 'bottom',
    });
    g().selectUnit('red-m');
    await wait(250);
    g().moveTo({ r: 5, c: 8 });
    await wait(800);
    await note({
      id: 'collect-press',
      title: 'Collect',
      body: 'Standing on a stone unlocks the COLLECT action down here.',
      anchor: '.unit-actions',
      placement: 'top',
    });
    g().collectStones();
    await wait(400);
    await note({
      id: 'collect-done',
      title: 'Picked up!',
      body: 'The silver counter ticks to 1 — the stone is CARRIED. Haul it home to your base and ACTIVATE it to make it count.',
      anchor: '[data-tut="carried"]',
      placement: 'bottom',
    });

    // ---- Mage powers: Bolt ---------------------------------------------------
    stage((st) => {
      const mage = st.units.find((u) => u.id === 'red-m')!;
      mage.cell = { r: 8, c: 5 };
      mage.activated = 4;
      st.units.find((u) => u.id === 'blue-w1')!.cell = { r: 8, c: 8 };
      st.dice = mkDice(['mage'], [4]);
    });
    await wait(700);
    await note({
      id: 'power-intro',
      title: 'Mage powers',
      body: 'Activated stones are more than a score — they can be SPENT as sorcery. Red’s Mage holds 4 activated stones, and its die shows 4.',
      placement: 'center',
    });
    g().selectUnit('red-m');
    await wait(250);
    await note({
      id: 'power-bolt',
      title: 'Bolt — 1 stone',
      body: 'A ranged strike on ANY enemy within as many squares as the mage die shows (here: 4). Only an enemy Mage may roll to repel — everything else is destroyed outright.',
      anchor: '.unit-actions',
      placement: 'top',
    });
    // arm bolt mode so the board highlights every enemy in range
    g().setBoltMode(true);
    await wait(350);
    await note({
      id: 'power-bolt-range',
      title: 'Range 4 — targets light up',
      body: 'With Bolt armed, every enemy within range glows on the board. The Blue Warrior three squares away is in reach. Fire!',
      placement: 'bottom',
    });
    g().castBolt('blue-w1');
    await wait(1600);
    await note({
      id: 'power-bolt-stone',
      title: 'The stone disperses',
      body: 'Look at the target’s square: the spent stone landed THERE — still ACTIVATED (gold), waiting for any Mage to claim it. And the cost is real: Red’s Mage dropped from 4 activated stones (d20) to 3 (d12).',
      placement: 'bottom',
    });

    // ---- Mage powers: Nova ---------------------------------------------------
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
    await wait(700);
    await note({
      id: 'power-nova',
      title: 'Nova — 3 stones',
      body: 'Three enemies crowd Red’s Mage — one of them DIAGONALLY. NOVA destroys EVERY unit within 1 square of the Mage, diagonals included… and note Red’s own Warrior standing beside it. Nova spares nobody, friend or foe, and nothing can repel it.',
      placement: 'bottom',
    });
    g().selectUnit('red-m');
    await wait(250);
    {
      const novaRig = [0.15, 0.5, 0.85];
      let ni = 0;
      g().castNova(() => novaRig[Math.min(ni++, novaRig.length - 1)]);
    }
    await wait(1800);
    await note({
      id: 'power-nova-aftermath',
      title: 'Everything within 1 square fell',
      body: 'All three Blue Warriors are gone — and so is Red’s own Warrior. The blast is the full ring around the Mage: use it when you’re mobbed, and keep friends clear.',
      placement: 'bottom',
    });
    await note({
      id: 'power-nova-stones',
      title: 'Watch the stones scatter',
      body: 'Now look at the board around the Mage: the THREE spent stones lie scattered across the 3×3 blast area — gold, still activated, free for any Mage to walk over and claim. Red’s Mage is down to 0 stones, so its power die is back to a d6. Sorcery is power spent — choose your moment.',
      placement: 'bottom',
    });

    // ---- End turn ----------------------------------------------------------
    await note({
      id: 'endturn',
      title: 'End your turn',
      body: 'When you’re done acting, end the turn and play passes on.',
      anchor: '.actions .primary',
      placement: 'top',
    });
    g().endTurn();
    await wait(600);

    // ---- Opponent's turn ---------------------------------------------------
    await note({
      id: 'oppturn',
      title: 'The opponent plays',
      body: 'Now Blue takes a turn. In a real match every rival is another person online or an AI bot — they roll, discard and move just like you.',
      anchor: '.player-strip',
      placement: 'bottom',
    });
    g().tutorialRoll([3, 3, 4, 3, 2]);
    await wait(500);
    {
      const dice = g().game.dice;
      g().discard(dice[0].id);
      g().discard(dice[1].id);
    }
    await wait(400);
    // Advance a Blue Warrior toward the centre so there's a visible move.
    stepToward('blue-w4', { r: 8, c: 8 });
    await wait(700);
    await note({
      id: 'oppmoved',
      title: 'Blue advances',
      body: 'Blue pushed a Warrior toward the middle — the fight for the MageStones is on.',
      placement: 'center',
    });
    g().selectUnit(null);
    g().endTurn();
    await wait(500);

    // ---- Sieges: respawns blocked… ------------------------------------------
    stage((st) => {
      // Blue's Mage & Priest fell earlier and wait in the respawn queue; a red
      // Warrior stands ON Blue's base, locking the door. (Staged directly —
      // an engine step would otherwise respawn them while the base is clear.)
      st.units = st.units.filter(
        (u) => u.owner !== 'blue' || u.id === 'blue-w1' || u.id === 'blue-w2',
      );
      st.pendingRespawns = [
        { id: 'tut-sg-m', owner: 'blue', kind: 'mage', activated: 0 },
        { id: 'tut-sg-p', owner: 'blue', kind: 'priest' },
      ];
      st.units.find((u) => u.id === 'red-w1')!.cell = { r: 15, c: 8 };
      st.units.find((u) => u.id === 'blue-w1')!.cell = { r: 14, c: 8 };
      st.units.find((u) => u.id === 'blue-w2')!.cell = { r: 13, c: 10 };
      st.dice = mkDice(['warrior'], [2]);
    });
    await wait(700);
    await note({
      id: 'siege-intro',
      title: 'Sieges',
      body: 'New scene: Blue’s Mage and Priest have fallen. Normally they respawn on Blue’s base — but a RED Warrior is standing on it. Look at the bottom edge of the board.',
      placement: 'center',
    });
    await note({
      id: 'siege-lock',
      title: 'Under siege — no respawns',
      body: 'While ANY enemy stands on a base square, that player’s fallen Mage and Priest CANNOT return — they wait in a queue. Blue’s card shows the waiting Priest (P…) and the SIEGE flag.',
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
      body: 'Blue’s turn has begun and the queue hasn’t moved: no Mage, no Priest, as long as the base is held. Blue has one way out — break the siege by force.',
      anchor: '.player-strip',
      placement: 'bottom',
    });
    g().selectUnit('blue-w1');
    await wait(250);
    {
      // rigged so the besieged player wins: 6 vs 1
      const siegeRig = [0.99, 0];
      let si = 0;
      g().attack('red-w1', ['blue-w1'], () => siegeRig[Math.min(si++, siegeRig.length - 1)]);
    }
    await until(() => g().combatRoll !== null, 5000);
    await wait(400);
    {
      const roll = g().combatRoll;
      const a = roll?.attackRoll ?? 6;
      const d = roll?.defenseRoll ?? 1;
      await note({
        id: 'siege-broken',
        title: 'The besieger falls',
        body: `Blue rolled ${a}, Red rolled ${d} — the intruder is defeated and Blue’s base is CLEAR. Now watch what happens the moment the turn ends…`,
        anchor: '.combat-announce',
        placement: 'bottom',
      });
    }
    g().selectUnit(null);
    g().endTurn();
    await wait(1200);
    await note({
      id: 'siege-freed',
      title: 'The queue empties — they’re back!',
      body: 'The base is free, so Blue’s Mage AND Priest respawn onto it immediately — each on its home square, or the closest free base square if something stands there. That is the whole siege game: hold an enemy base to keep their leaders dead — break the siege to bring yours home.',
      placement: 'center',
    });

    // ---- The three victories, each STAGED and played out for real ----------
    await note({
      id: 'wins-intro',
      title: 'The three ways to win',
      body: 'Now watch each victory actually happen. We’ll rearrange the board for every demonstration and play it out with real moves.',
      placement: 'center',
    });

    // -- 1/3 MageStone victory ------------------------------------------------
    stage((st) => {
      const mage = st.units.find((u) => u.id === 'red-m')!;
      mage.cell = { r: 1, c: 8 };
      mage.carried = 6;
      st.dice = mkDice(['mage'], [2]);
    });
    await wait(700);
    await note({
      id: 'win1-stage',
      title: 'Victory 1 of 3 — MageStone',
      body: 'We’ve staged Red’s Mage one square from its base, carrying SIX MageStones — the silver 6 on Red’s card. Watch it march home.',
      anchor: '[data-tut="carried"]',
      placement: 'bottom',
    });
    g().selectUnit('red-m');
    await wait(250);
    g().moveTo({ r: 0, c: 8 });
    await wait(800);
    await note({
      id: 'win1-activate',
      title: 'Activate on the base',
      body: 'The Mage stands on its own base, so it may ACTIVATE — silver turns gold. Six activated while standing on your base wins on the spot.',
      anchor: '[data-tut="carried"]',
      placement: 'bottom',
    });
    g().activateStones();
    await wait(700);
    await note({
      id: 'win1-done',
      title: 'MageStone Victory!',
      body: 'The winner panel names the method. Six golden stones, carried home and lit on the base — that’s the MageStone Victory.',
      anchor: '.winner',
      placement: 'left',
    });

    // -- 2/3 Ritual victory ---------------------------------------------------
    stage((st) => {
      const priest = st.units.find((u) => u.id === 'red-p')!;
      priest.cell = { r: 7, c: 5 };
      st.dice = mkDice(['priest'], [2]);
    });
    await wait(700);
    await note({
      id: 'win2-stage',
      title: 'Victory 2 of 3 — Ritual',
      body: 'Fresh board. Red’s Priest stands two squares from the NEXUS — the 2×2 heart of the board. Watch it step in.',
      placement: 'bottom',
    });
    g().selectUnit('red-p');
    await wait(250);
    g().moveTo({ r: 7, c: 7 });
    await wait(800);
    await note({
      id: 'win2-begin',
      title: 'Begin the ritual',
      body: 'In the Nexus, with no enemies on its 4 squares, the Priest may BEGIN RITUAL.',
      anchor: '.unit-actions',
      placement: 'top',
    });
    g().doRitual();
    await wait(500);
    await note({
      id: 'win2-flag',
      title: 'The ritual is lit',
      body: 'Now Red must survive one FULL ROUND. If the Priest is killed, the Priest leaves, or any enemy steps into the Nexus, the ritual breaks.',
      anchor: '.ritual-flag',
      placement: 'top',
    });
    g().endTurn();
    await wait(500);
    await note({
      id: 'win2-blue',
      title: 'Blue’s turn passes…',
      body: 'Blue would need to reach the Nexus or the Priest this turn — its units are all the way back home. They can’t.',
      anchor: '.player-strip',
      placement: 'bottom',
    });
    g().endTurn();
    await wait(700);
    await note({
      id: 'win2-done',
      title: 'Ritual Victory!',
      body: 'Play returned to Red with the Priest still holding a clear Nexus — the ritual completes and Red wins.',
      anchor: '.winner',
      placement: 'left',
    });

    // -- 3/3 Siege → Conquest victory ------------------------------------------
    stage((st) => {
      // Blue is down to a single Warrior; its Mage & Priest sit in the respawn
      // queue. Red has a warrior poised beside Blue's base and two more
      // flanking the last Blue unit.
      st.units = st.units.filter((u) => u.owner !== 'blue' || u.id === 'blue-w1');
      const bw = st.units.find((u) => u.id === 'blue-w1')!;
      bw.cell = { r: 12, c: 8 };
      st.units.find((u) => u.id === 'red-w1')!.cell = { r: 11, c: 8 };
      st.units.find((u) => u.id === 'red-w2')!.cell = { r: 12, c: 7 };
      st.units.find((u) => u.id === 'red-w4')!.cell = { r: 14, c: 5 };
      st.pendingRespawns = [
        { id: 'tut-pr-m', owner: 'blue', kind: 'mage', activated: 0 },
        { id: 'tut-pr-p', owner: 'blue', kind: 'priest' },
      ];
      st.dice = mkDice(['warrior', 'warrior', 'warrior'], [3, 4, 2]);
    });
    await wait(700);
    await note({
      id: 'win3-stage',
      title: 'Victory 3 of 3 — Conquest',
      body: 'Blue is down to ONE Warrior; its fallen Mage and Priest are queued to respawn at home. First, Red seals that door shut.',
      placement: 'center',
    });
    g().selectUnit('red-w4');
    await wait(250);
    g().moveTo({ r: 15, c: 5 });
    await wait(800);
    await note({
      id: 'win3-siege',
      title: 'Under siege',
      body: 'Red now stands ON Blue’s base — Blue is UNDER SIEGE, and its queued Mage and Priest are locked out, exactly as you saw earlier. This time, nobody is coming to break it.',
      anchor: '.siege-alert',
      placement: 'bottom',
    });
    g().selectUnit('red-w1');
    await wait(250);
    {
      const rig3 = [0.99, 0.99, 0];
      let i3 = 0;
      g().attack('blue-w1', ['red-w1', 'red-w2'], () => rig3[Math.min(i3++, rig3.length - 1)]);
    }
    await until(() => g().combatRoll !== null, 5000);
    await wait(400);
    {
      const roll = g().combatRoll;
      const a = roll?.attackRoll ?? 12;
      const d = roll?.defenseRoll ?? 1;
      await note({
        id: 'win3-kill',
        title: 'The last unit falls',
        body: `Red rolled ${a}, Blue rolled ${d} — the final Blue Warrior is defeated. Zero units on the board and every respawn besieged: Blue is ELIMINATED.`,
        anchor: '.combat-announce',
        placement: 'bottom',
      });
    }
    await note({
      id: 'win3-done',
      title: 'Conquest Victory!',
      body: 'Last player standing takes the game — that’s Conquest, the third road to victory.',
      anchor: '.winner',
      placement: 'left',
    });

    // ---- Wrap up -----------------------------------------------------------
    await note({
      id: 'wrap',
      title: 'You’ve got the basics!',
      body: 'You’ve now seen all three victory methods; MageStone, Ritual and Conquest. Go play!',
      placement: 'center',
      gotItLabel: 'Finish',
    });
  } catch (e) {
    if (e !== CANCELLED) throw e;
  } finally {
    running = false;
    onDone();
  }
}
