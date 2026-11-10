import { beforeAll, describe, expect, it } from 'vitest';
import { createGame } from './setup';
import { setSearchBudget } from './bot';
import { explainHint, suggestHint } from './hint';
import { syncStones } from './rules';
import type { GameState } from './types';

const place = (g: GameState, id: string, r: number, c: number): GameState => ({
  ...g,
  units: g.units.map((u) => (u.id === id ? { ...u, cell: { r, c } } : u)),
});

describe('Hints for Easy/Medium games', () => {
  beforeAll(() => setSearchBudget(120));

  it('suggests a real play on the opening board, with a square to light', () => {
    const h = suggestHint(createGame(['red', 'blue'], 'diamond'));
    expect(h.action).not.toBeNull();
    expect(h.text.length).toBeGreaterThan(10);
    if (h.action?.type === 'move') expect(h.cell).toEqual(h.action.dest);
  });

  it('says to End Turn when there is nothing to do', () => {
    const h = explainHint(createGame(['red', 'blue'], 'diamond'), null);
    expect(h.text).toMatch(/End Turn/);
    expect(h.cell).toBeNull();
  });

  it('explains taking stones home', () => {
    let g = place(createGame(['red', 'blue'], 'diamond'), 'red-m', 3, 8);
    g = syncStones({
      ...g,
      stones: g.stones.map((s, i) => (i < 2 ? { ...s, carrier: 'red-m', activated: false } : s)),
    });
    const base = { r: 0, c: 8 };
    const h = explainHint(g, { type: 'move', unitId: 'red-m', dieId: '', dest: base });
    expect(h.text).toMatch(/activate/);
  });

  it('points at the Nexus when an enemy Ritual is burning', () => {
    const g: GameState = {
      ...createGame(['red', 'blue'], 'diamond'),
      ritual: { player: 'blue', priestId: 'blue-p', round: 1, returns: 0 },
    };
    const h = explainHint(g, { type: 'move', unitId: 'red-w1', dieId: '', dest: { r: 7, c: 7 } });
    expect(h.text).toMatch(/breaks their Ritual/);
  });
});
