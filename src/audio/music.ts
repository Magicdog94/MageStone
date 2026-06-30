// Procedural "medieval folklore" score, synthesised with the Web Audio API (no
// asset, works offline). An original tune in the style of medieval folk — a D
// Dorian melody over a droning bagpipe/hurdy-gurdy fifth, soft lute-pluck
// harmony and a frame-drum lilt in 6/8. Not a copy of any track. Starts on the
// first user gesture (autoplay is blocked until then) and keeps playing across
// the landing screen and into matches — the graph is a module singleton.

import { create } from 'zustand';

const VOL = 0.2; // master volume when unmuted

// ---- tempo / structure (lively 6/8 jig) ----
const EIGHTH = 0.21; // seconds per eighth-note (faster = merrier)
const STEPS_PER_BAR = 6; // 6 eighths → two dotted-quarter pulses
const BARS = 8;
const TOTAL_STEPS = STEPS_PER_BAR * BARS;

// Bright D major (D E F# G A B C#). Drone on D + its fifth A — the bagpipe bourdon.
const D2 = 73.42, A2 = 110.0;
const D4 = 293.66, Fs4 = 369.99, G4 = 392.0, A4 = 440.0, B4 = 493.88;
const Cs5 = 554.37, D5 = 587.33, E5 = 659.25, Fs5 = 739.99, G5 = 783.99, A5 = 880.0;

// Joyful major pad: D (I) and G (IV), alternating each pair of bars.
const DCH = [D4, Fs4, A4];
const GCH = [G4, B4, D5];

// Lead melody as [freq, durationInEighths] over the 8-bar phrase (0 = rest).
const MELODY: [number, number][] = [
  // Bar 1
  [A4, 1], [D5, 1], [Fs5, 1], [A5, 1], [Fs5, 1], [D5, 1],
  // Bar 2
  [E5, 1], [Fs5, 1], [G5, 1], [Fs5, 1], [E5, 1], [D5, 1],
  // Bar 3
  [Fs5, 1], [A5, 1], [Fs5, 1], [E5, 1], [D5, 1], [E5, 1],
  // Bar 4
  [D5, 3], [A4, 3],
  // Bar 5
  [B4, 1], [D5, 1], [Fs5, 1], [G5, 1], [Fs5, 1], [E5, 1],
  // Bar 6
  [Fs5, 2], [D5, 1], [A4, 2], [D5, 1],
  // Bar 7
  [G4, 1], [A4, 1], [B4, 1], [Cs5, 1], [D5, 1], [E5, 1],
  // Bar 8
  [Fs5, 3], [D5, 3],
];
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
let reedFilter: BiquadFilterNode | null = null;
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

  // Reedy lowpass bus for drone + pad (bagpipe/hurdy-gurdy timbre).
  reedFilter = ctx.createBiquadFilter();
  reedFilter.type = 'lowpass';
  reedFilter.frequency.value = 1900;
  reedFilter.Q.value = 0.6;
  reedFilter.connect(master);

  // Light echo for the lute lead.
  echo = ctx.createDelay(1.0);
  echo.delayTime.value = EIGHTH * 1.5;
  const fb = ctx.createGain();
  fb.gain.value = 0.26;
  const wet = ctx.createGain();
  wet.gain.value = 0.2;
  echo.connect(fb).connect(echo);
  echo.connect(wet).connect(master);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

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

/** A soft frame-drum thud. */
function drum(t0: number, peak: number) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t0);
  o.frequency.exponentialRampToValueAtTime(55, t0 + 0.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.26);
}

function scheduleStep(s: number, t: number) {
  if (!reedFilter) return;
  const bar = Math.floor(s / STEPS_PER_BAR);
  const inBar = s % STEPS_PER_BAR;

  if (inBar === 0) {
    // droning bourdon (D + fifth A) under the whole bar
    voice(D2, t, EIGHTH * 6.4, { type: 'sawtooth', peak: 0.07, attack: 0.25, dest: reedFilter });
    voice(A2, t, EIGHTH * 6.4, { type: 'sawtooth', peak: 0.05, attack: 0.25, dest: reedFilter });
    // soft lute-pluck chord
    const chord = bar % 4 < 2 ? DCH : GCH;
    for (const f of chord) voice(f, t, EIGHTH * 2.2, { type: 'triangle', peak: 0.032, attack: 0.01, dest: reedFilter });
  }

  // frame-drum on the two dotted-quarter pulses; tambourine on the offbeats
  if (inBar === 0) drum(t, 0.32);
  if (inBar === 3) drum(t, 0.24);
  if (inBar === 1 || inBar === 2 || inBar === 4 || inBar === 5)
    noise(t, 0.05, { type: 'highpass', freq: 6500, peak: inBar === 4 ? 0.07 : 0.045 });

  // lute lead, lightly echoed, with a soft octave sparkle for a merry ring
  const lead = LEAD_AT[s];
  if (lead) {
    voice(lead.freq, t, EIGHTH * lead.dur * 0.95, { type: 'triangle', peak: 0.13, attack: 0.006, echo: true });
    voice(lead.freq * 2, t, EIGHTH * lead.dur * 0.6, { type: 'triangle', peak: 0.03, attack: 0.004, echo: true });
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
