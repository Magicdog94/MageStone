import { useGame } from '../../store';
import { legalMoves, unitById } from '../../game/rules';
import type { Cell } from '../../game/types';
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
    await note({
      id: 'ritual',
      title: 'Ritual Victory',
      body: 'The Priest can also win the game: move it into the Nexus — the 2×2 heart of the board — with no enemies on those 4 squares, begin a ritual, and survive one full round. That’s a Ritual Victory.',
      placement: 'center',
    });

    // ---- Siege -------------------------------------------------------------
    await note({
      id: 'siege',
      title: 'Under siege',
      body: 'When an enemy stands on your base squares you are UNDER SIEGE: your fallen Mage and Priest cannot respawn until the base is cleared. A player whose last units are locked out this way is eliminated.',
      placement: 'center',
    });

    // ---- MageStones / winning (explained, pointing at the metric) ----------
    await note({
      id: 'stones',
      title: 'MageStones & winning',
      body: 'Move your Mage onto a MageStone to collect it, then back to your base to ACTIVATE it. Activated stones upgrade the Mage’s attack die — d6, d12 at 2, d20 at 4 — and 6 of them while standing on your base is a MageStone Victory.',
      anchor: '[data-tut="activated"]',
      placement: 'bottom',
    });
    await note({
      id: 'conquest',
      title: 'Conquest Victory',
      body: 'The third way to win: wipe every rival out. Eliminate all enemy units (with their respawns besieged or spent) and the last player standing claims a Conquest Victory.',
      placement: 'center',
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

    // ---- Wrap up -----------------------------------------------------------
    await note({
      id: 'wrap',
      title: 'You’ve got the basics!',
      body: 'Three roads to victory: MageStone (6 activated, on your base), Ritual (your Priest holds the Nexus a full round), Conquest (last one standing). That’s everything — go play!',
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
