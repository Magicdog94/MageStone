// Keeps a match alive when the player looks away.
//
// Phones, and browsers that park background tabs to save memory, quietly throw
// a heavy 3D page away while the player is in another app or window. When they
// come back the page loads from scratch at the main menu, and the match looks as
// though the window "closed". This module makes that survivable:
//  - it autosaves the running match (debounced, and at once whenever the page is
//    hidden, frozen or unloading), so a reload of the same tab drops the player
//    straight back into it (restored by `useNet.init`);
//  - it also keeps the last unfinished LOCAL match in localStorage, offered as
//    "Resume Match" on the main menu if the tab or app was closed outright;
//  - while a match is live it asks "Leave site?" before the page is closed or
//    navigated away from.
import { useGame } from '../store';
import { gameOver } from '../game/rules';
import { useNet } from './useNet';
import { RESUME_KEY, TAB_SAVE_KEY } from './saveKeys';

let unloadAllowed = false;

/** Let the next unload through without the "Leave site?" prompt — for reloads
 *  the app starts itself, like crash recovery. */
export function allowUnload(): void {
  unloadAllowed = true;
}

type Live = 'local' | 'online' | null;

/** What a live match needs to come back exactly as it was, or null when nothing
 *  is worth saving (menu, tutorial, a finished game). */
function snapshot(): Record<string, unknown> | null {
  const s = useGame.getState();
  const net = useNet.getState();
  if (net.screen !== 'game' || !s.started || s.tutorial || gameOver(s.game)) return null;
  if (s.online) {
    const gameId = net.room?.gameId;
    return gameId ? { kind: 'online', gameId, savedAt: Date.now() } : null;
  }
  return {
    kind: 'local',
    game: s.game,
    bots: s.bots,
    playerColors: s.playerColors,
    playerCount: s.playerCount,
    stoneLayoutId: s.stoneLayoutId,
    settings: s.settings,
    savedAt: Date.now(),
  };
}

export function initSessionKeeper(): () => void {
  let timer: number | undefined;
  let live: Live = null;

  const flush = () => {
    window.clearTimeout(timer);
    timer = undefined;
    const snap = snapshot();
    if (!snap) return;
    try {
      const json = JSON.stringify(snap);
      sessionStorage.setItem(TAB_SAVE_KEY, json);
      if (snap.kind === 'local') localStorage.setItem(RESUME_KEY, json);
    } catch {
      /* storage full or blocked — this match just can't be recovered */
    }
  };
  const schedule = () => {
    if (timer === undefined) timer = window.setTimeout(flush, 500);
  };

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    flush();
    // No prompt in dev: the puppeteer rigs reload pages constantly.
    if (unloadAllowed || import.meta.env.DEV) return;
    e.preventDefault();
    e.returnValue = '';
  };
  const setLive = (next: Live) => {
    if (next === live) return;
    // Only listen while a match is live — an idle beforeunload listener can
    // stop some browsers keeping the menu in their back/forward cache.
    if (next && !live) window.addEventListener('beforeunload', onBeforeUnload);
    if (!next && live) window.removeEventListener('beforeunload', onBeforeUnload);
    live = next;
  };

  const review = () => {
    const s = useGame.getState();
    const net = useNet.getState();
    const playing = net.screen === 'game' && s.started && !s.tutorial;
    if (playing && !gameOver(s.game)) {
      setLive(s.online ? 'online' : 'local');
      schedule();
      return;
    }
    if (live && (playing || net.screen !== 'game')) {
      // The match ended, or the player chose to leave it: nothing to come back to.
      window.clearTimeout(timer);
      timer = undefined;
      try {
        sessionStorage.removeItem(TAB_SAVE_KEY);
        if (live === 'local') localStorage.removeItem(RESUME_KEY);
      } catch {
        /* storage blocked */
      }
      setLive(null);
    }
  };

  const unGame = useGame.subscribe((s, p) => {
    if (s.game !== p.game || s.started !== p.started || s.tutorial !== p.tutorial || s.online !== p.online) {
      review();
    }
  });
  const unNet = useNet.subscribe((n, p) => {
    if (n.screen !== p.screen || n.room !== p.room) review();
  });

  // A hidden page may never run another timer (or be allowed to wake at all),
  // so save the instant the player looks away.
  const onHide = () => {
    if (live) flush();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onHide();
  };
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('freeze', onHide);
  window.addEventListener('pagehide', onHide);

  review(); // a match restored during boot is live already

  return () => {
    unGame();
    unNet();
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('freeze', onHide);
    window.removeEventListener('pagehide', onHide);
    setLive(null);
  };
}
