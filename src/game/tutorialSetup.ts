// A hand-arranged starting position for the interactive Tutorial mode. It's a
// normal 2-player game (red = the learner, blue = the opponent) but with a few
// units pre-placed around the centre so the guided script can demonstrate
// movement and a coordinated Warrior attack within the very first turn, instead
// of the many turns it would take from the default home formations.

import { createGame } from './setup';
import type { Cell, GameState } from './types';

export function createTutorialGame(): GameState {
  const g = createGame(['red', 'blue'], 'diamond');
  const place = (id: string, cell: Cell) => {
    const u = g.units.find((x) => x.id === id);
    if (u) u.cell = { ...cell };
  };

  // Blue lone Warrior in the middle — the target of the demo attack.
  place('blue-w1', { r: 6, c: 7 });
  // Two red Warriors already flanking it (top and right), plus a third a couple
  // of squares to the west that the script walks in to complete the encirclement
  // and demonstrate a full Triple Attack (mover re-uses its move die).
  place('red-w1', { r: 5, c: 7 }); // above the target
  place('red-w2', { r: 6, c: 8 }); // right of the target
  place('red-w3', { r: 6, c: 4 }); // the mover → steps to (6,6), west of target

  // Give the red Mage a couple of carried stones so the "activated MageStones"
  // metric has something to point at during the UI tour.
  const mage = g.units.find((u) => u.id === 'red-m');
  if (mage) mage.carried = 2;

  return g;
}
