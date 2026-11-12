// Every hotseat match that starts gets a Game Results row, finished or not.
//
// A match that ends normally is recorded by useNet (Victory / Defeat / Draw).
// This module covers the rest: a match the player LEAVES before it ends is a
// "Defeat by Rage Quit" for the named player. Leaving means any of:
//  - Main Menu, or starting a New Game, mid-match;
//  - closing the tab or window, reloading, or navigating away (sent with
//    navigator.sendBeacon on `pagehide`, which still gets out as the page dies);
//  - the page dying with no chance to say so (crash, app killed, the beacon
//    lost). Each running match is kept in localStorage as the rage quit it
//    would be; one still there on the next visit is recorded then.
// The result id is the match's id, so a match is stored once whichever of
// these routes reaches the server first, and a later finish can't add another.
//
// The only times the page goes away WITHOUT it counting are the ones the app
// causes itself (the 3D view crash reload, see allowUnload) and the browser
// quietly parking a background tab: that tab comes back into the same match,
// which it then simply carries on recording.
import { useGame } from '../store';
import { gameOver } from '../game/rules';
import { useNet } from './useNet';
import { RESUME_KEY } from './saveKeys';
import {
  addPending,
  buildQuitResult,
  dropLive,
  putLive,
  readHotseatName,
  readLive,
  type HotseatResult,
} from './hotseatResults';

/** Where a result goes when the page is closing and the socket can't be trusted. */
export function beaconUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return `${env.replace(/^ws/, 'http').replace(/\/$/, '')}/api/hotseat-result`;
  if (import.meta.env.DEV) return `http://${location.hostname}:8787/api/hotseat-result`;
  return '/api/hotseat-result';
}

/** A live match that no tab has touched for this long belongs to no one. Only
 *  used where Web Locks (which know for certain) are missing. */
const STALE_MS = 3 * 60 * 1000;
const HEARTBEAT_MS = 20 * 1000;
const LOCK_PREFIX = 'ms-match-';

/** The rage-quit record for the match on screen, or null when no hotseat match
 *  is running (menu, tutorial, online, finished, or nothing to record). */
function currentQuit(): HotseatResult | null {
  const g = useGame.getState();
  if (useNet.getState().screen !== 'game') return null;
  if (!g.started || g.tutorial || g.online || gameOver(g.game)) return null;
  return buildQuitResult(g.game, g.bots, readHotseatName(), g.matchId);
}

type LockApi = {
  request: (name: string, cb: () => Promise<void>) => Promise<unknown>;
  query: () => Promise<{ held?: { name?: string }[] }>;
};
const locks = (): LockApi | null => {
  const l = (navigator as Navigator & { locks?: LockApi }).locks;
  return l && typeof l.request === 'function' && typeof l.query === 'function' ? l : null;
};

/** `onLeftByUnload` runs once a match has been recorded as a rage quit because
 *  the page is going away: the session keeper then stops saving it, so it
 *  isn't restored or offered back as Resume Match. */
export function initMatchRecorder(isUnloadAllowed: () => boolean, onLeftByUnload: () => void): () => void {
  let tracked: HotseatResult | null = null;
  let release: (() => void) | null = null;

  // Hold a Web Lock named after the match while this tab plays it, so another
  // tab opened meanwhile can see the match is still alive and leave it alone.
  const hold = (rid: string) => {
    release?.();
    release = null;
    const l = locks();
    if (!l) return;
    l.request(LOCK_PREFIX + rid, () => new Promise<void>((res) => (release = res))).catch(() => {});
  };
  const stopTracking = () => {
    if (tracked) dropLive(tracked.rid);
    tracked = null;
    release?.();
    release = null;
  };

  const record = (r: HotseatResult) => {
    useNet.getState().sendHotseatResult(r);
  };

  const review = () => {
    const now = currentQuit();
    if (tracked && tracked.rid !== now?.rid) {
      // The tracked match is no longer on screen. Finished matches are recorded
      // by useNet; anything else was left part-way: a rage quit.
      const g = useGame.getState();
      const finished = g.matchId === tracked.rid && gameOver(g.game);
      if (!finished) record(tracked);
      stopTracking();
    }
    if (now) {
      if (!tracked) hold(now.rid);
      tracked = now;
      putLive(now);
    }
  };

  const unGame = useGame.subscribe((s, p) => {
    if (
      s.game !== p.game ||
      s.matchId !== p.matchId ||
      s.started !== p.started ||
      s.tutorial !== p.tutorial ||
      s.online !== p.online
    ) {
      review();
    }
  });
  const unNet = useNet.subscribe((n, p) => {
    if (n.screen !== p.screen) review();
  });

  // Keep the live entry fresh while the match sits idle (only matters where
  // Web Locks are missing).
  const beat = window.setInterval(() => {
    if (tracked) putLive(tracked);
  }, HEARTBEAT_MS);

  // The page is going away: closing, reloading or navigating off. The socket
  // may never flush, so send the rage quit as a beacon, and also queue it to be
  // resent on the next visit (the server ignores the copy). The match is over,
  // so it is not offered back as Resume Match.
  const onPageHide = () => {
    if (!tracked || isUnloadAllowed()) return;
    const r = tracked;
    try {
      navigator.sendBeacon?.(beaconUrl(), JSON.stringify(r));
    } catch {
      /* no beacon — the queued copy goes next visit */
    }
    addPending(r);
    stopTracking();
    onLeftByUnload();
  };
  // Came back from the back/forward cache: the match left on screen was
  // already recorded as a rage quit, so it is done with.
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted && !tracked && currentQuit()) useNet.getState().setScreen('landing');
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  // Matches left behind by a visit that ended without a word: record them now.
  // A match another open tab is still playing (it holds the lock, or without
  // locks, touched it recently) is left alone; checked again in a while.
  const sweep = async () => {
    const live = readLive();
    const rids = Object.keys(live).filter((rid) => rid !== tracked?.rid);
    if (!rids.length) return;
    let held: Set<string> | null = null;
    const l = locks();
    if (l) {
      try {
        const q = await l.query();
        held = new Set((q.held ?? []).map((h) => h.name ?? ''));
      } catch {
        held = null;
      }
    }
    let orphaned = false;
    for (const rid of rids) {
      const entry = live[rid];
      if (rid === tracked?.rid) continue;
      const alive = held ? held.has(LOCK_PREFIX + rid) : Date.now() - (entry?.seen ?? 0) < STALE_MS;
      if (alive) continue;
      if (entry?.result) record(entry.result);
      dropLive(rid);
      orphaned = true;
    }
    if (orphaned) {
      // Its Resume Match save (if any) goes with it: that match is recorded.
      try {
        const snap = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
        if (snap && (!snap.matchId || rids.includes(snap.matchId))) localStorage.removeItem(RESUME_KEY);
      } catch {
        /* storage blocked */
      }
    }
  };

  review(); // a match restored into this tab during boot is live already
  void sweep();
  const sweepTimer = window.setInterval(() => void sweep(), STALE_MS);

  return () => {
    unGame();
    unNet();
    window.clearInterval(beat);
    window.clearInterval(sweepTimer);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    release?.();
    release = null;
  };
}
