// The movement allowance (GameState.variant === 'budget'): a go is one
// CONTINUOUS stretch in which a player moves six squares in total, divided
// between AS MANY UNITS AS THEY LIKE, and dice are rolled for combat only.
// Unused allowance is lost at the end of the go, never banked, so every go
// opens on a full six. These tests also pin that the dice variant — kept behind
// the flag — is untouched.

import { describe, expect, it } from 'vitest';
import { createGame } from './setup';
import {
  MOVE_BUDGET,
  NOVA_COST,
  beginRitual,
  boltTargets,
  canAct,
  canNova,
  carriedStones,
  endActivation,
  isBudget,
  legalMoves,
  mageActionDieValue,
  moveUnit,
  movesLeft,
  resolveBolt,
  resolveNova,
  rollDice,
  syncStones,
  unitById,
  unitsActivated,
  warriorCount,
} from './rules';
import { sameCell } from './board';
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

  // ---- landing on something picks it up (v0.11) --------------------------

  it('collects a MageStone just by landing on it, and that ends the Mage\'s go', () => {
    let g = budgetGame();
    const stone = g.stones.find((s) => !s.carrier)!;
    const from = { r: stone.cell.r - 2, c: stone.cell.c };
    g = place(g, 'red-m', from);
    expect(carriedStones(g, 'red-m')).toHaveLength(0);
    g = moveUnit(g, 'red-m', '', stone.cell); // two squares, onto the token
    // Picked up with no second click…
    expect(carriedStones(g, 'red-m')).toHaveLength(1);
    expect(unitById(g, 'red-m')!.carried).toBe(1);
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET - 2); // the walk, nothing more
    // …and the pickup WAS the Mage's action, so it cannot also attack.
    expect(g.unitsActedThisTurn).toContain('red-m');
    expect(canAct(g, 'red-m')).toBe(false);
  });

  it('leaves a Mage that merely passes over a MageStone empty-handed', () => {
    let g = budgetGame();
    const stone = g.stones.find((s) => !s.carrier)!;
    g = place(g, 'red-m', { r: stone.cell.r - 1, c: stone.cell.c });
    g = moveUnit(g, 'red-m', '', { r: stone.cell.r + 1, c: stone.cell.c });
    expect(carriedStones(g, 'red-m')).toHaveLength(0);
    expect(canAct(g, 'red-m')).toBe(true); // free to attack from where it landed
  });

  it('raises a Warrior just by landing on a Gravestone, then steps back off it', () => {
    // Red must be below the Warrior cap for a resurrection to be legal.
    let g = budgetGame();
    g = { ...g, units: g.units.filter((u) => u.id !== 'red-w6') };
    const grave = { r: 6, c: 4 };
    g = { ...g, gravestones: [{ id: 'gv-test', cell: grave }] };
    g = place(g, 'red-p', { r: 4, c: 4 }); // two squares north of it
    const before = warriorCount(g, 'red');
    g = moveUnit(g, 'red-p', '', grave);
    // The Warrior is standing ON the Gravestone square…
    const risen = g.units.find((u) => u.owner === 'red' && sameCell(u.cell, grave))!;
    expect(risen.kind).toBe('warrior');
    expect(warriorCount(g, 'red')).toBe(before + 1);
    // …the Priest has stepped one square back the way it came…
    expect(unitById(g, 'red-p')!.cell).toEqual({ r: 5, c: 4 });
    // …the token has left the game, and this was the Priest's action.
    expect(g.gravestones).toHaveLength(0);
    expect(canAct(g, 'red-p')).toBe(false);
    expect(movesLeft(g, 'red')).toBe(MOVE_BUDGET - 2); // the step back is free
  });

  it('does not auto-raise when the player has already resurrected this go', () => {
    let g = budgetGame();
    g = { ...g, units: g.units.filter((u) => u.id !== 'red-w6') };
    const grave = { r: 6, c: 4 };
    g = { ...g, gravestones: [{ id: 'gv-test', cell: grave }], resurrectedThisTurn: ['red'] };
    g = place(g, 'red-p', { r: 4, c: 4 });
    g = moveUnit(g, 'red-p', '', grave);
    // An ordinary move: the Priest is simply standing on the Gravestone.
    expect(unitById(g, 'red-p')!.cell).toEqual(grave);
    expect(g.gravestones).toHaveLength(1);
  });

  it('caps nothing but the squares — six units may each take one', () => {
    let g = budgetGame();
    const ids = ['red-w1', 'red-w2', 'red-w3', 'red-w4', 'red-w5', 'red-w6'];
    for (const [i, id] of ids.entries()) {
      g = place(g, id, { r: 5, c: 3 + i * 2 });
      g = moveUnit(g, id, '', { r: 6, c: 3 + i * 2 });
      expect(unitsActivated(g, 'red')).toBe(i + 1);
    }
    // All six walked a square each, so the SQUARES are what ran out.
    expect(movesLeft(g, 'red')).toBe(0);
    expect(unitsActivated(g, 'red')).toBe(6);
    // A seventh unit is refused for want of squares, not for want of a slot.
    g = place(g, 'red-p', { r: 5, c: 15 });
    expect(moveUnit(g, 'red-p', '', { r: 6, c: 15 })).toBe(g);
    // and a unit that already moved still cannot move again
    expect(moveUnit(g, 'red-w1', '', { r: 7, c: 3 })).toBe(g);
  });

  it('lets every unit act in place for free — no slot, no squares', () => {
    let g = budgetGame();
    // Three Warriors already walked their six squares away.
    g = { ...g, moveSpent: { red: MOVE_BUDGET }, unitsMovedThisTurn: ['red-w1', 'red-w2', 'red-w3'] };
    expect(movesLeft(g, 'red')).toBe(0);
    // A FOURTH unit that has not moved can still act from where it stands.
    g = place(g, 'red-m', { r: 8, c: 8 });
    g = place(g, 'blue-w1', { r: 8, c: 9 });
    expect(canAct(g, 'red-m')).toBe(true);
    expect(canAct(g, 'red-w4')).toBe(true);
    // …and so can one that already moved, since acting follows its move.
    expect(canAct(g, 'red-w1')).toBe(true);
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
    expect(unitsActivated(g, 'red')).toBe(2);
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
    expect(unitsActivated(g, 'red')).toBe(0);
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

  it('holds a heads-up Rite for TWO returns and a four-player one for a single return', () => {
    // Heads-up: Blue gets TWO goes at it.
    let g = place(budgetGame(), 'red-p', { r: 7, c: 7 });
    g = beginRitual(g, 'red-p');
    g = endActivation(g); // Blue's first go
    expect(g.winner).toBeNull();
    g = endActivation(g); // back to Red — only half held
    expect(g.current).toBe('red');
    expect(g.winner).toBeNull();
    expect(g.ritual?.returns).toBe(1);
    g = endActivation(g); // Blue's second go
    expect(g.winner).toBeNull();
    g = endActivation(g); // and now it pays out
    expect(g.winner).toBe('red');
    expect(g.winMethod).toBe('Ritual');

    // Four players: one lap of the table is the whole hold, because that lap
    // already hands three rivals a go each.
    let h = createGame(['red', 'blue', 'green', 'yellow'], 'diamond');
    h = place(h, 'red-p', { r: 7, c: 7 });
    h = beginRitual(h, 'red-p');
    const seats: string[] = [];
    for (let i = 0; i < 4 && !h.winner; i++) {
      h = endActivation(h);
      if (!h.winner) seats.push(h.current);
    }
    expect(seats).toEqual(['blue', 'green', 'yellow']); // one go each
    expect(h.winner).toBe('red');
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
    expect(unitsActivated(g, 'red')).toBe(0);
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
