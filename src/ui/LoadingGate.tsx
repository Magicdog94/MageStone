import { useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';

/**
 * A full-screen "Loading Game" cover shown over the 3D view until the scene's
 * heavy assets (unit + room + exterior GLBs, textures) have finished loading, so
 * the player never sees a half-built board pop in. The Scene mounts underneath
 * and drives the load; drei's `useProgress` reports it. A safety timeout makes
 * sure we never trap the player behind the cover if a load stalls.
 */
export function LoadingGate() {
  const { active, progress, total } = useProgress();
  const [ready, setReady] = useState(false);
  const settle = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Ready once drei has tracked at least one asset and gone idle at 100%.
    // (On a second game the assets are cached, so this is satisfied at once.)
    if (total > 0 && !active && progress >= 100) {
      settle.current = window.setTimeout(() => setReady(true), 300);
      return () => window.clearTimeout(settle.current);
    }
  }, [active, progress, total]);

  useEffect(() => {
    // Never leave the player stuck behind the cover if loading never resolves.
    const t = window.setTimeout(() => setReady(true), 20000);
    return () => window.clearTimeout(t);
  }, []);

  if (ready) return null;
  const pct = Math.max(6, Math.round(progress));
  return (
    <div className="loading-gate" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-title">Loading Game</div>
        <div className="loading-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="loading-pct">{pct}%</div>
        <div className="loading-sub">Summoning the board…</div>
      </div>
    </div>
  );
}
