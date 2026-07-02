import { N } from '../game/board';
import type { Cell, PlayerColor } from '../game/types';

export const CELL = 1;
const OFFSET = (N - 1) / 2;

/** Board cell → world position (board lies on the XZ plane, Y up). */
export function cellToWorld(cell: Cell, y = 0): [number, number, number] {
  return [(cell.c - OFFSET) * CELL, y, (cell.r - OFFSET) * CELL];
}

export const COLORS: Record<PlayerColor, string> = {
  red: '#c0392b',
  blue: '#2e6da4',
  green: '#3a8a4f',
  yellow: '#c9a227',
};

// Top surface of the (debossed) marble tiles, where pieces stand — set below
// the raised gold trim so tiles read as recessed pockets.
export const TILE_SURFACE = 0.18;

// The stone plaza the table's stand rises from (world Y). Shared by the table
// stand (Board.tsx) and the arena environment (Scene.tsx) so they always meet.
export const FLOOR_Y = -4.8;

export const BOARD = {
  // Themed emerald-marble surface with the gold arcane inlay + Nexus emblem,
  // framed by the raised gold lattice.
  highlight: '#56e0a8', // legal-move tile tint
  target: '#ff5a4d', // attack-target ring
  gold: '#cba65a', // gold lattice + nexus tiles
  stone: '#dfeae2', // neutral tile multiplier — lets the emerald marble show
  nexus: '#e2cb9c', // light gilded multiplier — lets the drawn Nexus emblem read
};
