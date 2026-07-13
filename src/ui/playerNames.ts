import { useNet } from '../net/useNet';
import { useGame } from '../store';
import type { PlayerColor } from '../game/types';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * A function mapping a player colour to its DISPLAY label: in an online match the
 * account username (e.g. "Magicdog94"), otherwise the capitalised colour for
 * local hot-seat games. Used everywhere a player is named (player strip, turn
 * banner, combat announcement, winner panel) so online players read as
 * themselves, in their team colour, rather than "Red"/"Blue".
 */
export function usePlayerLabel(): (c: PlayerColor) => string {
  const online = useGame((s) => s.online);
  const players = useNet((s) => s.room?.players);
  return (c: PlayerColor) => {
    if (online && players) {
      const p = players.find((rp) => rp.color === c);
      if (p?.username) return p.username;
    }
    return cap(c);
  };
}
