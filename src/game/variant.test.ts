// The movement allowance (GameState.variant === 'budget'): a go is one
// CONTINUOUS stretch in which a player activates at most three units and moves
// six squares in total between them, and dice are rolled for combat only.
// Unused allowance is lost at the end of the go, never banked, so every go
// opens on a full six. These tests also pin that the dice variant — kept behind
// the flag — is untouched.

import { describe, expect, it } from 'vitest';
import { createGame } from './setup';
import {
  MOVE_BUDGET,
  UNITS_PER_GO,
  NOVA_COST,
  beginRitual,
  boltTargets,
  canAct,
  canNova,
  endActivation,
  isBudget,
  legalMoves,
  mageActionDieValue,
  moveUnit,
  movesLeft,
  resolveBolt,
  resolveNova,
  rollDice,
  slotsLeft,
  syncStones,
  unitById,
} from './rules';
import type { Cell, GameState } from './types';

/** A budget-variant game in its action phase, Red to play. */
function budgetGame(): GameState {
  return createGame(['red', 'blue'], 'diamond'); // budget is now the default
}
const place = (g: GameState, id: string, cell: Cell): GameState => ({
  ...g,
  units: g.units.map((u) => (u.id === id ? { ...u, cell: { ...cell } } : u)),
});
const cellOf = (g: GameState, id: string) => unitById(g, id)!.cell;

/** Hand a Mage `n` Activated stones (sorcery fuel). */
function stones(g: GameState, unitId: string, n: number): GameState {
  const free = g.stones.filter((s) => !s.carrier).slice(0, n).map((s) => s.id);
  return syncStones({
    ...g,
    stones: g.stones.map((s) => (free.includes(s.id) ? { ...s, carrier: unitId, activated: true } : s)),
  });
}

describe('Movement-budget variant', () => {
  it('opens the round with no dice at all, just the allowance', () => {
    const g = budgetGame();
    expect(isBudget(g)).toBe(true);
    expect(g.dice).toEqual([]);
    expect(g.turnPhase).toBe('act');
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET);
    expect(slotsLeft(g, 'red')).toBe(UNITS_PER_GO);
  });

  it('spends exactly the squares walked, and refuses a move it cannot pay for', () => {
    let g = place(budgetGame(), 'red-w1', { r: 5, c: 5 });
    g = moveUnit(g, 'red-w1', '', { r: 9, c: 5 }); // four squares
    expect(cellOf(g, 'red-w1')).toEqual({ r: 9, c: 5 });
    expect(movesLeft(g, 'red')).toBe(2);
    // a three-square move with two left is refused outright
    g = place(g, 'red-w2', { r: 5, c: 7 });
    const tooFar = moveUnit(g, 'red-w2', '', { r: 8, c: 7 });
    expect(tooFar).toBe(g);
    // …but two squares is fine, and empties the allowance
    g = moveUnit(g, 'red-w2', '', { r: 7, c: 7 });
    expect(movesLeft(g, 'red')).toBe(0);
  });

  it('allows at most three units a go, and one activation each', () => {
    let g = budgetGame();
    for (const [i, id] of ['red-w1', 'red-w2', 'red-w3'].entries()) {
      g = place(g, id, { r: 5, c: 4 + i * 2 });
      g = moveUnit(g, id, '', { r: 6, c: 4 + i * 2 });
    }
    expect(slotsLeft(g, 'red')).toBe(0);
    expect(movesLeft(g, 'red')).toBe(3);
    // a fourth unit cannot start, even with squares to spare
    g = place(g, 'red-w4', { r: 5, c: 10 });
    expect(moveUnit(g, 'red-w4', '', { r: 6, c: 10 })).toBe(g);
    expect(canAct(g, 'red-w4')).toBe(false);
    // and a unit that already moved cannot move again
    expect(moveUnit(g, 'red-w1', '', { r: 7, c: 4 })).toBe(g);
  });

  it('counts acting without moving as one of the three activations', () => {
    let g = place(budgetGame(), 'red-m', { r: 8, c: 8 });
    g = place(g, 'blue-w1', { r: 8, c: 9 });
    expect(canAct(g, 'red-m')).toBe(true);
    // the Mage attacks from where it stands: no squares spent, one slot gone
    g = { ...g, unitsActedThisTurn: ['red-m'], unitsMovedThisTurn: [] };
    expect(slotsLeft(g, 'red')).toBe(2);
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET);
  });

  it('flies a Bolt as far as the squares left — and spends them', () => {
    let g = place(budgetGame(), 'red-m', { r: 8, c: 8 });
    g = place(g, 'blue-w1', { r: 8, c: 11 }); // three squares away
    g = stones(g, 'red-m', 2);
    expect(mageActionDieValue(g, 'red-m')).toBe(MOVE_BUDGET); // reach = allowance
    expect(boltTargets(g, 'red-m').map((u) => u.id)).toContain('blue-w1');
    g = resolveBolt(g, 'red-m', 'blue-w1');
    expect(unitById(g, 'blue-w1')).toBeUndefined();
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET - 3); // the flight cost three
  });

  it('counts a walk and a Bolt against the same six squares', () => {
    let g = place(budgetGame(), 'red-m', { r: 5, c: 8 });
    g = place(g, 'blue-w1', { r: 11, c: 8 });
    g = stones(g, 'red-m', 2);
    g = moveUnit(g, 'red-m', '', { r: 8, c: 8 }); // walk three toward it
    expect(movesLeft(g, 'red')).toBe(3);
    // now only three squares of reach are left: a target three away is in range
    expect(mageActionDieValue(g, 'red-m')).toBe(3);
    g = resolveBolt(g, 'red-m', 'blue-w1');
    expect(unitById(g, 'blue-w1')).toBeUndefined();
    expect(movesLeft(g, 'red')).toBe(0); // move 3 + bolt 3 = the whole round
  });

  it('puts a Bolt out of reach once the squares are gone', () => {
    let g = place(budgetGame(), 'red-m', { r: 4, c: 8 });
    g = place(g, 'blue-w1', { r: 11, c: 8 });
    g = stones(g, 'red-m', 2);
    g = moveUnit(g, 'red-m', '', { r: 8, c: 8 }); // four squares walked
    expect(movesLeft(g, 'red')).toBe(2);
    expect(boltTargets(g, 'red-m').map((u) => u.id)).not.toContain('blue-w1'); // three away
    expect(resolveBolt(g, 'red-m', 'blue-w1')).toBe(g);
  });

  it('charges a Nova no squares at all — it has no distance', () => {
    let g = place(budgetGame(), 'red-m', { r: 8, c: 8 });
    g = place(g, 'blue-w1', { r: 8, c: 9 });
    g = place(g, 'blue-w2', { r: 7, c: 7 });
    g = stones(g, 'red-m', NOVA_COST);
    g = { ...g, moveSpent: { red: MOVE_BUDGET } }; // every square already walked
    expect(movesLeft(g, 'red')).toBe(0);
    expect(canNova(g, 'red-m')).toBe(true);
    g = resolveNova(g, 'red-m');
    expect(unitById(g, 'blue-w1')).toBeUndefined();
    expect(unitById(g, 'blue-w2')).toBeUndefined();
  });

  it('keeps the go going — moving a unit does not pass play', () => {
    let g = place(budgetGame(), 'red-w1', { r: 5, c: 5 });
    g = place(g, 'red-w2', { r: 5, c: 7 });
    g = moveUnit(g, 'red-w1', '', { r: 7, c: 5 }); // two squares
    expect(g.current).toBe('red'); // still Red's go
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET - 2);
    g = moveUnit(g, 'red-w2', '', { r: 7, c: 7 }); // two more, same go
    expect(g.current).toBe('red');
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET - 4);
    expect(slotsLeft(g, 'red')).toBe(UNITS_PER_GO - 2);
    g = endActivation(g); // only THIS hands over
    expect(g.current).toBe('blue');
  });

  it('loses whatever is unused — every go opens on a full allowance', () => {
    let g = place(budgetGame(), 'red-w1', { r: 5, c: 5 });
    g = moveUnit(g, 'red-w1', '', { r: 6, c: 5 }); // one square of the six
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET - 1);
    g = endActivation(g); // the other five are thrown away, not banked
    expect(g.current).toBe('blue');
    expect(movesLeft(g, 'blue')).toBe(MOVE_BUDGET);
    g = endActivation(g); // Blue does nothing at all
    expect(g.current).toBe('red');
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET); // a full six again, not one
    expect(slotsLeft(g, 'red')).toBe(UNITS_PER_GO);
    expect(g.unitsMovedThisTurn).toEqual([]); // and red-w1 may march again
  });

  it('counts a round only when play comes full circle', () => {
    let g = budgetGame(); // Red opens round 1
    expect(g.turn).toBe(1);
    g = endActivation(g);
    expect(g.current).toBe('blue');
    expect(g.turn).toBe(1); // mid-round: Blue has yet to go
    g = endActivation(g);
    expect(g.current).toBe('red');
    expect(g.turn).toBe(2); // back to the opener — the round ticks over
  });

  it('gives the defender a WHOLE go to break a Rite, not one unit', () => {
    let g = place(budgetGame(), 'red-p', { r: 7, c: 7 }); // a Nexus square
    g = place(g, 'blue-w1', { r: 4, c: 8 }); // four squares from (8,8)
    g = place(g, 'blue-w2', { r: 4, c: 6 });
    g = beginRitual(g, 'red-p');
    expect(g.ritual).not.toBeNull();
    g = endActivation(g);
    expect(g.current).toBe('blue');
    expect(movesLeft(g, 'blue')).toBe(MOVE_BUDGET);
    // Blue spends a unit on something else FIRST and still gets to the Nexus —
    // under a one-unit activation that first move would have handed Red the win.
    g = moveUnit(g, 'blue-w2', '', { r: 6, c: 6 }); // two squares
    expect(g.current).toBe('blue'); // the go runs on
    expect(g.winner).toBeNull();
    g = moveUnit(g, 'blue-w1', '', { r: 8, c: 8 }); // four more, into the Nexus
    expect(g.ritual).toBeNull(); // broken before it could pay out
    g = endActivation(g);
    expect(g.current).toBe('red');
    expect(g.winner).toBeNull();
  });

  it('alternates strictly — nobody ever takes two goes in a row', () => {
    let g = budgetGame();
    const goes: string[] = [g.current];
    // Each side nudges one unit a square at a time, right through a round
    // boundary and into the next round.
    for (let i = 0; i < 10 && !g.winner; i++) {
      const mover = g.units.find(
        (u) =>
          u.owner === g.current &&
          !g.unitsMovedThisTurn.includes(u.id) &&
          legalMoves(g, u, 1).length > 0,
      );
      if (mover) g = moveUnit(g, mover.id, '', legalMoves(g, mover, 1)[0]);
      g = endActivation(g);
      goes.push(g.current);
    }
    for (let i = 1; i < goes.length; i++) expect(goes[i]).not.toBe(goes[i - 1]);
    expect(g.turn).toBeGreaterThan(1); // the run crossed a round boundary
  });

  it('costs a passer their go and nothing more', () => {
    let g = budgetGame();
    g = endActivation(g); // Red commits nothing — the whole go is forfeit
    expect(g.current).toBe('blue');
    const mover = g.units.find((u) => u.owner === 'blue' && legalMoves(g, u, 1).length > 0)!;
    g = moveUnit(g, mover.id, '', legalMoves(g, mover, 1)[0]);
    g = endActivation(g);
    // Blue does NOT run on into a second go, and Red comes back whole: passing
    // never used to be recoverable inside a round, and now there is nothing to
    // recover — the next go is a clean six.
    expect(g.current).toBe('red');
    expect(g.turn).toBe(2);
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET);
    expect(slotsLeft(g, 'red')).toBe(UNITS_PER_GO);
    expect(g.passed).toEqual([]);
  });

  it('leaves the shipped dice game alone', () => {
    const g = rollDice(createGame(['red', 'blue'], 'diamond', 'dice'));
    expect(isBudget(g)).toBe(false);
    expect(g.dice).toHaveLength(5);
    // a move still needs a real die
    expect(moveUnit(g, 'red-w1', '', { r: 1, c: 4 })).toBe(g);
  });
});
