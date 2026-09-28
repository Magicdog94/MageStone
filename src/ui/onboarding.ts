// Which first-run notices this browser has already been through. Kept apart
// from the components that show them so both can read it (and so the
// component files stay fast-refresh friendly).

export const ALPHA_WELCOME_KEY = 'ms-alpha-welcome';
export const QUICK_START_KEY = 'ms-quickstart';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Mark a notice as seen. Storage can be unavailable (private mode, blocked
 *  site data) — then the notice simply offers itself again next time. */
export function markSeen(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* nothing to do */
  }
}

export const alphaWelcomeSeen = (): boolean => read(ALPHA_WELCOME_KEY) === '1';
export const quickStartSeen = (): boolean => read(QUICK_START_KEY) === '1';
