// Tactical checks for the AI brain: positions where the dice already on the
// table decide the right play. The search is time-bounded, so each position is
// built to have ONE clearly correct answer rather than a close call.

import { beforeAll, describe, expect, it } from 'vitest';
import { createGame } from './setup';
import { inNexus } from './board';
import { chooseAction, setBrainOpts, setSearchBudget } from './bot';
import { moveUnit, syncStones } from './rules';
import type { Cell, Die, GameState } from './types';

/** Red to act, mid-round, on a hand-built shared pool of five dice. */
function position(
  mutate: (g: GameState) => GameState,
  values: { mage: number; priest: number; warrior: [number, number, number] },
): GameState {
  const g = createGame(['red', 'blue'], 'diamond');
  const kinds: Die['kind'][] = ['mage', 'priest', 'warrior', 'warrior', 'warrior'];
  const faces = [values.mage, values.priest, ...values.warrior];
  const dice: Die[] = kinds.map((kind, i) => ({ id: `t${i}`, kind, value: faces[i], usedBy: {} }));
  return mutate({
    ...g,
    turnPhase: 'act',
    current: 'red',
    roundStarter: 'red',
    dice,
    activationDice: [],
    passed: [],
  });
}

const place = (g: GameState, id: string, cell: Cell): GameState => ({
  ...g,
  units: g.units.map((u) => (u.id === id ? { ...u, cell: { ...cell } } : u)),
});

/** Hand `count` loose stone tokens to a unit, already Activated. */
function activatedStones(g: GameState, unitId: string, count: number): GameState {
  const free = g.stones.filter((s) => !s.carrier).slice(0, count).map((s) => s.id);
  return syncStones({
    ...g,
    stones: g.stones.map((s) => (free.includes(s.id) ? { ...s, carrier: unitId, activated: true } : s)),
  });
}

describe('AI brain — reading the dice on the table', () => {
  beforeAll(() => {
    setSearchBudget(300);
    setBrainOpts({ jitter: false });
  });

  it('Bolts an enemy Mage that can walk home and win on a die already rolled', () => {
    // Blue's Mage holds six Activated stones three squares from home, and the
    // shared Mage die (a 5) is still unspent by Blue — it wins on its next
    // activation. Red's Mage has one Activated stone and the same 5 in range.
    const g = position(
      (s) => {
        let t = place(s, 'blue-m', { r: 12, c: 8 });
        t = place(t, 'red-m', { r: 9, c: 8 });
        t = activatedStones(t, 'blue-m', 6);
        return activatedStones(t, 'red-m', 1);
      },
      { mage: 5, priest: 2, warrior: [1, 1, 1] },
    );
    const a = chooseAction(g, 'hard');
    expect(a).toMatchObject({ type: 'bolt', targetId: 'blue-m' });
  });

  it('breaks an enemy Rite in its last round when a die reaches the Nexus', () => {
    // Declared last round: nothing is left to stop it but this round's dice.
    // Red's Warrior stands two squares from an open Nexus square on a 3.
    const g = position(
      (s) => {
        let t = place(s, 'blue-p', { r: 8, c: 8 });
        t = place(t, 'red-w1', { r: 5, c: 7 });
        return { ...t, turn: 5, ritual: { player: 'blue', priestId: 'blue-p', round: 4 } };
      },
      { mage: 1, priest: 1, warrior: [3, 1, 1] },
    );
    const a = chooseAction(g, 'hard');
    expect(a?.type).toBe('move');
    if (a?.type !== 'move') return;
    expect(inNexus(a.dest.r, a.dest.c)).toBe(true);
    expect(moveUnit(g, a.unitId, a.dieId, a.dest).ritual).toBeNull();
  });
});
