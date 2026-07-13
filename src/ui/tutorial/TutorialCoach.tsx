import { useEffect, useReducer, useRef, type CSSProperties } from 'react';
import { useGame } from '../../store';
import { useNet } from '../../net/useNet';
import { useTutorial, type Placement } from './useTutorial';
import { runTutorial } from './tutorialScript';

const BOX_W = 320;
const GAP = 14;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

function measure(sel: string): Rect | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
}

/** Position for the text box + its little arrow, given the anchor rect. */
function layout(rect: Rect | null, placement: Placement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect || placement === 'center') {
    return {
      box: { top: vh / 2, left: vw / 2, transform: 'translate(-50%, -50%)' } as CSSProperties,
      arrow: null as CSSProperties | null,
    };
  }
  const clampX = (cx: number) => clamp(cx - BOX_W / 2, 8, vw - BOX_W - 8);
  if (placement === 'bottom' || placement === 'top') {
    const left = clampX(rect.cx);
    const box: CSSProperties =
      placement === 'bottom' ? { top: rect.bottom + GAP, left } : { bottom: vh - rect.top + GAP, left };
    const arrow: CSSProperties = {
      left: clamp(rect.cx - left, 18, BOX_W - 18),
      [placement === 'bottom' ? 'top' : 'bottom']: -8,
    };
    return { box, arrow };
  }
  // left / right
  const top = clamp(rect.cy - 40, 8, vh - 150);
  const box: CSSProperties =
    placement === 'right' ? { left: rect.right + GAP, top } : { right: vw - rect.left + GAP, top };
  const arrow: CSSProperties = {
    top: clamp(rect.cy - top, 18, 120),
    [placement === 'right' ? 'left' : 'right']: -8,
  };
  return { box, arrow };
}

export function TutorialCoach() {
  const tutorial = useGame((s) => s.tutorial);
  const callout = useTutorial((s) => s.callout);
  const gotIt = useTutorial((s) => s.gotIt);
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  const started = useRef(false);

  // Start (and later tear down) the guided runner when tutorial mode toggles.
  useEffect(() => {
    if (tutorial && !started.current) {
      started.current = true;
      runTutorial(() => {
        useGame.setState({ tutorial: false });
        useTutorial.getState().finish();
        useNet.getState().setScreen('landing');
      });
    }
    if (!tutorial) started.current = false;
  }, [tutorial]);

  // Re-render on a timer (not rAF — rAF pauses on hidden tabs) and on resize, so
  // the spotlight re-measures the current anchor below. Measuring in render (vs.
  // holding a rect in state) keeps the ring glued to the element even as it
  // appears late or the board animates — no stale state to fall out of sync.
  useEffect(() => {
    const id = window.setInterval(forceTick, 100);
    window.addEventListener('resize', forceTick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', forceTick);
    };
  }, []);

  if (!tutorial) return null;

  const skip = () => {
    useGame.setState({ tutorial: false });
    useTutorial.getState().finish();
    useNet.getState().setScreen('landing');
  };

  const anchor = callout?.anchor;
  const rect = anchor ? measure(anchor) : null; // fresh measurement each render
  const placement = callout?.placement ?? 'center';
  const { box, arrow } = layout(rect, placement);
  const spot = rect
    ? ({ top: rect.top - 6, left: rect.left - 6, width: rect.right - rect.left + 12, height: rect.bottom - rect.top + 12 } as CSSProperties)
    : null;

  return (
    <div className="tut-root">
      {/* full-screen click blocker so the guided game isn't disturbed */}
      <div className="tut-blocker" />
      <button className="tut-skip" onClick={skip}>
        Skip tutorial
      </button>
      {callout && (
        <>
          {spot && <div className="tut-spot" style={spot} />}
          <div className={`tut-box tut-${placement}`} style={box} role="dialog" aria-live="polite">
            {arrow && <span className="tut-arrow" style={arrow} />}
            {callout.title && <div className="tut-title">{callout.title}</div>}
            <div className="tut-body">{callout.body}</div>
            <div className="tut-foot">
              <button className="primary tut-gotit" onClick={gotIt}>
                {callout.gotItLabel ?? 'Got it'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
