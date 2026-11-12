// Hotseat "Game Results": before a local (hotseat) match the player is asked
// their name; when the match ends, what happened is recorded under that name on
// the server and listed at the bottom of the main page.
import type { GameState, PlayerColor } from '../game/types';
import type { BotLevel } from '../game/bot';

export const HOTSEAT_NAME_KEY = 'ms-hotseat-name';
const PENDING_KEY = 'ms-hotseat-pending';
export const NAME_MAX = 24;

export const RAGE_QUIT = 'Defeat by Rage Quit';
export type Outcome = 'Victory' | 'Defeat' | 'Draw' | typeof RAGE_QUIT;

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
  /** How the game ended: MageStone, Ritual, Conquest, Draw, or Rage Quit when
   *  the player left before the end. */
  method: string;
  /** The round the game ended in. */
  rounds: number;
  /** Enemy units the named player defeated. */
  kills: number;
  /** Everyone else at the table, e.g. "Blue (Hard AI)", "Green". Results saved
   *  before v0.16.1 say just "(AI)", without the bot's difficulty. */
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

/** The named player's seat: the first human one (null when all are bots). */
function humanSeat(game: GameState, bots: Partial<Record<PlayerColor, BotLevel>>): PlayerColor | null {
  return game.players.find((p) => !bots[p]) ?? null;
}

function opponentsOf(game: GameState, bots: Partial<Record<PlayerColor, BotLevel>>, color: PlayerColor) {
  return game.players
    .filter((p) => p !== color)
    .map((p) => {
      const lvl = bots[p];
      return lvl ? `${cap(p)} (${cap(lvl)} AI)` : cap(p);
    });
}

/** Build the record for a finished game, or null when there is nothing to
 *  record (game still running, no name, or no human seat). `rid` is the
 *  match's id, so a match can only be stored once. */
export function buildResult(
  game: GameState,
  bots: Partial<Record<PlayerColor, BotLevel>>,
  name: string,
  rid: string = newRid(),
): HotseatResult | null {
  const isOver = game.winner !== null || game.winMethod === 'Draw';
  if (!isOver || !name) return null;
  const color = humanSeat(game, bots);
  if (!color) return null;
  const outcome: Outcome = game.winner === null ? 'Draw' : game.winner === color ? 'Victory' : 'Defeat';
  return {
    rid,
    name,
    outcome,
    color,
    winner: game.winner,
    method: game.winMethod ?? 'Draw',
    rounds: game.turn,
    kills: game.kills?.[color] ?? 0,
    opponents: opponentsOf(game, bots, color),
  };
}

/** The record for a match the player LEFT before it ended (quit to the menu,
 *  started another game, closed or reloaded the page): a "Defeat by Rage Quit"
 *  at the round and kill count it had reached. Null when nothing would be
 *  recorded for it anyway (no name, or no human seat). */
export function buildQuitResult(
  game: GameState,
  bots: Partial<Record<PlayerColor, BotLevel>>,
  name: string,
  rid: string,
): HotseatResult | null {
  if (!name) return null;
  const color = humanSeat(game, bots);
  if (!color) return null;
  return {
    rid,
    name,
    outcome: RAGE_QUIT,
    color,
    winner: null,
    method: 'Rage Quit',
    rounds: game.turn,
    kills: game.kills?.[color] ?? 0,
    opponents: opponentsOf(game, bots, color),
  };
}

function newRid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** CSS class for the Result cell. */
export function outcomeClass(outcome: string): string {
  return outcome === RAGE_QUIT ? 'gr-defeat gr-ragequit' : `gr-${outcome.toLowerCase()}`;
}

/** The "Boss" column: what kind of opponent the player faced, read from the
 *  saved opponent list. "Easy" / "Medium" / "Hard" for a bot (several bots of
 *  different levels are listed hardest last), "Human" when every opponent was a
 *  person, and "Bot" for results saved before the level was recorded. */
export function bossOf(opponents: string[]): string {
  const levels = ['Easy', 'Medium', 'Hard'];
  const found = new Set<string>();
  let unknownBot = false;
  for (const o of opponents) {
    const m = /\((Easy|Medium|Hard) AI\)$/.exec(o);
    if (m) found.add(m[1]);
    else if (/\(AI\)$/.test(o)) unknownBot = true;
  }
  if (found.size) return levels.filter((l) => found.has(l)).join(', ');
  if (unknownBot) return 'Bot';
  return 'Human';
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

// ---- matches in progress ----------------------------------------------------
// Every started match is written here (as the rage-quit result it WOULD be)
// and kept up to date while it runs. Finishing it removes the entry; leaving
// it turns the entry into a result. If the page dies without a chance to say
// so (browser crash, app killed, the unload message lost), the entry is still
// here on the next visit and is recorded then: no started match goes unrecorded.
const LIVE_KEY = 'ms-hotseat-live';
export interface LiveMatch {
  result: HotseatResult;
  /** Last time the tab playing it updated it (ms). */
  seen: number;
}
export function readLive(): Record<string, LiveMatch> {
  try {
    const v = JSON.parse(localStorage.getItem(LIVE_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function writeLive(map: Record<string, LiveMatch>): void {
  try {
    if (Object.keys(map).length) localStorage.setItem(LIVE_KEY, JSON.stringify(map));
    else localStorage.removeItem(LIVE_KEY);
  } catch {
    /* storage blocked */
  }
}
export function putLive(result: HotseatResult): void {
  writeLive({ ...readLive(), [result.rid]: { result, seen: Date.now() } });
}
export function dropLive(rid: string): void {
  const map = readLive();
  if (!(rid in map)) return;
  delete map[rid];
  writeLive(map);
}
