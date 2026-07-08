// Initial game-state construction: base formations, MageStone scatter, pools.

import { PLAYER_ROTATION, rotateCell } from './board';
import type {
  Cell,
  GameState,
  MageStone,
  PlayerColor,
  Unit,
  UnitKind,
} from './types';

// Base formation along an edge, in the player's own left→right order.
const FORMATION: UnitKind[] = [
  'warrior',
  'warrior',
  'warrior',
  'priest',
  'mage',
  'warrior',
  'warrior',
  'warrior',
];

// Top base cells (slot i → column 4+i on row 0). A seat rotation rotates these
// onto another edge, giving rotational symmetry.
function baseCells(rotation: number): Cell[] {
  return FORMATION.map((_, i) => rotateCell({ r: 0, c: 4 + i }, rotation));
}

/**
 * Assign each playing colour a board seat (quarter-turns from the top). Two
 * players are seated **opposite** each other (top & bottom) whatever colours
 * they chose; four players fill every side at their canonical seats.
 */
function assignSeats(players: PlayerColor[]): Record<PlayerColor, number> {
  const seats: Record<PlayerColor, number> = { ...PLAYER_ROTATION };
  if (players.length === 2) {
    seats[players[0]] = 0; // top
    seats[players[1]] = 2; // bottom — directly opposite
  } else {
    players.forEach((p) => (seats[p] = PLAYER_ROTATION[p]));
  }
  return seats;
}

function makeUnits(players: PlayerColor[], seats: Record<PlayerColor, number>): Unit[] {
  const units: Unit[] = [];
  for (const player of players) {
    const cells = baseCells(seats[player]);
    let warriorN = 0;
    FORMATION.forEach((kind, i) => {
      const idx = kind === 'warrior' ? `w${++warriorN}` : kind[0];
      units.push({
        id: `${player}-${idx}`,
        kind,
        owner: player,
        cell: cells[i],
        carried: 0,
        activated: 0,
      });
    });
  }
  return units;
}

/**
 * MageStone layouts.
 *
 * A layout is just a list of **orbit seeds**, each a cell in the *top-left
 * quadrant* of the central 8×8 (rows/cols 4–7, excluding the Nexus corner 7,7).
 * Each seed is expanded into its 4-rotation orbit, which drops exactly one stone
 * in each quadrant — so any set of distinct seeds is automatically:
 *   • rotationally symmetric (4-fold) → perfectly fair for every seat/colour,
 *   • inside the central 8×8 and off the Nexus (rotation preserves both),
 *   • collision-free (distinct quadrant cells live in distinct orbits).
 * A game uses the first `playerCount` seeds → exactly **4 stones per player**
 * (8 for 2p, 16 for 4p). Seeds are ordered so the first two also make a balanced
 * 2-player subset.
 */
export interface StoneLayout {
  id: string;
  name: string;
  seeds: Cell[]; // 4 seeds, each in rows/cols 4–7 (Nexus corner 7,7 excluded)
}

// Four distinct presets (+ Random in the picker) — they fit ONE row in the
// New Game modal, keeping the whole dialog visible without scrolling.
export const STONE_LAYOUTS: StoneLayout[] = [
  { id: 'diamond', name: 'Diamond', seeds: [{ r: 4, c: 7 }, { r: 7, c: 4 }, { r: 5, c: 6 }, { r: 6, c: 5 }] },
  { id: 'corners', name: 'Corner Boxes', seeds: [{ r: 4, c: 4 }, { r: 5, c: 5 }, { r: 4, c: 5 }, { r: 5, c: 4 }] },
  { id: 'cross', name: 'Cross', seeds: [{ r: 4, c: 7 }, { r: 7, c: 4 }, { r: 6, c: 7 }, { r: 7, c: 6 }] },
  { id: 'scatter', name: 'Scatter', seeds: [{ r: 4, c: 4 }, { r: 5, c: 6 }, { r: 6, c: 4 }, { r: 7, c: 5 }] },
];

/** Sentinel layout id meaning "pick a random layout at game start". */
export const RANDOM_LAYOUT = 'random';

const DEFAULT_LAYOUT = STONE_LAYOUTS[0];

export function layoutById(id: string): StoneLayout {
  if (id === RANDOM_LAYOUT) return STONE_LAYOUTS[Math.floor(Math.random() * STONE_LAYOUTS.length)];
  return STONE_LAYOUTS.find((l) => l.id === id) ?? DEFAULT_LAYOUT;
}

/** Stone cells for a layout & player count: the first `playerCount` seeds, each
 *  expanded to its 4-rotation orbit (→ 4 stones per player). Pure — also used to
 *  draw the layout previews in the New Game modal. */
export function stoneCells(layout: StoneLayout, playerCount: number): Cell[] {
  const cells: Cell[] = [];
  const n = Math.min(playerCount, layout.seeds.length);
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 4; t++) cells.push(rotateCell(layout.seeds[i], t));
  }
  return cells;
}

function makeStones(layout: StoneLayout, playerCount: number): MageStone[] {
  return stoneCells(layout, playerCount).map((cell, i) => ({ id: `stone-${i}`, cell, collected: false }));
}

const TWO_PLAYER: PlayerColor[] = ['red', 'green'];
const THREE_PLAYER: PlayerColor[] = ['red', 'blue', 'green'];
const FOUR_PLAYER: PlayerColor[] = ['red', 'blue', 'green', 'yellow'];

// Seating goes clockwise from the top: red (top) → blue (right) → green
// (bottom) → yellow (left). Turn order follows this ring regardless of which
// colours a game actually uses.
const CLOCKWISE: PlayerColor[] = ['red', 'blue', 'green', 'yellow'];

export function playerSet(count: number): PlayerColor[] {
  if (count <= 2) return TWO_PLAYER;
  if (count === 3) return THREE_PLAYER;
  return FOUR_PLAYER;
}

/** Put an arbitrary colour selection into clockwise turn order (dedup + sort). */
export function orderPlayers(colors: PlayerColor[]): PlayerColor[] {
  return CLOCKWISE.filter((c) => colors.includes(c));
}

/**
 * Build the initial game state. Pass a player *count* (legacy: picks the default
 * colour set for that count) or an explicit list of team *colours* — each colour
 * occupies its fixed home edge, so the selection is also a seat selection.
 */
export function createGame(players: number | PlayerColor[] = 2, layoutId = DEFAULT_LAYOUT.id): GameState {
  const colors = Array.isArray(players) ? orderPlayers(players) : playerSet(players);
  return buildGame(colors, layoutById(layoutId));
}

function buildGame(players: PlayerColor[], layout: StoneLayout): GameState {
  const seats = assignSeats(players);
  return {
    players,
    seats,
    current: players[0],
    turn: 1,
    turnPhase: 'roll',
    dice: [],
    units: makeUnits(players, seats),
    stones: makeStones(layout, players.length),
    gravestones: [],
    unitsMovedThisTurn: [],
    unitsActedThisTurn: [],
    ritual: null,
    lastCombat: null,
    pendingBolt: null,
    pendingRespawns: [],
    eliminated: [],
    kills: { red: 0, blue: 0, green: 0, yellow: 0 },
    winner: null,
    log: [`${players[0]} to start. Roll the dice.`],
  };
}
