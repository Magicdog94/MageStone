import { useEffect, useState } from 'react';

/** Floating toggle to take the game full-screen (browser Fullscreen API).
 *  Persists across the landing screen and matches. */
export function FullscreenToggle() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const onChange = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <button
      type="button"
      className="fs-toggle"
      onClick={toggle}
      aria-label={fs ? 'Exit full screen' : 'Full screen'}
      title={fs ? 'Exit full screen' : 'Full screen'}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {fs ? (
          <path d="M9 3v3a2 2 0 0 1-2 2H4M20 8h-3a2 2 0 0 1-2-2V3M4 16h3a2 2 0 0 1 2 2v3M15 21v-3a2 2 0 0 1 2-2h3" />
        ) : (
          <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
        )}
      </svg>
    </button>
  );
}
