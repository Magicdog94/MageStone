// Procedural adventure theme, synthesised with the Web Audio API (no asset, works
// offline). Upbeat and questy in the spirit of a classic RPG main theme — an
// original tune, not a copy: a bright D-major melody over a I–V–vi–IV loop with a
// driving root/fifth bass, rhythmic chord stabs, and a light kick/snare/hat groove.
// Starts on the first user gesture (autoplay is blocked until then) and keeps
// playing across the landing screen and into matches — the graph is a module
// singleton, untied to any component, so screen changes never interrupt it.

import { create } from 'zustand';

const VOL = 0.2; // master volume when unmuted

// ---- tempo / structure ----
const BPM = 116;
const BEAT = 60 / BPM;
const EIGHTH = BEAT / 2;
const STEPS_PER_BAR = 8; // eighth-notes per bar
const BARS = 8; // 8-bar theme (two passes of the 4-chord loop)
const TOTAL_STEPS = STEPS_PER_BAR * BARS;

// I–V–vi–IV in D major (bright, heroic). notes = triad, root = bass root.
const PROG = [
  { notes: [293.66, 369.99, 440.0], root: 73.42 }, // D   (D F# A)
  { notes: [277.18, 329.63, 440.0], root: 110.0 }, // A   (C# E A)
  { notes: [293.66, 369.99, 493.88], root: 61.74 }, // Bm  (D F# B)
  { notes: [293.66, 392.0, 493.88], root: 98.0 }, // G   (D G B)
];

// Lead melody as [freq, durationInEighths] over the full 8 bars (0 = rest).
const D5 = 587.33, E5 = 659.25, Fs5 = 739.99, G5 = 783.99, A5 = 880.0, B5 = 987.77;
const A4 = 440.0, B4 = 493.88, Cs5 = 554.37;
const MELODY: [number, number][] = [
  // Bar 1 (D)
  [D5, 2], [Fs5, 1], [E5, 1], [D5, 2], [A4, 2],
  // Bar 2 (A)
  [Cs5, 2], [E5, 1], [Cs5, 1], [A4, 2], [B4, 2],
  // Bar 3 (Bm)
  [D5, 2], [Fs5, 2], [A5, 2], [Fs5, 2],
  // Bar 4 (G)
  [G5, 2], [Fs5, 1], [E5, 1], [D5, 4],
  // Bar 5 (D)
  [Fs5, 2], [A5, 1], [G5, 1], [Fs5, 2], [E5, 2],
  // Bar 6 (A)
  [E5, 2], [Cs5, 2], [A4, 4],
  // Bar 7 (Bm)
  [B4, 2], [D5, 2], [Fs5, 2], [B5, 2],
  // Bar 8 (G)
  [A5, 2], [G5, 2], [Fs5, 2], [D5, 2],
];
// Expand melody into a per-step trigger map.
const LEAD_AT: ({ freq: number; dur: number } | undefined)[] = [];
{
  let s = 0;
  for (const [freq, dur] of MELODY) {
    LEAD_AT[s] = freq ? { freq, dur } : undefined;
    s += dur;
  }
}

// ---- audio graph (lazily built on first start) ----
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let padFilter: BiquadFilterNode | null = null;
let echo: DelayNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let running = false;
let nextNoteTime = 0;
let step = 0;

function buildGraph() {
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  // Warm lowpass bus for pad/bass.
  padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 1600;
  padFilter.Q.value = 0.4;
  padFilter.connect(master);

  // Feedback delay → shimmer on the lead.
  echo = ctx.createDelay(1.0);
  echo.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.28;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  echo.connect(fb).connect(echo);
  echo.connect(wet).connect(master);

  // White-noise buffer for the hats/snare.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

/** One oscillator voice with an exponential decay envelope. */
function voice(
  freq: number,
  t0: number,
  dur: number,
  opts: { type?: OscillatorType; peak: number; attack?: number; dest?: AudioNode; echo?: boolean },
) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  o.type = opts.type ?? 'triangle';
  o.frequency.value = freq;
  const g = ctx.createGain();
  const a = opts.attack ?? 0.008;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(opts.peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(opts.dest ?? master);
  if (opts.echo && echo) g.connect(echo);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** A filtered noise burst — used for hats and the snare. */
function noise(t0: number, dur: number, opts: { type: BiquadFilterType; freq: number; peak: number }) {
  if (!ctx || !master || !noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = opts.type;
  f.frequency.value = opts.freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/** A punchy kick: pitch-dropping sine. */
function kick(t0: number) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(135, t0);
  o.frequency.exponentialRampToValueAtTime(48, t0 + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.24);
}

function scheduleStep(s: number, t: number) {
  if (!padFilter) return;
  const bar = Math.floor(s / STEPS_PER_BAR);
  const chord = PROG[bar % PROG.length];
  const inBar = s % STEPS_PER_BAR;
  const onBeat = inBar % 2 === 0; // quarter-note beats

  // Bass: root/fifth pulse on every beat for drive.
  if (onBeat) {
    const beatIdx = inBar / 2; // 0..3
    const f = beatIdx % 2 === 0 ? chord.root : chord.root * 1.5;
    voice(f, t, BEAT * 0.9, { type: 'sawtooth', peak: 0.14, dest: padFilter });
  }

  // Chord stabs on beats 1 and 3 (rhythmic harmony).
  if (inBar === 0 || inBar === 4) {
    for (const f of chord.notes) {
      voice(f, t, BEAT * 0.5, { type: 'sawtooth', peak: 0.04, attack: 0.004, dest: padFilter });
    }
  }

  // Drums.
  if (inBar === 0 || inBar === 4) kick(t); // beats 1 & 3
  if (inBar === 2 || inBar === 6) noise(t, 0.14, { type: 'bandpass', freq: 1900, peak: 0.22 }); // backbeat snare
  noise(t, 0.03, { type: 'highpass', freq: 8000, peak: onBeat ? 0.05 : 0.09 }); // hats on every eighth

  // Lead melody, echoed for shimmer.
  const lead = LEAD_AT[s];
  if (lead) {
    voice(lead.freq, t, EIGHTH * lead.dur * 0.96, { type: 'triangle', peak: 0.14, attack: 0.006, echo: true });
  }
}

function loop() {
  if (!ctx) return;
  const AHEAD = 0.2;
  while (nextNoteTime < ctx.currentTime + AHEAD) {
    scheduleStep(step % TOTAL_STEPS, nextNoteTime);
    nextNoteTime += EIGHTH;
    step++;
  }
  window.setTimeout(loop, 60);
}

function rampMaster(to: number) {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
  master.gain.linearRampToValueAtTime(Math.max(to, 0.0001), now + 1.0);
}

function startEngine(muted: boolean) {
  if (running) return;
  if (!ctx) buildGraph();
  void ctx!.resume();
  running = true;
  nextNoteTime = ctx!.currentTime + 0.12;
  step = 0;
  loop();
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
}));
