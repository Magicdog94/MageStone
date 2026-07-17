import { useEffect, useReducer, useRef, type CSSProperties } from 'react';
import { useGame } from '../../store';
import { useNet } from '../../net/useNet';
import { OddsTable } from '../Tutorial';
import { useTutorial, type Placement } from './useTutorial';
import { runTutorial } from './tutorialScript';

const GAP = 14;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// Must match the .tut-box widths in App.css (desktop / ui-mobile) so the
// horizontal clamp + arrow keep the (wider) box fully on screen.
const boxWidth = () =>
  typeof document !== 'undefined' && document.body.classList.contains('ui-mobile') ? 340 : 384;

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

/** Position for the text box + its little arrow, given the anchor rect. The box
 *  must ALWAYS sit fully on screen (its buttons must stay pressable), so bottom/
 *  top placements FLIP when the anchor is too close to that edge, and every
 *  branch clamps against an estimated box height. */
const EST_H = 230;
function layout(rect: Rect | null, placement: Placement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect && placement === 'bottom') {
    // Anchor-less "look at the board" notes: sit LOW, just above the action
    // bar, so the play area being narrated stays fully visible (no spotlight,
    // so nothing is dimmed either).
    return {
      box: { bottom: 110, left: vw / 2, transform: 'translateX(-50%)' } as CSSProperties,
      arrow: null as CSSProperties | null,
    };
  }
  if (!rect || placement === 'center') {
    return {
      box: { top: vh / 2, left: vw / 2, transform: 'translate(-50%, -50%)' } as CSSProperties,
      arrow: null as CSSProperties | null,
    };
  }
  const BOX_W = boxWidth();
  const clampX = (cx: number) => clamp(cx - BOX_W / 2, 8, vw - BOX_W - 8);
  let place = placement;
  // Flip when the requested side lacks room for the whole box.
  if (place === 'bottom' && rect.bottom + GAP + EST_H > vh && rect.top - GAP - EST_H > 0) {
    place = 'top';
  } else if (place === 'top' && rect.top - GAP - EST_H < 0 && rect.bottom + GAP + EST_H < vh) {
    place = 'bottom';
  }
  if (place === 'bottom' || place === 'top') {
    const left = clampX(rect.cx);
    const box: CSSProperties =
      place === 'bottom'
        ? { top: Math.min(rect.bottom + GAP, vh - EST_H - 8), left }
        : // anchored by its bottom edge; cap it so the box top stays >= 8px
          { bottom: Math.min(vh - rect.top + GAP, vh - EST_H - 8), left };
    const arrow: CSSProperties = {
      left: clamp(rect.cx - left, 18, BOX_W - 18),
      [place === 'bottom' ? 'top' : 'bottom']: -8,
    };
    return { box, arrow };
  }
  // left / right — keep the whole box (buttons included) above the fold
  const top = clamp(rect.cy - 40, 8, Math.max(8, vh - EST_H - 8));
  const box: CSSProperties =
    place === 'right' ? { left: rect.right + GAP, top } : { right: vw - rect.left + GAP, top };
  const arrow: CSSProperties = {
    top: clamp(rect.cy - top, 18, 120),
    [place === 'right' ? 'left' : 'right']: -8,
  };
  return { box, arrow };
}

export function TutorialCoach() {
  const tutorial = useGame((s) => s.tutorial);
  const callout = useTutorial((s) => s.history[s.viewIndex] ?? s.callout);
  const live = useTutorial((s) => s.callout);
  const viewIndex = useTutorial((s) => s.viewIndex);
  const gotIt = useTutorial((s) => s.gotIt);
  const goBack = useTutorial((s) => s.back);
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
      {live && callout && (
        <>
          {spot && <div className="tut-spot" style={spot} />}
          <div
            className={`tut-box tut-${placement}${callout.showOdds ? ' tut-wide' : ''}`}
            style={box}
            role="dialog"
            aria-live="polite"
          >
            {arrow && <span className="tut-arrow" style={arrow} />}
            {callout.title && <div className="tut-title">{callout.title}</div>}
            <div className="tut-body">{callout.body}</div>
            {/* the Rule Book's win-% grid, for the combat lesson */}
            {callout.showOdds && (
              <div className="tut-odds">
                <OddsTable />
              </div>
            )}
            <div className="tut-foot">
              <button className="tut-skipbtn" onClick={skip}>
                Skip tutorial
              </button>
              {/* re-read earlier notes; Got it walks forward again to the live one */}
              <button className="tut-skipbtn tut-back" onClick={goBack} disabled={viewIndex === 0}>
                Back
              </button>
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
