// Network layer: a small Zustand store wrapping one WebSocket to the multiplayer
// server. Handles auth, the lobby/room, and bridges live GameState to `useGame`.
import { create } from 'zustand';
import type { GameState, PlayerColor } from '../game/types';
import { createGame } from '../game/setup';
import { useGame } from '../store';

export type Screen = 'landing' | 'auth' | 'lobby' | 'game';

export interface RoomPlayer {
  username: string;
  color: PlayerColor;
  online: boolean;
}
export interface Room {
  gameId: string;
  host: string;
  playerCount: number;
  started: boolean;
  players: RoomPlayer[];
}

interface NetState {
  screen: Screen;
  status: 'offline' | 'connecting' | 'online';
  username: string | null;
  authMode: 'signin' | 'signup';
  authError: string | null;
  authBusy: boolean;
  room: Room | null;
  myColor: PlayerColor | null;
  joinError: string | null;
  notice: string | null;

  init: () => void;
  setScreen: (s: Screen) => void;
  goAuth: (mode: 'signin' | 'signup') => void;
  playLocal: () => void;
  signup: (username: string, password: string) => void;
  signin: (username: string, password: string) => void;
  signout: () => void;
  createGame: (playerCount: number, password: string) => void;
  joinGame: (gameId: string, password: string) => void;
  startGame: () => void;
  leaveRoom: () => void;
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

  function ensureSocket(onReady?: () => void) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (ws.readyState === WebSocket.OPEN && onReady) onReady();
      else if (onReady) pending = onReady;
      return;
    }
    set({ status: 'connecting' });
    ws = new WebSocket(SERVER_URL);
    ws.onopen = () => {
      set({ status: 'online', notice: null });
      const token = localStorage.getItem(TOKEN_KEY);
      if (token && !get().username) sendWs({ t: 'auth', token });
      const p = pending;
      pending = null;
      p?.();
      if (onReady) onReady();
    };
    ws.onclose = () => {
      set({ status: 'offline' });
      if (get().screen !== 'landing') set({ notice: 'Disconnected from server.' });
    };
    ws.onerror = () => set({ status: 'offline', notice: 'Cannot reach the game server.' });
    ws.onmessage = (ev) => {
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
        set({ username: m.username as string, authError: null, authBusy: false });
        if (get().screen === 'auth' || get().screen === 'landing') set({ screen: 'lobby' });
        break;
      }
      case 'authErr': {
        // A failed token-resume shouldn't strand the user — just drop the token.
        if (!get().username) localStorage.removeItem(TOKEN_KEY);
        set({ authError: m.message as string, authBusy: false });
        break;
      }
      case 'joined': {
        set({ myColor: m.myColor as PlayerColor, joinError: null });
        break;
      }
      case 'lobby': {
        const room = m as unknown as Room;
        set({ room, joinError: null });
        if (get().screen === 'auth' || get().screen === 'lobby') set({ screen: 'lobby' });
        break;
      }
      case 'joinErr':
        set({ joinError: m.message as string });
        break;
      case 'started': {
        const players = m.players as { username: string; color: PlayerColor }[];
        const me = players.find((p) => p.username === get().username);
        const myColor = me?.color ?? get().myColor ?? 'red';
        applyingRemote = true;
        useGame.getState().startOnline(m.state as GameState, myColor);
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
      case 'error':
        set({ notice: m.message as string });
        break;
    }
  }

  return {
    screen: 'landing',
    status: 'offline',
    username: null,
    authMode: 'signin',
    authError: null,
    authBusy: false,
    room: null,
    myColor: null,
    joinError: null,
    notice: null,

    init: () => {
      // Auto-resume a saved session on load (token → server re-auth → lobby).
      if (localStorage.getItem(TOKEN_KEY)) ensureSocket();
    },
    setScreen: (screen) => set({ screen }),
    goAuth: (mode) => {
      set({ screen: 'auth', authMode: mode, authError: null });
      ensureSocket();
    },
    playLocal: () => {
      useGame.getState().setLocalMode();
      set({ screen: 'game' });
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
      sendWs({ t: 'leaveGame' });
      set({ username: null, room: null, myColor: null, screen: 'landing' });
    },
    createGame: (playerCount, password) => {
      set({ joinError: null });
      ensureSocket(() => sendWs({ t: 'createGame', playerCount, password }));
    },
    joinGame: (gameId, password) => {
      set({ joinError: null });
      ensureSocket(() => sendWs({ t: 'joinGame', gameId, password }));
    },
    startGame: () => {
      const room = get().room;
      if (!room) return;
      // Host builds the authoritative initial state (its player/colour order
      // matches the server's assignment); the server echoes it to everyone.
      const state = createGame(room.playerCount);
      sendWs({ t: 'startGame', state });
    },
    leaveRoom: () => {
      sendWs({ t: 'leaveGame' });
      set({ room: null, myColor: null });
    },
  };
});
