// Network layer: a small Zustand store wrapping one WebSocket to the multiplayer
// server. Handles auth, the lobby/room, and bridges live GameState to `useGame`.
import { create } from 'zustand';
import type { GameState, PlayerColor } from '../game/types';
import type { BotLevel } from '../game/bot';
import { createGame } from '../game/setup';
import { acceptState } from '../game/migrate';
import { gameOver } from '../game/rules';
import { useGame } from '../store';
import { GUEST_KEY, RESUME_KEY, RESUME_MAX_AGE_MS, TAB_SAVE_KEY } from './saveKeys';

export type Screen = 'landing' | 'auth' | 'guest' | 'lobby' | 'game';

export interface RoomPlayer {
  username: string;
  color: PlayerColor;
  online: boolean;
  /** Difficulty when this slot is an AI bot, else null. */
  bot: BotLevel | null;
}
export interface Room {
  gameId: string;
  host: string;
  playerCount: number;
  started: boolean;
  /** True for queue-paired ranked 1v1 rooms (ELO on the line). */
  ranked?: boolean;
  /** True when the room was created with a password (invite links then need it). */
  hasPass?: boolean;
  players: RoomPlayer[];
}

/** One account's win/loss record for the main-menu leaderboard. */
export interface LbRow {
  username: string;
  played: number;
  won: number;
  lost: number;
  /** ELO rating (1000–2400) — null until the account has played ranked. */
  elo?: number | null;
  rankedPlayed?: number;
  rankedWon?: number;
  rankedLost?: number;
}

/** One row of the ELO ladder (ranked play only). */
export interface EloRow {
  username: string;
  elo: number;
  rankedPlayed: number;
  rankedWon: number;
  rankedLost: number;
}

// ---- ELO tiers (mirrors the server's 1000–2400 ladder) ----
export type EloTier = 'Bronze' | 'Silver' | 'Gold' | 'Master' | 'Grandmaster';
export function eloTier(elo: number): EloTier {
  if (elo >= 2200) return 'Grandmaster';
  if (elo >= 1900) return 'Master';
  if (elo >= 1600) return 'Gold';
  if (elo >= 1300) return 'Silver';
  return 'Bronze';
}

interface NetState {
  screen: Screen;
  status: 'offline' | 'connecting' | 'online';
  username: string | null;
  /** True when playing account-free (alpha guest) — no stats, no Ranked. */
  guest: boolean;
  /** Room code from an invite link (?join=CODE), joined after name entry. */
  pendingJoin: string | null;
  authMode: 'signin' | 'signup';
  authError: string | null;
  authBusy: boolean;
  room: Room | null;
  myColor: PlayerColor | null;
  joinError: string | null;
  notice: string | null;
  /** Main-menu leaderboard: the top table, ELO ladder, alpha totals, + the
   *  user's own row. */
  leaderboard: {
    top: LbRow[];
    eloTop: EloRow[];
    me: LbRow | null;
    players: number;
    signups: number;
  } | null;
  /** True while waiting in the ranked matchmaking queue. */
  rankedSearching: boolean;
  /** Acks for the alpha feedback + print-and-play signups. */
  feedbackSent: boolean;
  pnpDone: boolean;

  init: () => void;
  fetchLeaderboard: () => void;
  findRanked: () => void;
  cancelRanked: () => void;
  setScreen: (s: Screen) => void;
  goAuth: (mode: 'signin' | 'signup') => void;
  /** Play online without an account: name-only guest session (alpha). */
  guestPlay: (name: string) => void;
  playLocal: () => void;
  playTutorial: () => void;
  /** Put the saved unfinished local match back on the board ("Resume Match").
   *  False when there is no usable save. */
  resumeSaved: () => boolean;
  signup:(username: string, password: string) => void;
  signin: (username: string, password: string) => void;
  signout: () => void;
  createGame: (playerCount: number, password: string) => void;
  joinGame: (gameId: string, password: string) => void;
  addBot: (level: BotLevel) => void;
  removeBot: (color: PlayerColor) => void;
  startGame: () => void;
  leaveRoom: () => void;
  /** Alpha feedback form (3 questions + optional details). */
  sendFeedback: (f: Record<string, string | null>) => void;
  /** Owner-only: all stored feedback submissions, viewable in-app. */
  feedbackRows: FeedbackRow[] | null;
  fetchFeedbackList: () => void;
  /** Print-and-play interest list signup. */
  pnpSignup: (email: string) => void;
  /** Owner-only: the stored print-and-play signup emails, viewable in-app. */
  pnpRows: PnpRow[] | null;
  fetchPnpList: () => void;
}

/** One stored print-and-play signup (owner viewer). */
export interface PnpRow {
  email: string;
  created?: string;
}

/** One stored feedback submission (owner viewer). */
export interface FeedbackRow {
  id?: number;
  created?: string;
  username?: string | null;
  enjoy?: string | null;
  confuse?: string | null;
  change?: string | null;
  duration?: string | null;
  players?: string | null;
  finished?: string | null;
  victory?: string | null;
  bug?: string | null;
  emailed?: boolean;
}

// In dev the WS server runs on its own port (8787); in a production build the
// same server that served this page also hosts the WebSocket (same origin).
const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ||
  (import.meta.env.DEV
    ? `ws://${location.hostname}:8787`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
const TOKEN_KEY = 'magestone.token';

let ws: WebSocket | null = null;
let applyingRemote = false; // guards the broadcast subscription against echo
let rankedStartSent: string | null = null; // ranked room the host already auto-started
let resumingGuest = false; // the next socket should re-present the stored guest token
let listening = false; // page-wake listeners registered (init runs twice under StrictMode)

interface GuestCreds {
  name: string;
  token: string;
}
function readGuest(): GuestCreds | null {
  try {
    const g = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
    return g && typeof g.name === 'string' && typeof g.token === 'string' ? g : null;
  } catch {
    return null;
  }
}

type Settings = ReturnType<typeof useGame.getState>['settings'];
interface LocalSnapshot {
  game?: unknown;
  bots?: Partial<Record<PlayerColor, BotLevel>>;
  playerColors?: PlayerColor[];
  stoneLayoutId?: string;
  settings?: Partial<Settings>;
}

/** Put a saved local match back on the board. False when the save came from an
 *  older build (see migrate.ts) or the game in it is already over. */
function restoreLocal(snap: LocalSnapshot, source: string): boolean {
  const recovered = acceptState(snap.game, source);
  if (!recovered || gameOver(recovered)) return false;
  useGame.setState({
    game: recovered,
    bots: snap.bots ?? {},
    botController: true,
    playerColors: snap.playerColors ?? recovered.players,
    playerCount: recovered.players.length,
    stoneLayoutId: snap.stoneLayoutId ?? 'diamond',
    settings: { ...useGame.getState().settings, ...(snap.settings ?? {}) },
    online: false,
    myColor: null,
    started: true,
    tutorial: false,
    tutRestrict: null,
    modal: null,
    selectedUnitId: null,
    selectedDieId: null,
    undoPoint: null,
    rolling: false,
  });
  return true;
}

/** The unfinished local match on offer as "Resume Match", if it is still usable. */
export function readResume(): { savedAt: number; game: GameState } | null {
  try {
    const snap = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
    if (!snap || snap.kind !== 'local' || typeof snap.savedAt !== 'number') return null;
    if (Date.now() - snap.savedAt > RESUME_MAX_AGE_MS) return null;
    const game = acceptState(snap.game, 'saved match');
    return game && !gameOver(game) ? { savedAt: snap.savedAt, game } : null;
  } catch {
    return null;
  }
}

const sendWs = (msg: unknown) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

// Broadcast every local GameState change during an online match (the acting
// player is the only one who can mutate it, so this stays the source of truth).
useGame.subscribe((state, prev) => {
  if (state.game !== prev.game && state.online && !applyingRemote) {
    sendWs({ t: 'state', state: state.game });
  }
});

export const useNet = create<NetState>((set, get) => {
  let pending: (() => void) | null = null; // run once authed/connected

  // Invite links: once a name exists (guest or account), join the linked room.
  function joinPendingRoom() {
    const code = get().pendingJoin;
    if (!code) return;
    set({ pendingJoin: null });
    sendWs({ t: 'joinGame', gameId: code, password: '' });
  }

  // ---- staying connected ---------------------------------------------------
  // Phones drop (or silently kill) sockets while the page is in the background.
  // Anyone in a room is reconnected, signed back in and put back in their seat;
  // the server resends the match state on rejoin.
  let retry = 0;
  let retryTimer: number | undefined;
  let pingTimer: number | undefined;

  const socketDown = () =>
    !ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED;

  function reconnect() {
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
    const room = get().room;
    if (!room || !socketDown()) return;
    resumingGuest = get().guest;
    set({ pendingJoin: room.gameId, notice: 'Connection lost — reconnecting…' });
    ensureSocket();
  }

  function scheduleReconnect() {
    if (retryTimer !== undefined) return;
    const delay = Math.min(15000, 1000 * 2 ** retry);
    retry += 1;
    retryTimer = window.setTimeout(reconnect, delay);
  }

  /** Back from the background: reconnect a dead socket at once, and check an
   *  apparently open one is really alive (a killed socket can still look open). */
  function wake() {
    if (document.visibilityState !== 'visible' || !get().room) return;
    if (socketDown()) {
      retry = 0;
      reconnect();
      return;
    }
    if (ws?.readyState !== WebSocket.OPEN || pingTimer !== undefined) return;
    const sock = ws;
    sendWs({ t: 'ping' });
    pingTimer = window.setTimeout(() => {
      pingTimer = undefined;
      if (ws !== sock) return;
      // No answer: abandon it and open a fresh connection.
      ws = null;
      try {
        sock.close();
      } catch {
        /* already gone */
      }
      set({ status: 'offline' });
      retry = 0;
      reconnect();
    }, 5000);
  }

  function ensureSocket(onReady?: () => void) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (ws.readyState === WebSocket.OPEN && onReady) onReady();
      else if (onReady) pending = onReady;
      return;
    }
    set({ status: 'connecting' });
    // Free-tier hosting naps between games: if connecting drags past a few
    // seconds, say so instead of leaving players staring at "connecting".
    const wakeTimer = window.setTimeout(() => {
      if (get().status === 'connecting') {
        set({ notice: 'Waking the server — the free alpha host naps when idle. This can take ~30 seconds…' });
      }
    }, 4000);
    const sock = new WebSocket(SERVER_URL);
    ws = sock;
    // Every handler ignores a socket that has since been replaced.
    sock.onopen = () => {
      if (ws !== sock) return;
      window.clearTimeout(wakeTimer);
      retry = 0;
      set({ status: 'online', notice: null });
      // A new socket is a new server session, so sign it back in.
      const token = localStorage.getItem(TOKEN_KEY);
      const guest = resumingGuest ? readGuest() : null;
      resumingGuest = false;
      if (token) sendWs({ t: 'auth', token });
      else if (guest) sendWs({ t: 'guest', name: guest.name, token: guest.token });
      const p = pending;
      pending = null;
      p?.();
      if (onReady) onReady();
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      window.clearTimeout(wakeTimer);
      set({ status: 'offline', rankedSearching: false });
      if (get().room) {
        set({ notice: 'Connection lost — reconnecting…' });
        scheduleReconnect();
      } else if (get().screen !== 'landing') {
        set({ notice: 'Disconnected from server.' });
      }
    };
    sock.onerror = () => {
      if (ws !== sock || get().room) return; // in a room, onclose reconnects
      set({ status: 'offline', notice: 'Cannot reach the game server.' });
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      dispatch(m);
    };
  }

  function dispatch(m: Record<string, unknown>) {
    switch (m.t) {
      case 'authOk': {
        localStorage.setItem(TOKEN_KEY, m.token as string);
        set({ username: m.username as string, guest: false, authError: null, authBusy: false });
        if (get().screen === 'auth' || get().screen === 'landing') set({ screen: 'lobby' });
        joinPendingRoom();
        break;
      }
      case 'guestOk': {
        if (typeof m.token === 'string') {
          try {
            localStorage.setItem(GUEST_KEY, JSON.stringify({ name: m.username, token: m.token }));
          } catch {
            /* storage blocked — this guest just can't be resumed */
          }
        }
        set({
          username: m.username as string,
          guest: true,
          authError: null,
          authBusy: false,
          // a guest reconnecting mid-match stays on the board
          screen: get().screen === 'game' ? 'game' : 'lobby',
        });
        joinPendingRoom();
        break;
      }
      case 'authErr': {
        // A failed token-resume shouldn't strand the user — just drop the token.
        if (!get().username) localStorage.removeItem(TOKEN_KEY);
        set({ authError: m.message as string, authBusy: false });
        break;
      }
      case 'joined': {
        // (a ranked pairing lands here too — the search is over)
        set({ myColor: m.myColor as PlayerColor, joinError: null, rankedSearching: false });
        break;
      }
      case 'lobby': {
        const room = m as unknown as Room;
        set({ room, joinError: null });
        if (get().screen === 'auth' || get().screen === 'lobby') set({ screen: 'lobby' });
        // Ranked rooms auto-start the moment both players are seated: the HOST's
        // client builds the initial state (exactly like pressing Start Game).
        if (
          room.ranked &&
          !room.started &&
          room.host === get().username &&
          room.players.length === room.playerCount &&
          rankedStartSent !== room.gameId
        ) {
          rankedStartSent = room.gameId;
          sendWs({ t: 'startGame', state: createGame(room.playerCount) });
        }
        break;
      }
      case 'joinErr':
        set({ joinError: m.message as string });
        // A rejoin after a dropped connection found the room gone (the server
        // restarted, or everyone was away too long) — stop trying.
        if (get().room && get().screen === 'game') {
          window.clearTimeout(retryTimer);
          retryTimer = undefined;
          set({ room: null, notice: 'That match is no longer on the server.' });
        }
        break;
      case 'pong':
        window.clearTimeout(pingTimer);
        pingTimer = undefined;
        break;
      case 'started': {
        const players = m.players as { username: string; color: PlayerColor; bot?: BotLevel | null }[];
        const me = players.find((p) => p.username === get().username);
        const myColor = me?.color ?? get().myColor ?? 'red';
        // Bot seats + controller: the HOST's client executes bot turns (the
        // engine is client-side; someone must think for them).
        const bots: Partial<Record<PlayerColor, BotLevel>> = {};
        for (const p of players) if (p.bot) bots[p.color] = p.bot;
        const isHost = get().room?.host === get().username;
        applyingRemote = true;
        useGame.getState().startOnline(m.state as GameState, myColor, bots, isHost);
        applyingRemote = false;
        set({ myColor, screen: 'game' });
        break;
      }
      case 'state': {
        applyingRemote = true;
        useGame.setState({ game: m.state as GameState, selectedUnitId: null, selectedDieId: null });
        applyingRemote = false;
        break;
      }
      case 'leaderboard': {
        set({
          leaderboard: {
            top: (m.top as LbRow[]) ?? [],
            eloTop: (m.eloTop as EloRow[]) ?? [],
            me: (m.me as LbRow | null) ?? null,
            players: (m.players as number) ?? 0,
            signups: (m.signups as number) ?? 0,
          },
        });
        break;
      }
      case 'rankedSearching':
        set({ rankedSearching: true });
        break;
      case 'rankedCancelled':
        set({ rankedSearching: false });
        break;
      case 'feedbackOk':
        set({ feedbackSent: true });
        break;
      case 'feedbackList':
        set({ feedbackRows: (m.rows as FeedbackRow[]) ?? [] });
        break;
      case 'pnpList':
        set({ pnpRows: (m.rows as PnpRow[]) ?? [] });
        break;
      case 'pnpOk':
        set({ pnpDone: true });
        break;
      case 'error':
        set({ notice: m.message as string });
        break;
    }
  }

  return {
    screen: 'landing',
    status: 'offline',
    username: null,
    guest: false,
    pendingJoin: null,
    authMode: 'signin',
    authError: null,
    authBusy: false,
    room: null,
    myColor: null,
    joinError: null,
    notice: null,
    leaderboard: null,
    rankedSearching: false,
    feedbackSent: false,
    feedbackRows: null,
    pnpDone: false,
    pnpRows: null,

    init: () => {
      // Page wake-ups: a player returning from another app or window gets their
      // online connection back straight away rather than on the next retry.
      if (!listening) {
        listening = true;
        document.addEventListener('visibilitychange', wake);
        window.addEventListener('pageshow', wake);
        window.addEventListener('online', wake);
      }
      // Bring back the match this tab was playing. Two sources: the crash
      // snapshot SceneBoundary leaves before reloading a dead 3D view, and the
      // session keeper's autosave (the browser reloaded or discarded the tab
      // while the player was elsewhere). A save from an older build is refused
      // by acceptState rather than resumed into a corrupted match.
      try {
        const crash = sessionStorage.getItem('ms-recover');
        if (crash) sessionStorage.removeItem('ms-recover');
        const raw = crash ?? sessionStorage.getItem(TAB_SAVE_KEY);
        if (raw) {
          const snap = JSON.parse(raw);
          const source = crash ? 'crash snapshot' : 'autosave';
          if (snap.kind === 'local' && restoreLocal(snap, source)) {
            set({ screen: 'game' });
            console.warn(`MageStone: match restored from the ${source}.`);
          } else if (snap.kind === 'online' && snap.gameId) {
            // Existing room members rejoin without the password once signed back in.
            set({ pendingJoin: String(snap.gameId), notice: 'Rejoining your match…' });
            if (localStorage.getItem(TOKEN_KEY)) {
              ensureSocket();
            } else if (readGuest()) {
              resumingGuest = true;
              ensureSocket();
            } else {
              set({ screen: 'guest' });
              ensureSocket();
            }
          } else if (!crash) {
            sessionStorage.removeItem(TAB_SAVE_KEY);
          }
        }
      } catch {
        /* corrupt snapshot — fall through to a normal boot */
      }
      // Invite link (?join=CODE): stash the room, strip the URL, and route the
      // visitor to the name screen (signed-in players join right after re-auth).
      try {
        const params = new URLSearchParams(location.search);
        const code = (params.get('join') || '').toUpperCase().trim();
        if (code) {
          set({ pendingJoin: code });
          history.replaceState(null, '', location.pathname);
          if (!localStorage.getItem(TOKEN_KEY)) set({ screen: 'guest' });
          ensureSocket();
        }
      } catch {
        /* URL APIs unavailable — regular flow */
      }
      // Auto-resume a saved session on load (token → server re-auth → lobby).
      if (localStorage.getItem(TOKEN_KEY)) ensureSocket();
    },
    fetchLeaderboard: () => {
      // Public data — connect if needed, then ask (re-auth on connect fills `me`).
      ensureSocket(() => sendWs({ t: 'leaderboard' }));
    },
    findRanked: () => {
      ensureSocket(() => sendWs({ t: 'findRanked' }));
    },
    sendFeedback: (f) => {
      set({ feedbackSent: false });
      ensureSocket(() => sendWs({ t: 'feedback', ...f }));
    },
    fetchFeedbackList: () => {
      ensureSocket(() => sendWs({ t: 'feedbackList' }));
    },
    fetchPnpList: () => {
      ensureSocket(() => sendWs({ t: 'pnpList' }));
    },
    pnpSignup: (email) => {
      set({ pnpDone: false });
      ensureSocket(() => sendWs({ t: 'pnp', email }));
    },
    cancelRanked: () => {
      sendWs({ t: 'cancelRanked' });
      set({ rankedSearching: false });
    },
    setScreen: (screen) => set({ screen }),
    goAuth: (mode) => {
      set({ screen: 'auth', authMode: mode, authError: null });
      ensureSocket();
    },
    guestPlay: (name) => {
      set({ authBusy: true, authError: null });
      ensureSocket(() => sendWs({ t: 'guest', name }));
    },
    playLocal: () => {
      useGame.getState().setLocalMode();
      set({ screen: 'game' });
    },
    playTutorial: () => {
      useGame.getState().startTutorial();
      set({ screen: 'game' });
    },
    resumeSaved: () => {
      let ok = false;
      try {
        if (readResume()) ok = restoreLocal(JSON.parse(localStorage.getItem(RESUME_KEY) || '{}'), 'saved match');
      } catch {
        ok = false;
      }
      if (!ok) {
        try {
          localStorage.removeItem(RESUME_KEY);
        } catch {
          /* storage blocked */
        }
        return false;
      }
      set({ screen: 'game' });
      return true;
    },
    signup: (username, password) => {
      set({ authBusy: true, authError: null });
      ensureSocket(() => sendWs({ t: 'signup', username, password }));
    },
    signin: (username, password) => {
      set({ authBusy: true, authError: null });
      ensureSocket(() => sendWs({ t: 'signin', username, password }));
    },
    signout: () => {
      localStorage.removeItem(TOKEN_KEY);
      sendWs({ t: 'cancelRanked' });
      sendWs({ t: 'leaveGame' });
      set({
        username: null,
        guest: false,
        room: null,
        myColor: null,
        screen: 'landing',
        rankedSearching: false,
      });
    },
    createGame: (playerCount, password) => {
      set({ joinError: null });
      ensureSocket(() => sendWs({ t: 'createGame', playerCount, password }));
    },
    joinGame: (gameId, password) => {
      set({ joinError: null });
      ensureSocket(() => sendWs({ t: 'joinGame', gameId, password }));
    },
    addBot: (level) => sendWs({ t: 'addBot', level }),
    removeBot: (color) => sendWs({ t: 'removeBot', color }),
    startGame: () => {
      const room = get().room;
      if (!room) return;
      // Host builds the authoritative initial state (its player/colour order
      // matches the server's assignment); the server echoes it to everyone.
      const state = createGame(room.playerCount);
      sendWs({ t: 'startGame', state });
    },
    leaveRoom: () => {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      sendWs({ t: 'leaveGame' });
      set({ room: null, myColor: null });
    },
  };
});

// Dev-only: expose the net store so previews/tests can drive screens headlessly.
if (import.meta.env.DEV) {
  (window as unknown as { __net?: typeof useNet }).__net = useNet;
}
