// Acceptance tests for the MageStone ruleset. The engine is pure, so every case
// below is built by hand and driven through the real exported functions — no
// mocks, no UI. Numbered to match the acceptance criteria in the ruleset brief.

import { describe, expect, it } from 'vitest';
import { createGame, playerCountFor, playerSet, stoneCells, STONE_LAYOUTS } from './setup';
import { isCurrentStateShape } from './migrate';
import {
  BOLT_COST,
  GRAVES_PER_PLAYER,
  MAX_WARRIORS,
  NOVA_COST,
  STONES_TO_WIN,
  activate,
  canBolt,
  canNova,
  canResurrect,
  carriedStones,
  checkVictory,
  collect,
  combatOdds,
  defeatUnit,
  gravestoneBank,
  gravestoneCapacity,
  hasPlayLeft,
  availableDice,
  magePowerDie,
  moveUnit,
  resolveAttack,
  resolveBolt,
  resolveFlee,
  resolveNova,
  resurrect,
  rollDice,
  DICE_PER_ROUND,
  activationKind,
  canCommitDie,
  diceLeft,
  diceSpent,
  endActivation,
  syncStones,
  unitById,
  canDieMoveUnit,
  legalMoves,
} from './rules';
import type { Cell, GameState, MageStone, PlayerColor, Unit } from './types';

// ---- helpers ---------------------------------------------------------------

/** A game in its action phase with a hand-picked set of dice. */
function acting(players: PlayerColor[] = ['red', 'blue']): GameState {
  const g = createGame(players, 'diamond');
  return { ...g, turnPhase: 'act' };
}

function withDice(
  g: GameState,
  kinds: ('mage' | 'priest' | 'warrior')[],
  values: number[],
  owner: PlayerColor = g.current,
): GameState {
  return {
    ...g,
    dice: kinds.map((kind, i) => ({
      id: `d${i}`,
      owner,
      kind,
      value: values[i],
      usedBy: null,
    })),
  };
}

/** A full round's dice for every seat, so alternation has something to spend. */
function rolled(g: GameState, value = 3): GameState {
  const dice = [];
  for (const owner of g.players) {
    for (const kind of ['mage', 'priest', 'warrior', 'warrior', 'warrior'] as const) {
      dice.push({ id: `${owner}-${kind}-${dice.length}`, owner, kind, value, usedBy: null });
    }
  }
  return { ...g, dice, turnPhase: 'act' as const };
}

const at = (g: GameState, id: string): Unit => {
  const u = unitById(g, id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};

/** Move `id` to `cell` without going through the dice/turn machinery. */
function place(g: GameState, id: string, cell: Cell): GameState {
  return { ...g, units: g.units.map((u) => (u.id === id ? { ...u, cell: { ...cell } } : u)) };
}

/** Hand a Mage real stone tokens (the only legitimate way to set its counts). */
function give(g: GameState, unitId: string, carried: number, activated: number): GameState {
  const free = g.stones.filter((s) => !s.carrier);
  let i = 0;
  const claimed = new Map<string, boolean>();
  for (let n = 0; n < carried; n++, i++) claimed.set(free[i].id, false);
  for (let n = 0; n < activated; n++, i++) claimed.set(free[i].id, true);
  return syncStones({
    ...g,
    stones: g.stones.map((s) =>
      claimed.has(s.id) ? { ...s, carrier: unitId, activated: claimed.get(s.id)! } : s,
    ),
  });
}

/** Spend one of the current player's free dice moving `id` one square — the
 *  smallest real activation, for driving the alternation. */
function activateOne(g: GameState, id: string): GameState {
  const u = at(g, id);
  const die = g.dice.find((d) => d.owner === g.current && d.kind === u.kind && !d.usedBy);
  if (!die) throw new Error(`no free ${u.kind} die for ${id}`);
  const dest = legalMoves(g, u, die.value)[0];
  const next = moveUnit(g, id, die.id, dest);
  if (next === g) throw new Error(`move rejected for ${id}`);
  return next;
}

/** Squares `id` can reach with a die of `steps`. */
const legalMovesOf = (g: GameState, id: string, steps: number): Cell[] =>
  legalMoves(g, at(g, id), steps);

const loose = (g: GameState): MageStone[] => g.stones.filter((s) => !s.carrier);
const looseAt = (g: GameState, cell: Cell) =>
  loose(g).filter((s) => s.cell.r === cell.r && s.cell.c === cell.c);

/** A rigged RNG: consumes the given 0..1 values in order, repeating the last. */
const seq = (vals: number[]) => {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
};
const HI = 0.999; // rolls the maximum face
const LO = 0; // rolls a 1

// ---- TEST 1 — turn dice ----------------------------------------------------

describe('TEST 1 — turn dice', () => {
  it('gives each player 3 standard, 1 mage and 1 priest die', () => {
    const g = rollDice(createGame(['red', 'blue']));
    for (const p of g.players) {
      const mine = g.dice.filter((d) => d.owner === p);
      expect(mine.filter((d) => d.kind === 'warrior')).toHaveLength(3);
      expect(mine.filter((d) => d.kind === 'mage')).toHaveLength(1);
      expect(mine.filter((d) => d.kind === 'priest')).toHaveLength(1);
    }
    expect(g.dice.every((d) => d.value >= 1 && d.value <= 6)).toBe(true);
  });

  it('rolls five for EVERY player and discards nothing', () => {
    for (const n of [2, 4] as const) {
      const g = rollDice(createGame(n));
      expect(g.dice).toHaveLength(5 * n);
      for (const p of g.players) {
        expect(g.dice.filter((d) => d.owner === p)).toHaveLength(5);
        expect(diceSpent(g, p)).toBe(0);
        expect(diceLeft(g, p)).toBe(DICE_PER_ROUND);
      }
      // Straight into activations — there is no discard step at all.
      expect(g.turnPhase).toBe('act');
    }
  });

  it('lets a player spend at most three of their five dice per round', () => {
    let g = rolled(acting(), 1);
    // Three Warrior activations each, strictly alternating.
    for (let i = 1; i <= 3; i++) {
      expect(g.current).toBe('red');
      g = endActivation(activateOne(g, `red-w${i}`));
      expect(diceSpent(g, 'red')).toBe(i);
      expect(g.current).toBe('blue');
      g = endActivation(activateOne(g, `blue-w${i}`));
    }
    // Both spent their three, so the round turned over and the dice cleared.
    expect(g.turn).toBe(2);
    expect(g.dice).toEqual([]);
    expect(g.roundStarter).toBe('blue');
  });

  it('only lets the Mage move on a Mage die, and the Priest on a Priest die', () => {
    const g = withDice(acting(), ['mage', 'priest', 'warrior'], [3, 3, 3]);
    const mage = at(g, 'red-m');
    const priest = at(g, 'red-p');
    const warrior = at(g, 'red-w1');
    const [mageDie, priestDie, warriorDie] = g.dice;

    expect(canDieMoveUnit(mageDie, mage, g)).toBe(true);
    expect(canDieMoveUnit(priestDie, mage, g)).toBe(false);
    expect(canDieMoveUnit(warriorDie, mage, g)).toBe(false);

    expect(canDieMoveUnit(priestDie, priest, g)).toBe(true);
    expect(canDieMoveUnit(mageDie, priest, g)).toBe(false);

    expect(canDieMoveUnit(warriorDie, warrior, g)).toBe(true);
    expect(canDieMoveUnit(mageDie, warrior, g)).toBe(false);
  });

  it('a Mage cannot move once its Mage die has been spent elsewhere', () => {
    // Both the Mage and the Priest die are gone (spent on other things), so
    // neither unit can be activated for the rest of the round.
    let g = rolled(acting(), 3);
    g = {
      ...g,
      dice: g.dice.map((d) =>
        d.owner === 'red' && (d.kind === 'mage' || d.kind === 'priest')
          ? { ...d, usedBy: 'spent' }
          : d,
      ),
    };
    const mage = at(g, 'red-m');
    const priest = at(g, 'red-p');
    expect(g.dice.every((d) => !canDieMoveUnit(d, mage, g))).toBe(true);
    expect(g.dice.every((d) => !canDieMoveUnit(d, priest, g))).toBe(true);
  });

  it('a unit cannot take a second movement die in the same turn', () => {
    let g = withDice(acting(), ['warrior', 'warrior', 'warrior'], [1, 1, 1]);
    g = place(g, 'red-w1', { r: 4, c: 4 });
    g = moveUnit(g, 'red-w1', 'd0', { r: 5, c: 4 });
    expect(at(g, 'red-w1').cell).toEqual({ r: 5, c: 4 });
    const again = moveUnit(g, 'red-w1', 'd1', { r: 6, c: 4 });
    expect(again).toBe(g); // refused — already moved
  });
});

// ---- Round & activation system ---------------------------------------------

describe('Rounds and alternating activations', () => {
  it('alternates one activation each, and rotates the starting player per round', () => {
    let g = rolled(acting(['red', 'blue']), 1);
    expect(g.roundStarter).toBe('red');
    expect(g.current).toBe('red');

    const order: PlayerColor[] = [];
    for (let i = 1; i <= 3; i++) {
      order.push(g.current);
      g = endActivation(activateOne(g, `red-w${i}`));
      order.push(g.current);
      g = endActivation(activateOne(g, `blue-w${i}`));
    }
    // Strict alternation while both sides still have dice.
    expect(order).toEqual(['red', 'blue', 'red', 'blue', 'red', 'blue']);

    // The round turned over and BLUE now leads.
    expect(g.turn).toBe(2);
    expect(g.roundStarter).toBe('blue');
    expect(g.current).toBe('blue');
    // …and back to red the round after (both sides simply pass).
    let h = rolled({ ...g, turnPhase: 'act' as const }, 1);
    for (let i = 0; i < 20 && h.turn === 2; i++) h = endActivation(h);
    expect(h.roundStarter).toBe('red');
  });

  it('a player who passes forfeits their remaining dice for the round', () => {
    let g = rolled(acting(['red', 'blue']), 1);
    g = endActivation(g); // red commits nothing → passes
    expect(g.passed).toContain('red');
    expect(g.current).toBe('blue');
    // Blue keeps activating alone; red is skipped for the rest of the round.
    g = endActivation(activateOne(g, 'blue-w1'));
    expect(g.current).toBe('blue');
    expect(diceSpent(g, 'red')).toBe(0); // its dice went unused, as the rules allow
    // The pass lifts when the round turns over.
    for (let i = 0; i < 20 && g.turn === 1; i++) g = endActivation(g);
    expect(g.passed).toEqual([]);
  });

  it('rotates the starting player clockwise in a 4-player game', () => {
    let g = rolled(acting(['red', 'blue', 'green', 'yellow']), 1);
    expect(g.roundStarter).toBe('red');
    for (let i = 0; i < 40 && g.turn === 1; i++) g = endActivation(g);
    expect(g.roundStarter).toBe('blue');
  });

  it('clears unspent dice and the per-round records at the round boundary', () => {
    let g = rolled(acting(['red', 'blue']), 1);
    const w = at(g, 'red-w1');
    const die = g.dice.find((d) => d.owner === 'red' && d.kind === 'warrior')!;
    g = moveUnit(g, w.id, die.id, legalMovesOf(g, w.id, 1)[0]);
    expect(g.unitsMovedThisTurn).toContain('red-w1');
    for (let i = 0; i < 20 && g.turn === 1; i++) g = endActivation(g);
    expect(g.turn).toBe(2);
    expect(g.dice).toEqual([]); // unspent dice are simply ignored
    expect(g.turnPhase).toBe('roll');
    expect(g.unitsMovedThisTurn).toEqual([]);
    expect(g.unitsActedThisTurn).toEqual([]);
    expect(g.activationDice).toEqual([]);
  });

  it('gives each unit at most one die per round', () => {
    let g = rolled(acting(), 1);
    const die = g.dice.find((d) => d.owner === 'red' && d.kind === 'warrior')!;
    g = moveUnit(g, 'red-w1', die.id, legalMovesOf(g, 'red-w1', 1)[0]);
    const other = g.dice.find((d) => d.owner === 'red' && d.kind === 'warrior' && !d.usedBy)!;
    // Same warrior, a second warrior die — refused.
    expect(canDieMoveUnit(other, at(g, 'red-w1'), g)).toBe(false);
  });

  it('never lets a player touch another player’s dice', () => {
    const g = rolled(acting(['red', 'blue']), 3);
    const blueDie = g.dice.find((d) => d.owner === 'blue' && d.kind === 'warrior')!;
    expect(canCommitDie(g, blueDie)).toBe(false);
    expect(canDieMoveUnit(blueDie, at(g, 'red-w1'), g)).toBe(false);
    expect(availableDice(g).every((d) => d.owner === 'red')).toBe(true);
  });
});

describe('The same-colour bundle', () => {
  it('lets two Warrior dice resolve together, without passing play between them', () => {
    let g = rolled(acting(), 1);
    expect(activationKind(g)).toBeNull();

    const w1 = g.dice.find((d) => d.owner === 'red' && d.kind === 'warrior')!;
    g = moveUnit(g, 'red-w1', w1.id, legalMovesOf(g, 'red-w1', 1)[0]);
    // The activation is now locked to Warrior dice…
    expect(activationKind(g)).toBe('warrior');
    expect(g.activationDice).toEqual([w1.id]);
    // …and play has NOT passed.
    expect(g.current).toBe('red');

    const w2 = g.dice.find((d) => d.owner === 'red' && d.kind === 'warrior' && !d.usedBy)!;
    g = moveUnit(g, 'red-w2', w2.id, legalMovesOf(g, 'red-w2', 1)[0]);
    expect(g.activationDice).toHaveLength(2);
    expect(diceSpent(g, 'red')).toBe(2);
    expect(g.current).toBe('red');

    g = endActivation(g);
    expect(g.current).toBe('blue');
    expect(g.activationDice).toEqual([]);
  });

  it('refuses to mix colours inside one activation', () => {
    let g = rolled(acting(), 1);
    const w1 = g.dice.find((d) => d.owner === 'red' && d.kind === 'warrior')!;
    g = moveUnit(g, 'red-w1', w1.id, legalMovesOf(g, 'red-w1', 1)[0]);

    const mageDie = g.dice.find((d) => d.owner === 'red' && d.kind === 'mage')!;
    expect(canCommitDie(g, mageDie)).toBe(false);
    expect(canDieMoveUnit(mageDie, at(g, 'red-m'), g)).toBe(false);
    // The Mage becomes available again on a LATER activation.
    const later = endActivation(endActivation(g));
    expect(later.current).toBe('red');
    expect(canCommitDie(later, later.dice.find((d) => d.id === mageDie.id)!)).toBe(true);
  });

  it('lets a bundle of Warrior dice power a coordinated attack in one activation', () => {
    let g = rolled(acting(), 1);
    g = place(g, 'red-w1', { r: 8, c: 8 });
    g = place(g, 'red-w2', { r: 7, c: 9 });
    g = place(g, 'blue-w1', { r: 8, c: 9 });
    g = resolveAttack(g, ['red-w1', 'red-w2'], 'blue-w1', seq([HI, HI, LO]));
    expect(g.lastCombat?.attackDice).toHaveLength(2);
    expect(diceSpent(g, 'red')).toBe(2); // one Warrior die each
    expect(activationKind(g)).toBe('warrior');
    expect(g.current).toBe('red'); // still the same activation
  });

  it('stops a bundle at the three-dice round budget', () => {
    let g = rolled(acting(), 1);
    // Spend all three Warrior dice on three separate Warriors in one bundle.
    for (const id of ['red-w1', 'red-w2', 'red-w3']) {
      const die = g.dice.find((d) => d.owner === 'red' && d.kind === 'warrior' && !d.usedBy)!;
      g = moveUnit(g, id, die.id, legalMovesOf(g, id, 1)[0]);
    }
    expect(diceSpent(g, 'red')).toBe(DICE_PER_ROUND);
    expect(diceLeft(g, 'red')).toBe(0);
    // Two dice remain unspent but are out of budget — nothing else may commit.
    expect(g.dice.filter((d) => d.owner === 'red' && !d.usedBy)).toHaveLength(2);
    expect(availableDice(g)).toEqual([]);
    expect(hasPlayLeft(g)).toBe(false);
    // Play passes automatically once the budget is gone.
    g = endActivation(g);
    expect(g.current).toBe('blue');
  });
});

// ---- TEST 2 — normal activation --------------------------------------------

describe('TEST 2 — normal activation', () => {
  it('a collected stone stays Unactivated until the Mage gets home', () => {
    let g = withDice(acting(), ['mage'], [2]);
    const stone = loose(g)[0];
    g = place(g, 'red-m', stone.cell);

    g = collect(g, 'red-m');
    const held = carriedStones(g, 'red-m');
    expect(held).toHaveLength(1);
    expect(held[0].activated).toBe(false);
    expect(at(g, 'red-m').carried).toBe(1);
    expect(at(g, 'red-m').activated).toBe(0);
    expect(magePowerDie(at(g, 'red-m').activated)).toBe(6);

    // Back on its own base, the stone activates.
    g = withDice(place(g, 'red-m', { r: 0, c: 8 }), ['mage'], [2]);
    g = { ...g, unitsActedThisTurn: [] };
    g = activate(g, 'red-m');
    expect(at(g, 'red-m').carried).toBe(0);
    expect(at(g, 'red-m').activated).toBe(1);
    expect(carriedStones(g, 'red-m')[0].activated).toBe(true);
  });

  it('cannot activate anywhere but the Mage’s own base', () => {
    let g = withDice(acting(), ['mage'], [2]);
    const stone = loose(g)[0];
    g = collect(place(g, 'red-m', stone.cell), 'red-m');
    g = withDice({ ...g, unitsActedThisTurn: [] }, ['mage'], [2]);
    const away = activate(place(g, 'red-m', { r: 7, c: 7 }), 'red-m');
    expect(at(away, 'red-m').activated).toBe(0);
  });
});

// ---- TEST 3 — permanent activation -----------------------------------------

describe('TEST 3 — permanent activation', () => {
  it('an Activated stone dropped on the board stays Activated, and an enemy who takes it needs no trip home', () => {
    // Red's Mage carries 2 Activated stones and is killed.
    let g = withDice(acting(), ['warrior'], [1]);
    g = give(place(g, 'red-m', { r: 8, c: 8 }), 'red-m', 0, 2);
    g = defeatUnit(g, 'red-m');

    const dropped = looseAt(g, { r: 8, c: 8 });
    expect(dropped).toHaveLength(1);
    expect(dropped[0].activated).toBe(true); // NEVER reverts to unactivated

    // Blue's Mage walks onto it and collects.
    g = withDice({ ...g, current: 'blue', turnPhase: 'act', unitsActedThisTurn: [] }, ['mage'], [2]);
    g = place(g, 'blue-m', { r: 8, c: 8 });
    g = collect(g, 'blue-m');

    const blueMage = at(g, 'blue-m');
    expect(blueMage.activated).toBe(1); // counts IMMEDIATELY
    expect(blueMage.carried).toBe(0); // not a "carried, needs activating" stone
    expect(carriedStones(g, 'blue-m')[0].id).toBe(dropped[0].id); // the same token
  });

  it('no engine path ever turns an Activated stone back off', () => {
    // Drive a Mage through collect → activate → death → re-collect → bolt and
    // assert the token's activation only ever goes false → true.
    let g = withDice(acting(), ['mage'], [2]);
    const stone = loose(g)[0];
    const id = stone.id;
    const flag = () => g.stones.find((s) => s.id === id)!.activated;

    g = collect(place(g, 'red-m', stone.cell), 'red-m');
    expect(flag()).toBe(false);
    g = withDice({ ...g, unitsActedThisTurn: [] }, ['mage'], [2]);
    g = activate(place(g, 'red-m', { r: 0, c: 8 }), 'red-m');
    expect(flag()).toBe(true);

    g = defeatUnit(g, 'red-m'); // drops its single Activated stone
    expect(flag()).toBe(true);

    g = withDice({ ...g, turnPhase: 'act', unitsActedThisTurn: [] }, ['mage'], [2]);
    const where = g.stones.find((s) => s.id === id)!.cell;
    g = collect(place(g, 'red-m', where), 'red-m');
    expect(flag()).toBe(true);
  });
});

// ---- TEST 4 — Mage death ---------------------------------------------------

describe('TEST 4 — Mage death', () => {
  it('drops all Unactivated plus exactly one Activated, and keeps the rest', () => {
    let g = withDice(acting(), ['warrior'], [1]);
    g = give(place(g, 'red-m', { r: 9, c: 9 }), 'red-m', 2, 3);
    expect(at(g, 'red-m').carried).toBe(2);
    expect(at(g, 'red-m').activated).toBe(3);

    g = defeatUnit(g, 'red-m');

    const here = looseAt(g, { r: 9, c: 9 });
    expect(here).toHaveLength(3);
    expect(here.filter((s) => !s.activated)).toHaveLength(2); // the 2 unactivated
    expect(here.filter((s) => s.activated)).toHaveLength(1); // exactly 1 activated
    // Respawned at base with the other two Activated stones still in hand.
    const mage = at(g, 'red-m');
    expect(mage.activated).toBe(2);
    expect(mage.carried).toBe(0);
    expect(magePowerDie(mage.activated)).toBe(12);
  });

  it('a Mage with no Activated stones drops only its Unactivated ones', () => {
    let g = give(place(acting(), 'red-m', { r: 9, c: 9 }), 'red-m', 2, 0);
    g = defeatUnit(g, 'red-m');
    const here = looseAt(g, { r: 9, c: 9 });
    expect(here).toHaveLength(2);
    expect(here.every((s) => !s.activated)).toBe(true);
  });

  it('an enemy Warrior on the base defers the respawn, and the stones come back with it', () => {
    let g = give(place(acting(), 'red-m', { r: 9, c: 9 }), 'red-m', 0, 3);
    g = place(g, 'blue-w1', { r: 0, c: 8 }); // sits on red's base
    g = defeatUnit(g, 'red-m');
    expect(unitById(g, 'red-m')).toBeUndefined();
    expect(g.pendingRespawns.map((p) => p.id)).toContain('red-m');
    // Clear the siege → the Mage returns with its 2 remaining Activated stones.
    g = place(g, 'blue-w1', { r: 6, c: 6 });
    g = endActivation(g);
    expect(at(g, 'red-m').activated).toBe(2);
  });
});

// ---- TEST 5 — Bolt ---------------------------------------------------------

describe('TEST 5 — Bolt', () => {
  it('is indefensible, costs one Activated stone, and leaves it Activated on the target square', () => {
    let g = withDice(acting(), ['mage'], [4]);
    g = give(place(g, 'red-m', { r: 8, c: 8 }), 'red-m', 0, 3);
    g = place(g, 'blue-w1', { r: 8, c: 10 }); // 2 squares away, within range 4

    expect(canBolt(g, 'red-m')).toBe(true);
    g = resolveBolt(g, 'red-m', 'blue-w1');

    expect(unitById(g, 'blue-w1')).toBeUndefined(); // defeated, no defence roll
    expect(g.lastCombat).toBeNull(); // no defence dice were thrown at all
    expect(at(g, 'red-m').activated).toBe(3 - BOLT_COST);
    const onTarget = looseAt(g, { r: 8, c: 10 });
    expect(onTarget).toHaveLength(1);
    expect(onTarget[0].activated).toBe(true);
  });

  it('kills an enemy Mage outright — a Mage cannot repel it', () => {
    let g = withDice(acting(), ['mage'], [4]);
    g = give(place(g, 'red-m', { r: 8, c: 8 }), 'red-m', 0, 1);
    g = give(place(g, 'blue-m', { r: 8, c: 9 }), 'blue-m', 0, 5); // a d20 Mage
    // A rigged RNG that would lose every duel must make no difference.
    g = resolveBolt(g, 'red-m', 'blue-m', seq([LO, LO, LO]));
    expect(g.stones.filter((s) => s.carrier === 'blue-m' || s.carrier === null).length).toBeGreaterThan(0);
    expect(at(g, 'blue-m').cell).toEqual({ r: 15, c: 7 }); // killed and respawned at base
    expect(at(g, 'red-m').activated).toBe(0);
  });

  it('cannot be cast without an Activated stone', () => {
    let g = withDice(acting(), ['mage'], [4]);
    g = give(place(g, 'red-m', { r: 8, c: 8 }), 'red-m', 3, 0); // carried, not activated
    g = place(g, 'blue-w1', { r: 8, c: 9 });
    expect(canBolt(g, 'red-m')).toBe(false);
  });
});

// ---- TEST 6 — Nova ---------------------------------------------------------

describe('TEST 6 — Nova', () => {
  it('costs four stones, kills only enemies, and lays the four stones on the diagonals', () => {
    let g = withDice(acting(), ['mage'], [3]);
    g = give(place(g, 'red-m', { r: 8, c: 8 }), 'red-m', 0, NOVA_COST);
    g = place(g, 'blue-w1', { r: 7, c: 8 }); // orthogonal
    g = place(g, 'blue-w2', { r: 9, c: 9 }); // diagonal
    g = place(g, 'red-w1', { r: 8, c: 7 }); // FRIENDLY, in the blast
    g = place(g, 'blue-w3', { r: 8, c: 11 }); // out of range

    expect(canNova(g, 'red-m')).toBe(true);
    g = resolveNova(g, 'red-m');

    expect(unitById(g, 'blue-w1')).toBeUndefined();
    expect(unitById(g, 'blue-w2')).toBeUndefined();
    expect(at(g, 'red-w1').cell).toEqual({ r: 8, c: 7 }); // friendly untouched
    expect(at(g, 'blue-w3').cell).toEqual({ r: 8, c: 11 }); // out of range untouched
    expect(g.lastCombat).toBeNull(); // no defence rolls

    expect(at(g, 'red-m').activated).toBe(0);
    for (const d of [
      { r: 7, c: 7 },
      { r: 7, c: 9 },
      { r: 9, c: 7 },
      { r: 9, c: 9 },
    ]) {
      const here = looseAt(g, d);
      expect(here).toHaveLength(1);
      expect(here[0].activated).toBe(true);
    }
  });

  it('needs four Activated stones — three is not enough', () => {
    let g = withDice(acting(), ['mage'], [3]);
    g = give(place(g, 'red-m', { r: 8, c: 8 }), 'red-m', 0, 3);
    g = place(g, 'blue-w1', { r: 7, c: 8 });
    expect(canNova(g, 'red-m')).toBe(false);
  });
});

// ---- TEST 7 & 8 — the finite Gravestone bank -------------------------------

describe('TEST 7 — Gravestone bank', () => {
  it('starts at 4 per player and never grows back', () => {
    const two = createGame(['red', 'blue']);
    const four = createGame(['red', 'blue', 'green', 'yellow']);
    expect(GRAVES_PER_PLAYER).toBe(4);
    expect(gravestoneBank(two)).toBe(8);
    expect(gravestoneBank(four)).toBe(16);
    expect(gravestoneCapacity(four)).toBe(16);
  });

  it('a Warrior death spends one, and a resurrection does NOT return it', () => {
    let g = acting(['red', 'blue', 'green', 'yellow']);
    expect(gravestoneBank(g)).toBe(16);
    g = { ...g, units: g.units.filter((u) => u.id !== 'red-w6') }; // room to revive

    g = place(g, 'blue-w1', { r: 10, c: 10 });
    g = defeatUnit(g, 'blue-w1');
    expect(gravestoneBank(g)).toBe(15);
    expect(g.gravestones).toHaveLength(1);

    // Red's Priest walks onto the grave and resurrects.
    g = withDice(place(g, 'red-p', { r: 10, c: 10 }), ['priest'], [2]);
    g = { ...g, units: g.units.map((u) => (u.id === 'red-p' ? { ...u, prevCell: { r: 9, c: 10 } } : u)) };
    expect(canResurrect(g, 'red-p')).toBe(true);
    g = resurrect(g, 'red-p');

    expect(g.gravestones).toHaveLength(0); // token left the board
    expect(gravestoneBank(g)).toBe(15); // and did NOT go back to the bank
  });

  it('the resurrected Warrior joins the Priest’s faction, not the fallen one’s', () => {
    let g = acting(['red', 'blue']);
    g = { ...g, units: g.units.filter((u) => u.id !== 'red-w6') }; // room for one
    g = defeatUnit(place(g, 'blue-w1', { r: 10, c: 10 }), 'blue-w1');
    g = withDice(place(g, 'red-p', { r: 10, c: 10 }), ['priest'], [2]);
    const before = g.units.filter((u) => u.owner === 'red' && u.kind === 'warrior').length;
    g = resurrect(g, 'red-p');
    expect(g.units.filter((u) => u.owner === 'red' && u.kind === 'warrior')).toHaveLength(before + 1);
  });

  it('caps a faction at six live Warriors', () => {
    let g = acting(['red', 'blue']);
    g = defeatUnit(place(g, 'blue-w1', { r: 10, c: 10 }), 'blue-w1');
    g = withDice(place(g, 'red-p', { r: 10, c: 10 }), ['priest'], [2]);
    expect(g.units.filter((u) => u.owner === 'red' && u.kind === 'warrior')).toHaveLength(MAX_WARRIORS);
    expect(canResurrect(g, 'red-p')).toBe(false);
  });

  it('allows only one resurrection per player turn', () => {
    let g = acting(['red', 'blue']);
    // Two graves, and room for two Warriors.
    g = defeatUnit(place(g, 'blue-w1', { r: 10, c: 10 }), 'blue-w1');
    g = defeatUnit(place(g, 'blue-w2', { r: 10, c: 11 }), 'blue-w2');
    g = { ...g, units: g.units.filter((u) => !['red-w5', 'red-w6'].includes(u.id)) };
    g = withDice(place(g, 'red-p', { r: 10, c: 10 }), ['priest', 'priest'], [2, 2]);
    g = resurrect(g, 'red-p');
    expect(g.resurrectedThisTurn).toContain('red');

    g = withDice({ ...g, unitsActedThisTurn: [] }, ['priest'], [2]);
    g = place(g, 'red-p', { r: 10, c: 11 });
    expect(canResurrect(g, 'red-p')).toBe(false);

    // …and the cap lifts when the round turns over.
    let next = g;
    for (let i = 0; i < 12 && next.turn === g.turn; i++) next = endActivation(next);
    expect(next.resurrectedThisTurn).toEqual([]);
  });
});

describe('TEST 8 — empty Gravestone bank', () => {
  it('leaves no Gravestone, so that Warrior can never be resurrected', () => {
    let g = { ...acting(['red', 'blue']), graveBank: 0 };
    g = place(g, 'blue-w1', { r: 10, c: 10 });
    g = defeatUnit(g, 'blue-w1');
    expect(g.gravestones).toHaveLength(0);
    expect(gravestoneBank(g)).toBe(0);
    g = withDice(place(g, 'red-p', { r: 10, c: 10 }), ['priest'], [2]);
    expect(canResurrect(g, 'red-p')).toBe(false);
  });

  it('never places a Gravestone on the Nexus, and never stacks two', () => {
    let g = acting(['red', 'blue']);
    const bank = gravestoneBank(g);
    g = defeatUnit(place(g, 'blue-w1', { r: 7, c: 7 }), 'blue-w1'); // a Nexus cell
    expect(g.gravestones).toHaveLength(0);
    expect(gravestoneBank(g)).toBe(bank); // no token spent when none is placed

    g = defeatUnit(place(g, 'blue-w2', { r: 10, c: 10 }), 'blue-w2');
    g = defeatUnit(place(g, 'blue-w3', { r: 10, c: 10 }), 'blue-w3');
    expect(g.gravestones).toHaveLength(1);
    expect(gravestoneBank(g)).toBe(bank - 1);
  });
});

// ---- TEST 9 — player count -------------------------------------------------

describe('TEST 9 — player count', () => {
  it('supports only 2- and 4-player games', () => {
    expect(playerCountFor(2)).toBe(2);
    expect(playerCountFor(4)).toBe(4);
    expect(playerSet(2)).toHaveLength(2);
    expect(playerSet(4)).toHaveLength(4);
  });

  it('refuses to build a 3-player game through any entry point', () => {
    expect(playerCountFor(3)).toBe(4);
    expect(playerSet(3)).toHaveLength(4);
    expect(createGame(3).players).toHaveLength(4);
    // An explicit three-colour list is corrected rather than honoured.
    expect(createGame(['red', 'blue', 'green']).players).toHaveLength(4);
  });

  it('seats 8 units per player and 4 MageStones per player', () => {
    for (const n of [2, 4] as const) {
      const g = createGame(n);
      expect(g.units).toHaveLength(8 * n);
      expect(g.stones).toHaveLength(4 * n);
      for (const p of g.players) {
        const mine = g.units.filter((u) => u.owner === p);
        expect(mine.filter((u) => u.kind === 'warrior')).toHaveLength(6);
        expect(mine.filter((u) => u.kind === 'priest')).toHaveLength(1);
        expect(mine.filter((u) => u.kind === 'mage')).toHaveLength(1);
      }
      expect(g.stones.every((s) => !s.activated && s.carrier === null)).toBe(true);
    }
  });

  it('lays out the base as W W W Priest Mage W W W', () => {
    const g = createGame(['red', 'blue']);
    const row = g.units
      .filter((u) => u.owner === 'red')
      .sort((a, b) => a.cell.c - b.cell.c)
      .map((u) => u.kind);
    expect(row).toEqual(['warrior', 'warrior', 'warrior', 'priest', 'mage', 'warrior', 'warrior', 'warrior']);
  });

  it('every stone layout stays 4-per-player and off the Nexus', () => {
    for (const layout of STONE_LAYOUTS) {
      for (const n of [2, 4]) {
        const cells = stoneCells(layout, n);
        expect(cells).toHaveLength(4 * n);
        expect(cells.some((c) => c.r >= 7 && c.r <= 8 && c.c >= 7 && c.c <= 8)).toBe(false);
      }
    }
  });
});

// ---- TEST 10 — MageStone victory -------------------------------------------

describe('TEST 10 — MageStone victory', () => {
  it('does not win on picking up a sixth Activated stone away from home', () => {
    let g = withDice(acting(), ['mage'], [2]);
    g = give(place(g, 'red-m', { r: 8, c: 8 }), 'red-m', 0, 5);
    // Put a sixth ALREADY-ACTIVATED stone under the Mage.
    const spare = loose(g)[0];
    g = {
      ...g,
      stones: g.stones.map((s) =>
        s.id === spare.id ? { ...s, activated: true, cell: { r: 8, c: 8 } } : s,
      ),
    };
    g = collect(g, 'red-m');
    expect(at(g, 'red-m').activated).toBe(STONES_TO_WIN);
    expect(g.winner).toBeNull(); // six in hand, but not at home
  });

  it('wins the instant the Mage steps onto its own base holding six', () => {
    let g = withDice(acting(), ['mage'], [1]);
    g = give(place(g, 'red-m', { r: 1, c: 8 }), 'red-m', 0, 6);
    expect(g.winner).toBeNull();
    g = moveUnit(g, 'red-m', 'd0', { r: 0, c: 8 });
    expect(g.winner).toBe('red');
    expect(g.winMethod).toBe('MageStone');
  });

  it('wins on activating the sixth stone while standing at home', () => {
    let g = withDice(acting(), ['mage'], [2]);
    g = give(place(g, 'red-m', { r: 0, c: 8 }), 'red-m', 6, 0);
    expect(g.winner).toBeNull(); // carried, not activated
    g = activate(g, 'red-m');
    expect(g.winner).toBe('red');
    expect(g.winMethod).toBe('MageStone');
  });

  it('drives the power die off ACTIVATED stones only', () => {
    expect(magePowerDie(0)).toBe(6);
    expect(magePowerDie(1)).toBe(6);
    expect(magePowerDie(2)).toBe(12);
    expect(magePowerDie(3)).toBe(12);
    expect(magePowerDie(4)).toBe(20);
    expect(magePowerDie(5)).toBe(20);
    let g = give(acting(), 'red-m', 5, 0); // five CARRIED stones
    expect(magePowerDie(at(g, 'red-m').activated)).toBe(6);
    g = give(acting(), 'red-m', 0, 2);
    expect(magePowerDie(at(g, 'red-m').activated)).toBe(12);
  });
});

// ---- TEST 11 — Ritual ------------------------------------------------------

describe('TEST 11 — Ritual', () => {
  /** A Priest on the Nexus with the ritual declared this round, and nobody
   *  holding any dice — so the next `endActivation` closes the round. */
  const startRitual = (players: PlayerColor[]) => {
    let g = withDice(acting(players), ['priest'], [2]);
    g = place(g, 'red-p', { r: 7, c: 7 }); // a Nexus square
    g = { ...g, ritual: { player: 'red', priestId: 'red-p', round: g.turn } };
    return g;
  };

  it('wins when the round comes back round with the Nexus still held', () => {
    let g = startRitual(['red', 'blue']);
    expect(g.winner).toBeNull();
    g = endActivation(g); // nobody has dice → the round closes
    expect(g.turn).toBe(2);
    expect(g.winner).toBe('red');
    expect(g.winMethod).toBe('Ritual');
  });

  it('does not win in the round it was declared, however many activations pass', () => {
    let g = rolled(acting(['red', 'blue']), 2);
    g = place(g, 'red-p', { r: 7, c: 7 });
    g = { ...g, ritual: { player: 'red', priestId: 'red-p', round: g.turn } };
    // Both sides burn all their activations; the ritual stands but the round
    // has not turned over yet, so nobody has won.
    for (let i = 0; i < 8 && g.turn === 1; i++) g = endActivation(g);
    expect(g.turn).toBeGreaterThan(1);
    expect(g.winner).toBe('red'); // only once the NEW round began
  });

  it('gives every other player a complete turn first (4 players)', () => {
    let g = rolled(acting(['red', 'blue', 'green', 'yellow']), 2);
    g = place(g, 'red-p', { r: 7, c: 7 });
    g = { ...g, ritual: { player: 'red', priestId: 'red-p', round: g.turn } };
    const seen = new Set<PlayerColor>();
    for (let i = 0; i < 40 && !g.winner; i++) {
      seen.add(g.current);
      g = endActivation(g);
    }
    // Blue, green and yellow all got activations before the win landed.
    expect(seen.has('blue')).toBe(true);
    expect(seen.has('green')).toBe(true);
    expect(seen.has('yellow')).toBe(true);
    expect(g.winner).toBe('red');
  });

  it('breaks when an enemy occupies a Nexus square', () => {
    let g = startRitual(['red', 'blue']);
    g = place(g, 'blue-w1', { r: 8, c: 8 }); // another Nexus cell
    g = endActivation(g);
    expect(g.winner).toBeNull();
    expect(g.ritual).toBeNull();
  });

  it('breaks when the Priest is defeated, and when it leaves the Nexus', () => {
    const g = startRitual(['red', 'blue']);
    expect(defeatUnit(g, 'red-p').ritual).toBeNull();

    let moved = withDice({ ...g, unitsMovedThisTurn: [] }, ['priest'], [3]);
    moved = moveUnit(moved, 'red-p', 'd0', { r: 5, c: 7 });
    expect(moved.ritual).toBeNull();
  });

  it('tolerates a friendly unit on another Nexus square', () => {
    let g = startRitual(['red', 'blue']);
    g = place(g, 'red-w1', { r: 8, c: 8 });
    g = endActivation(g);
    expect(g.winner).toBe('red');
  });
});

// ---- TEST 12 — Conquest ----------------------------------------------------

describe('TEST 12 — Conquest', () => {
  it('blocks respawns while an enemy Warrior holds the base, then eliminates', () => {
    let g = acting(['red', 'blue']);
    // Strip Blue to its Mage and Priest, and seal its base with a red Warrior.
    g = {
      ...g,
      units: g.units.filter((u) => u.owner !== 'blue' || u.kind !== 'warrior'),
    };
    g = place(g, 'red-w1', { r: 15, c: 8 }); // blue's base row (seat 2)
    g = place(g, 'blue-m', { r: 8, c: 8 });
    g = place(g, 'blue-p', { r: 8, c: 9 });

    g = defeatUnit(g, 'blue-m');
    expect(g.pendingRespawns.some((p) => p.id === 'blue-m')).toBe(true); // siege blocks it

    g = checkVictory(defeatUnit(g, 'blue-p'));
    expect(g.eliminated).toContain('blue');
    expect(g.winner).toBe('red');
    expect(g.winMethod).toBe('Conquest');
  });

  it('a queued respawn keeps a player alive while it can still come back', () => {
    let g = acting(['red', 'blue']);
    g = { ...g, units: g.units.filter((u) => u.owner !== 'blue' || u.kind === 'mage') };
    g = place(g, 'red-w1', { r: 15, c: 8 });
    g = place(g, 'blue-m', { r: 8, c: 8 });
    g = checkVictory(defeatUnit(g, 'blue-m'));
    expect(g.eliminated).toContain('blue'); // no units left on the board
    expect(g.winner).toBe('red');
  });
});

// ---- Combat: ties go to the attacker ---------------------------------------

describe('Combat — ties go to the attacker', () => {
  it('an equal roll defeats the defender', () => {
    let g = withDice(acting(), ['warrior'], [1]);
    g = place(g, 'red-w1', { r: 8, c: 8 });
    g = place(g, 'blue-w1', { r: 8, c: 9 });
    // Both roll a 1 → a tie, which the attacker takes.
    g = resolveAttack(g, ['red-w1'], 'blue-w1', seq([LO, LO]));
    expect(g.lastCombat?.attackRoll).toBe(g.lastCombat?.defenseRoll);
    expect(g.lastCombat?.outcome).toBe('win');
    expect(unitById(g, 'blue-w1')).toBeUndefined();
  });

  it('prices the odds as P(attack >= defence), with no draw branch', () => {
    let g = acting();
    g = place(g, 'red-w1', { r: 8, c: 8 });
    g = place(g, 'blue-w1', { r: 8, c: 9 });
    const o = combatOdds(g, ['red-w1'], 'blue-w1');
    expect(o.draw).toBe(0);
    expect(o.win + o.lose).toBeCloseTo(1, 10);
    expect(Math.round(o.win * 100)).toBe(58); // 21/36
  });

  it('a coordinated attack loses only ONE Warrior', () => {
    let g = withDice(acting(), ['warrior', 'warrior', 'warrior'], [1, 1, 1]);
    g = place(g, 'red-w1', { r: 8, c: 8 });
    g = place(g, 'red-w2', { r: 7, c: 9 });
    g = place(g, 'blue-w1', { r: 8, c: 9 });
    const before = g.units.filter((u) => u.owner === 'red' && u.kind === 'warrior').length;
    // 1 + 1 = 2 against a defender's 6 → the attack fails.
    g = resolveAttack(g, ['red-w1', 'red-w2'], 'blue-w1', seq([LO, LO, HI]));
    expect(g.lastCombat?.outcome).toBe('lose');
    expect(g.units.filter((u) => u.owner === 'red' && u.kind === 'warrior')).toHaveLength(before - 1);
    expect(unitById(g, 'blue-w1')).toBeDefined();
  });
});

// ---- The Priest: repel, flee, out-of-turn resurrection ---------------------

describe('Priest — repel and flee', () => {
  const attackPriest = (rig: number[]) => {
    let g = withDice(acting(), ['warrior'], [1]);
    g = place(g, 'red-w1', { r: 8, c: 8 });
    g = place(g, 'blue-p', { r: 8, c: 9 });
    return resolveAttack(g, ['red-w1'], 'blue-p', seq(rig));
  };

  it('never kills its attacker, and offers a retreat of exactly its defence roll', () => {
    const g = attackPriest([LO, HI]); // attacker 1, priest 6
    expect(g.lastCombat?.outcome).toBe('lose');
    expect(unitById(g, 'red-w1')).toBeDefined(); // the attacker survives
    expect(g.pendingFlee).toEqual({ priestId: 'blue-p', owner: 'blue', steps: 6 });
  });

  it('may decline the retreat and hold its ground', () => {
    let g = attackPriest([LO, HI]);
    g = resolveFlee(g, null);
    expect(g.pendingFlee).toBeNull();
    expect(at(g, 'blue-p').cell).toEqual({ r: 8, c: 9 });
  });

  it('may retreat any distance up to the roll, and refuses squares beyond it', () => {
    let g = attackPriest([LO, seq([0.34])()]); // priest rolls a 3
    expect(g.pendingFlee?.steps).toBe(3);
    const tooFar = resolveFlee(g, { r: 12, c: 9 }); // 4 squares — out of reach
    expect(tooFar.units.find((u) => u.id === 'blue-p')!.cell).toEqual({ r: 8, c: 9 });
    g = resolveFlee(g, { r: 10, c: 9 }); // 2 of its 3 squares
    expect(at(g, 'blue-p').cell).toEqual({ r: 10, c: 9 });
  });

  it('resurrects immediately when it flees onto a Gravestone, even out of turn', () => {
    let g = withDice(acting(), ['warrior'], [1]);
    g = { ...g, units: g.units.filter((u) => u.id !== 'blue-w6') }; // room for one more
    g = place(g, 'red-w1', { r: 8, c: 8 });
    g = place(g, 'blue-p', { r: 8, c: 9 });
    g = defeatUnit(place(g, 'blue-w5', { r: 10, c: 9 }), 'blue-w5');
    const bank = gravestoneBank(g);
    const before = g.units.filter((u) => u.owner === 'blue' && u.kind === 'warrior').length;

    g = resolveAttack(g, ['red-w1'], 'blue-p', seq([LO, HI]));
    expect(g.current).toBe('red'); // still red's turn — this is out of turn
    g = resolveFlee(g, { r: 10, c: 9 }); // land on the grave

    expect(g.units.filter((u) => u.owner === 'blue' && u.kind === 'warrior')).toHaveLength(before + 1);
    expect(g.gravestones).toHaveLength(0);
    expect(gravestoneBank(g)).toBe(bank); // still never returns to the bank
  });

  it('blocks all further play until it is settled, and endTurn force-declines it', () => {
    let g = attackPriest([LO, HI]);
    // Red cannot keep playing with the retreat unanswered.
    const tried = moveUnit(withDice(g, ['warrior'], [2]), 'red-w2', 'd0', { r: 2, c: 5 });
    expect(tried.pendingFlee).not.toBeNull();
    g = endActivation(g);
    expect(g.pendingFlee).toBeNull();
    expect(g.current).toBe('blue');
  });

  it('a Priest that loses its defence is defeated and respawns', () => {
    const g = attackPriest([HI, LO]);
    expect(g.pendingFlee).toBeNull();
    expect(at(g, 'blue-p').cell).toEqual({ r: 15, c: 8 }); // back at blue's base
  });
});

// ---- Save/load compatibility ----------------------------------------------

describe('save/load compatibility', () => {
  it('accepts a state built by this engine', () => {
    expect(isCurrentStateShape(createGame(['red', 'blue']))).toBe(true);
    expect(isCurrentStateShape(createGame(4))).toBe(true);
  });

  it('rejects a pre-token save rather than corrupting it', () => {
    const legacy = {
      ...createGame(['red', 'blue']),
      stones: [{ id: 'stone-0', cell: { r: 4, c: 7 }, collected: true }],
    };
    expect(isCurrentStateShape(legacy)).toBe(false);
  });

  it('rejects a save with no Gravestone bank, and any 3-player save', () => {
    const { graveBank: _drop, ...noBank } = createGame(['red', 'blue']);
    expect(isCurrentStateShape(noBank)).toBe(false);

    const threeSeats = { ...createGame(4), players: ['red', 'blue', 'green'] as PlayerColor[] };
    expect(isCurrentStateShape(threeSeats)).toBe(false);
  });
});
