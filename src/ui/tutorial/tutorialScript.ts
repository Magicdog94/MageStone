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
      body: 'Options and a new game live behind the gear, any time.',
      anchor: '.gear',
      placement: 'left',
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
      body: 'A die only moves its MATCHING unit — Mage die → Mage, Priest die → Priest, Warrior die → a Warrior. The number is how far it can move.',
      anchor: '.tray',
      placement: 'top',
    });

    // ---- Discard -----------------------------------------------------------
    await note({
      id: 'discard',
      title: 'Discard 2 dice',
      body: 'You must discard 2 dice and keep 3 — those 3 are all you can do this turn. We’ll drop the Mage and Priest dice and keep our three Warrior dice.',
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
      body: 'A move is an orthogonal path (it can bend) up to the die’s value, through empty squares. Now three of your Warriors surround the enemy.',
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

    // ---- Priest: resurrect + Ritual victory --------------------------------
    await note({
      id: 'priest',
      title: 'The Priest',
      body: 'Priests never attack — and if one WINS its defence it only repels the attacker (no one dies). Their power: stand a Priest on any gravestone to RESURRECT a Warrior there (up to 6 alive).',
      placement: 'center',
    });
    // ---- MageStones (explained here; the victory is DEMONSTRATED later) ----
    await note({
      id: 'stones',
      title: 'MageStones',
      body: 'Move your Mage onto a MageStone to collect it, then back to your base to ACTIVATE it. Activated stones also upgrade the Mage’s attack die — d6, then d12 at 2, d20 at 4.',
      anchor: '[data-tut="activated"]',
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
      placement: 'center',
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
      body: 'Red now stands ON Blue’s base — Blue is UNDER SIEGE. While any enemy holds a base square, that player’s fallen Mage and Priest CANNOT respawn.',
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
