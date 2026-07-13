import { useEffect, useState } from 'react';
import { useGame } from '../store';

/** True when the viewport is taller than it is wide (portrait). */
function isPortrait() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia) return window.matchMedia('(orientation: portrait)').matches;
  return window.innerHeight > window.innerWidth;
}

/**
 * On the mobile layout the game is designed for landscape; if the phone is held
 * in portrait, cover the screen with a "Turn to Landscape" prompt until it's
 * rotated. Desktop layout is never gated.
 */
export function OrientationGate() {
  const mobile = useGame((s) => s.settings.layout === 'mobile');
  const [portrait, setPortrait] = useState(isPortrait);

  useEffect(() => {
    const update = () => setPortrait(isPortrait());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  if (!mobile || !portrait) return null;
  return (
    <div className="orient-gate" role="alertdialog" aria-label="Rotate your device">
      <div className="orient-card">
        <svg className="orient-icon" width="56" height="56" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="7" y="2.5" width="10" height="19" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M4.5 9.5a8 8 0 0 1 15 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path d="M19.8 6.4l-.3 3.3-3.1-1.1z" fill="currentColor" />
        </svg>
        <div className="orient-title">Turn to Landscape</div>
        <div className="orient-sub">Rotate your device to play MageStone.</div>
      </div>
    </div>
  );
}
