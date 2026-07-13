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
  /** Render the win-% odds grid (the Rule Book table) under the note text. */
  showOdds?: boolean;
  /** Step n of m — shown as a small progress hint. */
  step?: number;
  total?: number;
}

interface TutorialState {
  /** The LIVE callout the script is awaiting (null between notes). */
  callout: Callout | null;
  /** Every note shown so far this run — the live one last. Lets Back re-read. */
  history: Callout[];
  /** Which history entry is displayed (Back rewinds it; Got it advances). */
  viewIndex: number;
  /** Show a callout and resolve when the user presses "Got it" on it. */
  note: (c: Callout) => Promise<void>;
  gotIt: () => void;
  back: () => void;
  /** Tear down any pending callout (used when the tutorial is skipped/ends). */
  finish: () => void;
}

// Kept outside the store: the resolver for the currently-awaited note.
let resolveGotIt: (() => void) | null = null;

export const useTutorial = create<TutorialState>((set, get) => ({
  callout: null,
  history: [],
  viewIndex: 0,
  note: (c) =>
    new Promise<void>((resolve) => {
      resolveGotIt = resolve;
      set((s) => ({ callout: c, history: [...s.history, c], viewIndex: s.history.length }));
    }),
  gotIt: () => {
    const { viewIndex, history } = get();
    // Reviewing an earlier note — step forward through history, don't resolve.
    if (viewIndex < history.length - 1) {
      set({ viewIndex: viewIndex + 1 });
      return;
    }
    const r = resolveGotIt;
    resolveGotIt = null;
    set({ callout: null });
    r?.();
  },
  back: () => set((s) => ({ viewIndex: Math.max(0, s.viewIndex - 1) })),
  finish: () => {
    const r = resolveGotIt;
    resolveGotIt = null;
    set({ callout: null, history: [], viewIndex: 0 });
    // Resolve any pending awaiter so the runner unwinds cleanly.
    r?.();
  },
}));

if (import.meta.env.DEV) {
  (window as unknown as { __tut?: typeof useTutorial }).__tut = useTutorial;
}
