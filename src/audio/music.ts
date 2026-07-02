// Procedural "magical adventure" score, synthesised with the Web Audio API (no
// asset, works offline). An original piece: shimmering harp arpeggios over
// warm string-pad chords (with a lydian sparkle), a soaring soft lead, bell
// accents on the bar lines and a gentle heartbeat pulse. Not a copy of any
// track. Starts on the first user gesture (autoplay is blocked until then) and
// keeps playing across the landing screen and into matches — the graph is a
// module singleton.

import { create } from 'zustand';

const VOL = 0.2; // master volume when unmuted

// ---- tempo / structure (flowing 4/4, ~100 BPM) ----
const EIGHTH = 0.3; // seconds per eighth-note
const STEPS_PER_BAR = 8; // 4/4 in eighths
const BARS = 8;
const TOTAL_STEPS = STEPS_PER_BAR * BARS;

// C major with a lydian glint. Note bank.
const C2 = 65.41, G2 = 98.0, A2 = 110.0, F2 = 87.31;
const C4 = 261.63, E4 = 329.63, F4 = 349.23, G4 = 392.0, A4 = 440.0, B4 = 493.88, D4 = 293.66;
const E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.0, B5 = 987.77;
const C6 = 1046.5, D6 = 1174.66;

// 8-bar progression: C — G — Am — F — C — F — G — C (bass root + chord tones).
const PROG: { bass: number; chord: number[] }[] = [
  { bass: C2, chord: [C4, E4, G4] },
  { bass: G2, chord: [G4, B4, D4 * 2] },
  { bass: A2, chord: [A4, C4 * 2, E4 * 2] },
  { bass: F2, chord: [F4, A4, C4 * 2] },
  { bass: C2, chord: [C4, E4, G4] },
  { bass: F2, chord: [F4, A4, C4 * 2] },
  { bass: G2, chord: [G4, B4, D4 * 2] },
  { bass: C2, chord: [C4, E4, G4] },
];
// Harp arpeggio order over the six chord tones (two octaves).
const ARP_SEQ = [0, 1, 2, 3, 4, 5, 4, 2];

// Soaring lead as [freq, durationInEighths] over the 8-bar phrase (0 = rest).
// The B5 over F (bar 4/6) is the lydian #4 — the "magic" note.
const MELODY: [number, number][] = [
  // Bar 1 (C)
  [E5, 2], [G5, 2], [C6, 3], [B5, 1],
  // Bar 2 (G)
  [A5, 2], [G5, 2], [E5, 4],
  // Bar 3 (Am)
  [F5, 2], [A5, 2], [D6, 3], [C6, 1],
  // Bar 4 (F — lydian sparkle)
  [B5, 2], [G5, 2], [E5, 4],
  // Bar 5 (C)
  [E5, 1], [G5, 1], [B5, 1], [C6, 1], [D6, 2], [C6, 2],
  // Bar 6 (F)
  [A5, 2], [C6, 2], [F5, 4],
  // Bar 7 (G)
  [G5, 2], [A5, 1], [B5, 1], [D6, 2], [B5, 2],
  // Bar 8 (C — home)
  [C6, 6], [G5, 2],
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

/** A soft heartbeat thud. */
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
  const { bass, chord } = PROG[bar % PROG.length];

  if (inBar === 0) {
    // warm string pad: detuned saws on root + fifth, swelling under the bar
    voice(bass, t, EIGHTH * 8.4, { type: 'sawtooth', peak: 0.05, attack: 0.5, dest: reedFilter });
    voice(bass * 1.005, t, EIGHTH * 8.4, { type: 'sawtooth', peak: 0.04, attack: 0.5, dest: reedFilter });
    voice(bass * 3, t, EIGHTH * 8.4, { type: 'sawtooth', peak: 0.022, attack: 0.6, dest: reedFilter });
    // bell accent on alternate bars — a distant glockenspiel
    if (bar % 2 === 0) {
      voice(chord[2] * 4, t, EIGHTH * 5, { type: 'sine', peak: 0.045, attack: 0.004, echo: true });
    }
  }

  // gentle heartbeat: soft low pulse on beats 1 and 3
  if (inBar === 0) drum(t, 0.2);
  if (inBar === 4) drum(t, 0.13);

  // harp arpeggio: chord tones over two octaves, rippling every eighth, with a
  // faint high sparkle so it glitters
  const tones = [...chord, ...chord.map((f) => f * 2)];
  const arpFreq = tones[ARP_SEQ[inBar]];
  voice(arpFreq, t, EIGHTH * 1.9, { type: 'triangle', peak: 0.05, attack: 0.004, echo: true });
  if (inBar % 2 === 0) voice(arpFreq * 2, t, EIGHTH * 1.1, { type: 'sine', peak: 0.014, attack: 0.003, echo: true });

  // soaring lead: soft sine+triangle blend an octave apart, lightly echoed
  const lead = LEAD_AT[s];
  if (lead) {
    voice(lead.freq, t, EIGHTH * lead.dur * 0.95, { type: 'sine', peak: 0.1, attack: 0.02, echo: true });
    voice(lead.freq, t, EIGHTH * lead.dur * 0.9, { type: 'triangle', peak: 0.05, attack: 0.015, echo: true });
    voice(lead.freq / 2, t, EIGHTH * lead.dur * 0.8, { type: 'sine', peak: 0.02, attack: 0.02 });
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
