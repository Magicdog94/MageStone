import { useMusic } from '../audio/music';

/** Floating mute/unmute control for the ambient score. Persists across the
 *  landing screen and matches (rendered once at the app root). */
export function MusicToggle() {
  const muted = useMusic((s) => s.muted);
  const started = useMusic((s) => s.started);
  const toggle = useMusic((s) => s.toggle);
  const silent = muted || !started;
  return (
    <button
      type="button"
      className={`music-toggle${silent ? ' off' : ''}`}
      onClick={toggle}
      aria-label={silent ? 'Turn music on' : 'Turn music off'}
      title={silent ? 'Music off' : 'Music on'}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        {/* note */}
        <path
          d="M9 17V6l9-2v9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="6.5" cy="17" r="2.5" fill="currentColor" />
        <circle cx="15.5" cy="15" r="2.5" fill="currentColor" />
        {/* slash when silent */}
        {silent && (
          <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
