// A hand-arranged starting position for the interactive Tutorial mode. It's a
// normal 2-player game (red = the learner, blue = the opponent) with three Red
// Warriors already ringing a Blue Warrior near the centre, ready for the attack
// lesson; the move lesson uses the rest of Red's army.

import { createGame } from './setup';
import { syncStones } from './rules';
import type { Cell, GameState } from './types';

export function createTutorialGame(): GameState {
  const g = createGame(['red', 'blue'], 'diamond');
  const place = (id: string, cell: Cell) => {
    const u = g.units.find((x) => x.id === id);
    if (u) u.cell = { ...cell };
  };

  // Blue's lone Warrior in the middle with three Red Warriors already on three
  // sides of it — the attack lesson's ring, in place from the first frame so
  // nothing is moved about between lessons. Must match tutorialTasks.ts
  // OPENING (a test checks).
  place('blue-w1', { r: 6, c: 7 });
  place('red-w1', { r: 5, c: 7 }); // above the target
  place('red-w2', { r: 7, c: 7 }); // below the target
  place('red-w3', { r: 6, c: 6 }); // left of the target

  // Give the red Mage a couple of carried stones so the "activated MageStones"
  // metric has something to point at during the UI tour. Carrying is a property
  // of the TOKEN, so hand it two real (still Unactivated) stones rather than
  // writing the derived counter.
  const mage = g.units.find((u) => u.id === 'red-m');
  if (mage) {
    for (const s of g.stones.filter((x) => !x.carrier).slice(0, 2)) s.carrier = mage.id;
  }

  return syncStones(g);
}
