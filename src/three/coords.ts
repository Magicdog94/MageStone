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

export const BOARD = {
  // Themed emerald-marble surface (no pictorial art) spanned across all tiles,
  // framed by the raised gold inlay lattice and the gilded 2x2 nexus.
  highlight: '#56e0a8', // legal-move tile tint
  target: '#ff5a4d', // attack-target ring
  gold: '#cba65a', // gold lattice + nexus tiles
  stone: '#dfeae2', // neutral tile multiplier — lets the emerald marble show
  nexus: '#caa85e', // gilded multiplier for the central 2×2 Nexus tiles
};
