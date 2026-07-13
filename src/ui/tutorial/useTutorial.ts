import { create } from 'zustand';

export type Placement = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** One coached pop-up: a text box, optionally anchored to (and spotlighting) a
 *  DOM element by CSS selector, with a gold "Got it" button. */
export interface Callout {
  id: string;
  title?: string;
  body: string;
  /** CSS selector of the UI element to spotlight + point an arrow at. */
  anchor?: string;
  placement?: Placement;
  gotItLabel?: string;
  /** Step n of m — shown as a small progress hint. */
  step?: number;
  total?: number;
}

interface TutorialState {
  callout: Callout | null;
  /** Show a callout and resolve when the user presses "Got it". */
  note: (c: Callout) => Promise<void>;
  gotIt: () => void;
  /** Tear down any pending callout (used when the tutorial is skipped/ends). */
  finish: () => void;
}

// Kept outside the store: the resolver for the currently-awaited note.
let resolveGotIt: (() => void) | null = null;

export const useTutorial = create<TutorialState>((set) => ({
  callout: null,
  note: (c) =>
    new Promise<void>((resolve) => {
      resolveGotIt = resolve;
      set({ callout: c });
    }),
  gotIt: () => {
    const r = resolveGotIt;
    resolveGotIt = null;
    set({ callout: null });
    r?.();
  },
  finish: () => {
    const r = resolveGotIt;
    resolveGotIt = null;
    set({ callout: null });
    // Resolve any pending awaiter so the runner unwinds cleanly.
    r?.();
  },
}));

if (import.meta.env.DEV) {
  (window as unknown as { __tut?: typeof useTutorial }).__tut = useTutorial;
}
