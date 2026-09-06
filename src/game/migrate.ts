// Shape checks for game states that arrive from OUTSIDE this build: the
// sessionStorage crash-recovery snapshot and a peer's broadcast in an online
// match. Both can come from an older client, and the 2026 ruleset changed the
// state shape in ways that cannot be inferred backwards:
//
//   • MageStone tokens carry `carrier` + `activated` instead of `collected`.
//     An old snapshot records a carried stone only as `collected: true`, with
//     no record of WHICH Mage holds it, so its activation history is
//     unrecoverable.
//   • `graveBank` is a stored counter now, not derived from the board.
//   • Only 2- and 4-player games exist.
//
// Rather than guess — and silently corrupt a match in progress — an
// incompatible state is refused and the player starts a fresh game.

import type { GameState } from './types';

/** Is this a state the CURRENT engine can safely resume? */
export function isCurrentStateShape(s: unknown): s is GameState {
  if (!s || typeof s !== 'object') return false;
  const g = s as Partial<GameState> & { stones?: unknown };
  if (!Array.isArray(g.players) || !Array.isArray(g.units) || !Array.isArray(g.stones)) return false;
  // 3-player games are gone; anything else was never valid.
  if (g.players.length !== 2 && g.players.length !== 4) return false;
  // The finite Gravestone bank must be present — a derived-bank state predates it.
  if (typeof g.graveBank !== 'number') return false;
  if (!Array.isArray(g.resurrectedThisTurn)) return false;
  // Every stone must be a token of the current shape.
  for (const raw of g.stones as unknown[]) {
    if (!raw || typeof raw !== 'object') return false;
    const st = raw as Record<string, unknown>;
    if (typeof st.activated !== 'boolean') return false;
    if (!('carrier' in st)) return false;
    if (st.carrier !== null && typeof st.carrier !== 'string') return false;
  }
  return true;
}

/** Log once and discard an unusable state, so the caller can fall back to a
 *  fresh game instead of resuming a corrupted one. */
export function acceptState(s: unknown, where: string): GameState | null {
  if (isCurrentStateShape(s)) return s;
  console.warn(
    `MageStone: ignoring an incompatible saved game (${where}). It was created by an ` +
      `older version, before MageStone tokens carried their own activation state. Start a new game.`,
  );
  return null;
}
