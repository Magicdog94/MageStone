import type { CSSProperties } from 'react';
import { useGame } from '../store';
import { COLORS } from '../three/coords';
import { besiegersOf, siegedPlayers } from '../game/rules';
import { SiegeIcon } from './Icons';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * On-screen alert whenever an enemy unit is standing on a player's base: that
 * player is "under siege" and their felled Mage/Priest can't respawn until the
 * base clears. Purely derived from live unit positions (via `siegedPlayers`), so
 * it appears the moment an enemy steps onto a base and vanishes when it leaves.
 * One pill per besieged player (a 4-player game can have several at once).
 */
export function SiegeBanner() {
  const game = useGame((s) => s.game);
  if (game.winner) return null;
  const sieged = siegedPlayers(game);
  if (sieged.length === 0) return null;
  return (
    <div className="siege-alert" role="status" aria-live="polite">
      {sieged.map((p) => {
        // The pill's frame + icon carry the besieger's colour (matching the
        // base glow on the board); the name stays in the besieged team's colour.
        const attacker = besiegersOf(game, p)[0];
        const style = {
          '--pc': COLORS[p],
          ...(attacker ? { '--ac': COLORS[attacker] } : {}),
        } as CSSProperties;
        return (
          <div key={p} className="siege-pill" style={style}>
            <SiegeIcon size={16} />
            <span className="siege-text">
              <strong>{cap(p)}</strong> is under siege
            </span>
          </div>
        );
      })}
    </div>
  );
}
