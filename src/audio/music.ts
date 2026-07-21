// Licensed score from John Leonard French's "Ultimate Game Music Collection":
// "Fantasy Title" carries the entry screens and "Moonlit Forest" plays during
// matches. Tracks are decoded into Web-Audio buffers so the in-game loop is
// truly seamless (HTMLAudio mp3 looping has an audible gap at the seam) and
// screen changes crossfade. Playback starts on the first user gesture
// (autoplay is blocked until then); the graph is a module singleton so music
// carries across the landing screen and into matches.

import { create } from 'zustand';

const VOL = 0.3; // master volume when unmuted

const TRACKS = {
  menu: '/audio/menu-theme.mp3', // Fantasy Title — cinematic main-menu theme
  game: '/audio/game-theme.mp3', // Moonlit Forest — calm magical in-game loop
} as const;
export type TrackName = keyof typeof TRACKS;

// Per-track level: the in-game bed sits lower so it stays under the SFX.
const LEVEL: Record<TrackName, number> = { menu: 1, game: 0.75 };

const FADE = 1.6; // seconds of crossfade between tracks

// ---- audio graph (lazily built on first start) ----
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let running = false;
let want: TrackName = 'menu';
let current: { name: TrackName; src: AudioBufferSourceNode; gain: GainNode } | null = null;
const buffers: Partial<Record<TrackName, AudioBuffer>> = {};
const loading: Partial<Record<TrackName, Promise<AudioBuffer | null>>> = {};

function buildGraph() {
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);
}

function load(name: TrackName): Promise<AudioBuffer | null> {
  const cached = buffers[name];
  if (cached) return Promise.resolve(cached);
  let p = loading[name];
  if (!p) {
    // A missing/failed asset resolves null → that track stays silent, no crash.
    p = fetch(TRACKS[name])
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status}`))))
      .then((data) => ctx!.decodeAudioData(data))
      .then((buf) => (buffers[name] = buf))
      .catch(() => null);
    loading[name] = p;
  }
  return p;
}

/** Loop points trimmed past the codec's leading/trailing padding so the loop
 *  restarts on real audio instead of a gap of encoder silence. */
function loopPoints(buf: AudioBuffer): [number, number] {
  const ch = buf.getChannelData(0);
  const TH = 0.001; // ~-60 dB
  let a = 0;
  let b = ch.length - 1;
  while (a < b && Math.abs(ch[a]) < TH) a++;
  while (b > a && Math.abs(ch[b]) < TH) b--;
  return [a / buf.sampleRate, (b + 1) / buf.sampleRate];
}

function ramp(g: GainNode, to: number, dur = FADE) {
  if (!ctx) return;
  const now = ctx.currentTime;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
  g.gain.linearRampToValueAtTime(Math.max(to, 0.0001), now + dur);
}

async function playTrack(name: TrackName) {
  if (!ctx || !master) return;
  if (current?.name === name) return;
  const buf = await load(name);
  // The world may have moved on while the track decoded.
  if (!running || want !== name || current?.name === name) return;
  if (!buf) return;
  if (current) {
    const old = current;
    ramp(old.gain, 0);
    old.src.stop(ctx.currentTime + FADE + 0.1);
    current = null;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const [ls, le] = loopPoints(buf);
  src.loopStart = ls;
  src.loopEnd = le;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  src.connect(gain).connect(master);
  src.start(ctx.currentTime, ls);
  ramp(gain, LEVEL[name]);
  current = { name, src, gain };
}

function rampMaster(to: number) {
  if (master) ramp(master, to, 1.0);
}

function startEngine(muted: boolean) {
  if (running) return;
  if (!ctx) buildGraph();
  void ctx!.resume();
  running = true;
  void playTrack(want);
  // Warm the other track so the menu↔game switch is an instant crossfade.
  void load(want === 'menu' ? 'game' : 'menu');
  rampMaster(muted ? 0 : VOL);
}

function setEngineMuted(muted: boolean) {
  rampMaster(muted ? 0 : VOL);
}

// ---- React-facing store ----
interface MusicState {
  started: boolean;
  muted: boolean;
  /** Begin playback (call from a user gesture). No-op if already started. */
  start: () => void;
  /** Toggle mute; starts the music first if it hasn't begun yet. */
  toggle: () => void;
  /** Route the score: menu theme on entry screens, adventure loop in matches. */
  setScene: (scene: TrackName) => void;
}

export const useMusic = create<MusicState>((set, get) => ({
  started: false,
  muted: false,
  start: () => {
    if (get().started) return;
    startEngine(get().muted);
    set({ started: true });
  },
  toggle: () => {
    const { started, muted } = get();
    if (!started) {
      startEngine(false);
      set({ started: true, muted: false });
      return;
    }
    const next = !muted;
    setEngineMuted(next);
    set({ muted: next });
  },
  setScene: (scene) => {
    want = scene;
    if (running) void playTrack(scene);
  },
}));

// Headless-preview hook (DEV only): inspect what the score is doing.
if (import.meta.env.DEV) {
  (window as unknown as { __music?: unknown }).__music = {
    state: () => ({
      running,
      want,
      playing: current?.name ?? null,
      ctxState: ctx?.state ?? 'none',
      loaded: Object.keys(buffers),
    }),
  };
}
