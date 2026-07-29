import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { useGame } from '../../store';
import { useNet } from '../../net/useNet';
import { OddsTable } from '../Tutorial';
import { useTutorial, type Placement } from './useTutorial';
import { runTutorial } from './tutorialScript';

const GAP = 14;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isMobile = () =>
  typeof document !== 'undefined' && document.body.classList.contains('ui-mobile');
// Must match the .tut-box widths in App.css (desktop / ui-mobile / dock /
// odds-wide) so the horizontal clamp + arrow keep the box fully on screen.
const boxWidth = (wide: boolean) => {
  if (wide) return Math.min(420, window.innerWidth - 16);
  return isMobile() ? 340 : 384;
};

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

/** Estimated box height until the mounted box has been measured for real. */
const estH = () => (isMobile() ? 200 : 230);

// Module-level render caches (there is ONE coach): the coach re-renders every
// 100ms by design and measures the DOM as it renders — these hold the last
// good measurements per callout id between those passes.
/** Real height of the mounted box (est until measured). */
let lastHeight: { id: string; h: number } | null = null;
/** Last good anchor rect — anchors like the combat-roll announcement can
 *  unmount mid-read; the box must not teleport away while it's being read. */
let lastRect: { id: string; r: Rect } | null = null;

interface Placed {
  box: CSSProperties;
  arrow: CSSProperties | null;
  /** The placement actually used after flips/docking — drives the arrow class. */
  place: Placement | 'dock';
}

/**
 * Position for the text box + its little arrow, given the anchor rect. The box
 * must ALWAYS sit fully on screen (its buttons must stay pressable), so bottom/
 * top placements FLIP when the anchor is too close to that edge, left/right
 * placements flip to the roomier side, and every branch clamps against the
 * (measured) box height.
 *
 * DOCKING: on phones the landscape viewport is short — a centred box sits ON
 * the board. Anchor-less boxes therefore dock to the LEFT band (free space:
 * the top is score cards, the bottom is the action bar, the board fills the
 * centre), and anchored boxes that fit on neither side dock too.
 */
function layout(rect: Rect | null, placement: Placement, wide: boolean, boxH: number): Placed {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dock = (): Placed => ({
    box: { left: 8, top: clamp(vh / 2 - boxH / 2, 8, Math.max(8, vh - boxH - 8)) },
    arrow: null,
    place: 'dock',
  });
  if (!rect) {
    // Anchor-less notes narrate (or task) the BOARD — on phones dock left so
    // the play area stays fully visible. (Odds-table notes stay centred: they
    // are pure reading and need the width.)
    if (isMobile() && !wide) return dock();
    if (placement === 'bottom') {
      // "watch the board" notes: sit LOW, just above the action bar
      return {
        box: { bottom: 110, left: vw / 2, transform: 'translateX(-50%)' },
        arrow: null,
        place: 'bottom',
      };
    }
    if (placement === 'top') {
      // ...or HIGH, for lessons happening on the NEAR (bottom) board rows —
      // sieges are laid on the far player's base at the bottom of the screen
      return {
        box: { top: 100, left: vw / 2, transform: 'translateX(-50%)' },
        arrow: null,
        place: 'top',
      };
    }
    return {
      box: { top: vh / 2, left: vw / 2, transform: 'translate(-50%, -50%)' },
      arrow: null,
      place: 'center',
    };
  }
  if (placement === 'center') {
    return {
      box: { top: vh / 2, left: vw / 2, transform: 'translate(-50%, -50%)' },
      arrow: null,
      place: 'center',
    };
  }
  const BOX_W = boxWidth(wide);
  const clampX = (cx: number) => clamp(cx - BOX_W / 2, 8, Math.max(8, vw - BOX_W - 8));
  let place = placement;
  // Flip when the requested side lacks room for the whole box.
  if (place === 'bottom' && rect.bottom + GAP + boxH > vh && rect.top - GAP - boxH > 0) {
    place = 'top';
  } else if (place === 'top' && rect.top - GAP - boxH < 0 && rect.bottom + GAP + boxH < vh) {
    place = 'bottom';
  }
  if (place === 'bottom' || place === 'top') {
    const left = clampX(rect.cx);
    const box: CSSProperties =
      place === 'bottom'
        ? { top: Math.min(rect.bottom + GAP, vh - boxH - 8), left }
        : // anchored by its bottom edge; cap it so the box top stays >= 8px
          { bottom: Math.min(vh - rect.top + GAP, vh - boxH - 8), left };
    const arrow: CSSProperties = {
      left: clamp(rect.cx - left, 18, BOX_W - 18),
      [place === 'bottom' ? 'top' : 'bottom']: -8,
    };
    return { box, arrow, place };
  }
  // left / right — flip to the roomier side when the asked one can't fit the
  // box; if NEITHER side fits (a phone + a wide centred anchor like the
  // winner panel), dock instead of running off the screen edge.
  const roomL = rect.left - GAP - 8;
  const roomR = vw - rect.right - GAP - 8;
  if (place === 'left' && roomL < BOX_W && roomR > roomL) place = 'right';
  else if (place === 'right' && roomR < BOX_W && roomL > roomR) place = 'left';
  if ((place === 'left' ? roomL : roomR) < BOX_W) return dock();
  const top = clamp(rect.cy - 40, 8, Math.max(8, vh - boxH - 8));
  const box: CSSProperties =
    place === 'right' ? { left: rect.right + GAP, top } : { right: vw - rect.left + GAP, top };
  const arrow: CSSProperties = {
    top: clamp(rect.cy - top, 18, 120),
    [place === 'right' ? 'left' : 'right']: -8,
  };
  return { box, arrow, place };
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
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** Two-tap skip: a stray tap must not throw away a 46-step run. */
  const [skipArmed, setSkipArmed] = useState(false);
  const skipTimer = useRef(0);

  // Start (and later tear down) the guided runner when tutorial mode toggles.
  useEffect(() => {
    if (tutorial && !started.current) {
      started.current = true;
      runTutorial(() => {
        // Only navigate when the RUNNER is ending the session (skip already
        // navigated itself; an external cancel — e.g. New Game flipping
        // `tutorial` off — must NOT yank the player back to the landing page).
        const wasTutorial = useGame.getState().tutorial;
        useGame.setState({ tutorial: false });
        useTutorial.getState().finish();
        if (wasTutorial) useNet.getState().setScreen('landing');
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

  // The DISPLAYED callout is the live task (not a Back-review) → the game is
  // playable: the blocker lets clicks through and the footer says "your move".
  const liveTask = !!live && live.mode === 'task' && callout === live;

  // While a READING note is up the touch arrow pad is dead weight (the blocker
  // eats its presses anyway) — hide it so it can't overlap the box. Tasks keep
  // it: panning helps the player line up their move.
  const noteUp = !!(tutorial && live && callout && !liveTask);
  useEffect(() => {
    document.body.classList.toggle('tut-note-up', noteUp);
    return () => document.body.classList.remove('tut-note-up');
  }, [noteUp]);

  // Record the mounted box's real height + the anchor's last good rect for
  // the layout pass (the 100ms tick makes this a measure-then-correct loop;
  // the first paint uses the estimate / a fresh measurement).
  useEffect(() => {
    if (boxRef.current && callout) {
      lastHeight = { id: callout.id, h: boxRef.current.offsetHeight };
    }
    if (callout?.anchor) {
      const r = measure(callout.anchor);
      if (r) lastRect = { id: callout.id, r };
    }
  });

  if (!tutorial) return null;

  const skip = () => {
    useGame.setState({ tutorial: false });
    useTutorial.getState().finish();
    useNet.getState().setScreen('landing');
  };
  const anchor = callout?.anchor;
  let rect = anchor ? measure(anchor) : null; // fresh measurement each render
  if (!rect && anchor && callout && lastRect?.id === callout.id) {
    rect = lastRect.r; // anchor vanished mid-read — hold the last spot
  }
  const placement = callout?.placement ?? 'center';
  const wide = !!callout?.showOdds;
  const boxH = callout && lastHeight?.id === callout.id ? lastHeight.h : estH();
  const { box, arrow, place } = layout(rect, placement, wide, boxH);
  const spot = rect
    ? ({ top: rect.top - 6, left: rect.left - 6, width: rect.right - rect.left + 12, height: rect.bottom - rect.top + 12 } as CSSProperties)
    : null;

  return (
    <div className="tut-root">
      {/* full-screen click blocker so the guided game isn't disturbed — except
          during a live TASK, when the player is the one playing */}
      <div className="tut-blocker" style={liveTask ? { pointerEvents: 'none' } : undefined} />
      {live && callout && (
        <>
          {spot && <div className="tut-spot" style={spot} />}
          <div
            ref={boxRef}
            className={`tut-box tut-${place}${wide ? ' tut-wide' : ''}${liveTask ? ' tut-task' : ''}`}
            style={box}
            role="dialog"
            aria-live="polite"
            data-tut-id={callout.id}
          >
            {arrow && <span className="tut-arrow" style={arrow} />}
            {callout.step && callout.total && (
              <div className="tut-progress">
                {callout.step} / {callout.total}
              </div>
            )}
            {callout.title && <div className="tut-title">{callout.title}</div>}
            <div className="tut-body">{callout.body}</div>
            {/* the Rule Book's win-% grid, for the combat lesson */}
            {callout.showOdds && (
              <div className="tut-odds">
                <OddsTable />
              </div>
            )}
            <div className="tut-foot">
              <button
                className={`tut-skipbtn${skipArmed ? ' tut-skiparmed' : ''}`}
                onClick={() => {
                  if (skipArmed) {
                    skip();
                    return;
                  }
                  setSkipArmed(true);
                  window.clearTimeout(skipTimer.current);
                  skipTimer.current = window.setTimeout(() => setSkipArmed(false), 2500);
                }}
              >
                {skipArmed ? 'Really skip?' : 'Skip tutorial'}
              </button>
              {/* re-read earlier notes; Got it walks forward again to the live one */}
              <button className="tut-skipbtn tut-back" onClick={goBack} disabled={viewIndex === 0}>
                Back
              </button>
              {liveTask ? (
                <span className="tut-yourmove">Your move…</span>
              ) : (
                <button className="primary tut-gotit" onClick={gotIt}>
                  {callout.gotItLabel ?? 'Got it'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
