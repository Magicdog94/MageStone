// Hotseat "Game Results": before a local (hotseat) match the player is asked
// their name; when the match ends, what happened is recorded under that name on
// the server and listed at the bottom of the main page.
import type { GameState, PlayerColor } from '../game/types';
import type { BotLevel } from '../game/bot';

export const HOTSEAT_NAME_KEY = 'ms-hotseat-name';
const PENDING_KEY = 'ms-hotseat-pending';
export const NAME_MAX = 24;

export type Outcome = 'Victory' | 'Defeat' | 'Draw';

/** One finished hotseat match, as sent to and returned by the server. */
export interface HotseatResult {
  /** Client-made id so a resend after a dropped connection isn't stored twice. */
  rid: string;
  name: string;
  outcome: Outcome;
  /** The colour the named player had (the first human seat). */
  color: PlayerColor;
  /** Winning colour; null for a draw. */
  winner: PlayerColor | null;
  /** How the game ended: MageStone, Ritual, Conquest or Draw. */
  method: string;
  /** The round the game ended in. */
  rounds: number;
  /** Enemy units the named player defeated. */
  kills: number;
  /** Everyone else at the table, e.g. "Blue (AI)", "Green". */
  opponents: string[];
  created?: string;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function readHotseatName(): string {
  try {
    return localStorage.getItem(HOTSEAT_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveHotseatName(name: string): void {
  try {
    localStorage.setItem(HOTSEAT_NAME_KEY, name);
  } catch {
    /* storage blocked — the name just isn't remembered next time */
  }
}

/** Build the record for a finished game, or null when there is nothing to
 *  record (game still running, no name, or no human seat). */
export function buildResult(
  game: GameState,
  bots: Partial<Record<PlayerColor, BotLevel>>,
  name: string,
): HotseatResult | null {
  const isOver = game.winner !== null || game.winMethod === 'Draw';
  if (!isOver || !name) return null;
  const color = game.players.find((p) => !bots[p]);
  if (!color) return null;
  const outcome: Outcome = game.winner === null ? 'Draw' : game.winner === color ? 'Victory' : 'Defeat';
  return {
    rid: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    name,
    outcome,
    color,
    winner: game.winner,
    method: game.winMethod ?? 'Draw',
    rounds: game.turn,
    kills: game.kills?.[color] ?? 0,
    opponents: game.players
      .filter((p) => p !== color)
      .map((p) => (bots[p] ? `${cap(p)} (AI)` : cap(p))),
  };
}

// ---- results waiting to reach the server -----------------------------------
// The free host naps when idle, so a result is kept in localStorage until the
// server confirms it, and retried the next time the page talks to the server.
export function readPending(): HotseatResult[] {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writePending(list: HotseatResult[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
}
export function addPending(r: HotseatResult): void {
  writePending([...readPending().filter((p) => p.rid !== r.rid), r]);
}
export function clearPending(rid: string): void {
  writePending(readPending().filter((p) => p.rid !== rid));
}
