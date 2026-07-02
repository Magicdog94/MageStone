import { useEffect, useState, type CSSProperties } from 'react';
import { useGame } from '../store';
import type { PlayerColor } from '../game/types';
import { COLORS } from '../three/coords';
import { GraveIcon } from './Icons';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const TOAST_MS = 5000;

/**
 * Pops a "<Colour> is eliminated" notice whenever a player is knocked out of
 * the game (zero units left while their base was besieged). Subscribes to the
 * store directly: each new entry in `game.eliminated` toasts once for a few
 * seconds, then fades; a new game (shorter list) resets silently.
 */
export function EliminationToast() {
  const [visible, setVisible] = useState<PlayerColor[]>([]);

  useEffect(() => {
    let seen = useGame.getState().game.eliminated;
    return useGame.subscribe((s) => {
      const elim = s.game.eliminated;
      if (elim === seen) return;
      const fresh = elim.filter((p) => !seen.includes(p));
      seen = elim;
      if (!fresh.length) return;
      setVisible((v) => [...v, ...fresh]);
      setTimeout(() => setVisible((v) => v.filter((p) => !fresh.includes(p))), TOAST_MS);
    });
  }, []);

  if (!visible.length) return null;
  return (
    <div className="elim-toasts" role="status" aria-live="assertive">
      {visible.map((p) => (
        <div key={p} className="elim-toast" style={{ '--pc': COLORS[p] } as CSSProperties}>
          <GraveIcon size={18} />
          <span>
            <strong>{cap(p)}</strong> is eliminated
          </span>
        </div>
      ))}
    </div>
  );
}
