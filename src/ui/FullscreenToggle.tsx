import { useEffect, useState } from 'react';

// The Fullscreen API with its WebKit-prefixed variants (older Android
// browsers and iPadOS Safari). iPhone Safari has NO fullscreen API for pages
// at all — there the only true fullscreen is "Add to Home Screen" (the app
// ships a PWA manifest with display:fullscreen), so the button shows a hint.
interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}

const doc = document as FsDocument;
const rootEl = document.documentElement as FsElement;
const supported = !!(rootEl.requestFullscreen || rootEl.webkitRequestFullscreen);
const fsElement = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

/** Floating toggle to take the game full-screen (browser Fullscreen API).
 *  Persists across the landing screen and matches. */
export function FullscreenToggle() {
  const [fs, setFs] = useState(false);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const onChange = () => setFs(!!fsElement());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggle = () => {
    if (!supported) {
      // iPhone Safari: point at the one mechanism that actually works.
      setHint(true);
      window.setTimeout(() => setHint(false), 4200);
      return;
    }
    if (fsElement()) {
      if (doc.exitFullscreen) void doc.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    } else {
      if (rootEl.requestFullscreen) void rootEl.requestFullscreen();
      else rootEl.webkitRequestFullscreen?.();
    }
  };

  return (
    <>
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
      {hint && (
        <div className="fs-hint" role="status">
          For full screen on iPhone: share <span aria-hidden="true">→</span> &ldquo;Add to Home
          Screen&rdquo;, then open MageStone from there.
        </div>
      )}
    </>
  );
}
