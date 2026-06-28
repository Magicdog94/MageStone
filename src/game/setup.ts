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

// Red/top base cells (slot i → column 4+i on row 0). Other players are
// rotations of these, giving rotational symmetry.
function baseCells(player: PlayerColor): Cell[] {
  const turns = PLAYER_ROTATION[player];
  return FORMATION.map((_, i) => rotateCell({ r: 0, c: 4 + i }, turns));
}

function makeUnits(players: PlayerColor[]): Unit[] {
  const units: Unit[] = [];
  for (const player of players) {
    const cells = baseCells(player);
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
 * Place 4 MageStones per player inside the central 8x8, never on the Nexus,
 * symmetric across all four quadrants. We pick `playerCount` orbit seeds and
 * expand each into its 4-rotation orbit → 4 stones per player.
 */
// Four rotational orbit seeds tracing a diamond ring at Manhattan distance 4
// from the board centre (each seed expands to a 4-cell orbit). Taking
// `playerCount` seeds gives 4 stones per player, symmetric across quadrants.
const STONE_SEEDS: Cell[] = [
  { r: 4, c: 8 },
  { r: 4, c: 7 },
  { r: 5, c: 6 },
  { r: 5, c: 9 },
];

function makeStones(playerCount: number): MageStone[] {
  const cells: Cell[] = [];
  for (let i = 0; i < playerCount && i < STONE_SEEDS.length; i++) {
    for (let t = 0; t < 4; t++) cells.push(rotateCell(STONE_SEEDS[i], t));
  }
  return cells.map((cell, i) => ({ id: `stone-${i}`, cell, collected: false }));
}

const TWO_PLAYER: PlayerColor[] = ['red', 'green'];
const THREE_PLAYER: PlayerColor[] = ['red', 'blue', 'green'];
const FOUR_PLAYER: PlayerColor[] = ['red', 'blue', 'green', 'yellow'];

export function playerSet(count: number): PlayerColor[] {
  if (count <= 2) return TWO_PLAYER;
  if (count === 3) return THREE_PLAYER;
  return FOUR_PLAYER;
}

export function createGame(playerCount = 2): GameState {
  const players = playerSet(playerCount);
  const poolSize = 3 * players.length; // max 3 gravestones per player
  return {
    players,
    current: players[0],
    turnPhase: 'roll',
    dice: [],
    units: makeUnits(players),
    stones: makeStones(players.length),
    gravestones: [],
    gravestonePool: poolSize,
    unitsMovedThisTurn: [],
    unitsActedThisTurn: [],
    ritual: null,
    lastCombat: null,
    pendingRespawns: [],
    pendingFlee: null,
    kills: { red: 0, blue: 0, green: 0, yellow: 0 },
    winner: null,
    log: [`${players[0]} to start. Roll the dice.`],
  };
}
