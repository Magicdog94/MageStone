// Board geometry: 16x16 grid with four corners cut in a 4-step staircase.
// Each outer edge ends up exactly 8 cells wide — matching the 8-unit base
// formation (3 Warriors · Priest · Mage · 3 Warriors).

import type { Cell, PlayerColor } from './types';

export const N = 16;
export const CUT = 4;

/** Column inset for a given row, so corners are stepped away. */
function rowInset(r: number): number {
  return Math.max(0, CUT - Math.min(r, N - 1 - r));
}

/** Does a playable cell exist at (r,c)? */
export function exists(r: number, c: number): boolean {
  if (r < 0 || c < 0 || r >= N || c >= N) return false;
  const k = rowInset(r);
  return c >= k && c <= N - 1 - k;
}

export function cellExists(cell: Cell): boolean {
  return exists(cell.r, cell.c);
}

/** Central 8x8 MageStone zone (rows/cols 4..11). */
export function inCentralZone(r: number, c: number): boolean {
  return r >= 4 && r <= 11 && c >= 4 && c <= 11;
}

/** Central 2x2 Nexus (rows/cols 7..8). */
export function inNexus(r: number, c: number): boolean {
  return r >= 7 && r <= 8 && c >= 7 && c <= 8;
}

export const NEXUS_CELLS: Cell[] = [
  { r: 7, c: 7 },
  { r: 7, c: 8 },
  { r: 8, c: 7 },
  { r: 8, c: 8 },
];

/** Which player edge (if any) a cell belongs to (canonical colour mapping). */
export function edgeOwner(r: number, c: number): PlayerColor | null {
  if (!exists(r, c)) return null;
  if (r === 0) return 'red'; // top
  if (c === N - 1) return 'blue'; // right
  if (r === N - 1) return 'green'; // bottom
  if (c === 0) return 'yellow'; // left
  return null;
}

/** Which outer edge a cell lies on, as quarter-turns from the top
 *  (0=top, 1=right, 2=bottom, 3=left), or null if it isn't an edge cell.
 *  Seat-based — pair with `GameState.seats` to find the actual owner. */
export function edgeRotation(r: number, c: number): number | null {
  if (!exists(r, c)) return null;
  if (r === 0) return 0; // top
  if (c === N - 1) return 1; // right
  if (r === N - 1) return 2; // bottom
  if (c === 0) return 3; // left
  return null;
}

/** All playable cells, row-major. */
export function allCells(): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (exists(r, c)) cells.push({ r, c });
    }
  }
  return cells;
}

export function cellKey(cell: Cell): string {
  return `${cell.r},${cell.c}`;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.r === b.r && a.c === b.c;
}

/**
 * Rotate a base cell (defined from red/top's perspective) into another
 * player's frame. 90° clockwise: (r,c) -> (c, N-1-r). Keeps the central
 * zone and Nexus invariant, so layouts stay symmetric per player.
 */
export function rotateCell(cell: Cell, quarterTurns: number): Cell {
  let { r, c } = cell;
  const turns = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) {
    const nr = c;
    const nc = N - 1 - r;
    r = nr;
    c = nc;
  }
  return { r, c };
}

/** Quarter-turn offset of each player's home edge relative to red (top). */
export const PLAYER_ROTATION: Record<PlayerColor, number> = {
  red: 0,
  blue: 1,
  green: 2,
  yellow: 3,
};
