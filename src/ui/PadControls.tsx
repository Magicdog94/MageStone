// On-screen arrow pad — the mobile counterpart to the desktop WASD panning.
// Press-and-hold arrows write into the shared panState that Scene's pan loop
// reads each frame (▲=W toward the view, ▼=S back, ◀▶ strafe), so the board
// glides exactly like holding the keys. Rendered only in the Mobile layout.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { panState, type PanKey } from '../three/pan';
import { useGame } from '../store';

function Chevron({ rot }: { rot: number }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      style={{ transform: `rotate(${rot}deg)` }}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 10.5 8 5.5l4.5 5" />
    </svg>
  );
}

function ArrowButton({ k, rot, label, cls }: { k: PanKey; rot: number; label: string; cls: string }) {
  const press = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    panState[k] = true;
    // Capture so sliding the finger off the button still delivers the release
    // (best-effort — some browsers refuse capture for exotic pointer ids).
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* fall back to plain up/cancel events */
    }
  };
  const release = () => {
    panState[k] = false;
  };
  return (
    <button
      type="button"
      className={`dpad-btn ${cls}`}
      aria-label={label}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Chevron rot={rot} />
    </button>
  );
}

/** Pan arrows for touch play — bottom-right, above the action bar. */
export function PadControls() {
  const mobile = useGame((s) => s.settings.layout === 'mobile');
  if (!mobile) return null;
  return (
    <div className="dpad" role="group" aria-label="Pan the board">
      <ArrowButton k="w" rot={0} label="Pan up" cls="dpad-up" />
      <ArrowButton k="a" rot={-90} label="Pan left" cls="dpad-left" />
      <ArrowButton k="s" rot={180} label="Pan down" cls="dpad-down" />
      <ArrowButton k="d" rot={90} label="Pan right" cls="dpad-right" />
    </div>
  );
}
