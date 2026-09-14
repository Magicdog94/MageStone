// Storage keys for keeping a match alive across reloads. Kept import-free so
// both the network store and the session keeper can share them without a cycle.

/** sessionStorage: the live match in THIS tab. Restored automatically when the
 *  browser reloads or discards the tab while the player was in another window. */
export const TAB_SAVE_KEY = 'ms-autosave';

/** localStorage: the last unfinished LOCAL match, offered as "Resume Match" on
 *  the main menu after the tab, browser or home-screen app was closed outright. */
export const RESUME_KEY = 'ms-resume';

/** localStorage: an online guest's name + resume token, so a guest can retake
 *  their own seat after a dropped connection or a reload. */
export const GUEST_KEY = 'ms-guest';

/** How long an unfinished local match stays on offer as "Resume Match". */
export const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
