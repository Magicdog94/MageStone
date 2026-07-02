// Procedural sound effects, synthesised with the Web Audio API (no assets,
// works offline — same philosophy as music.ts). One lazy AudioContext; every
// effect is a tiny one-shot node graph. `initSfx()` wires the triggers:
// a global button-click listener plus a store subscription that turns game
// events (moves, clashes, dice, sieges, eliminations, victory…) into sound.

import { useGame } from '../store';
import { siegedPlayers } from '../game/rules';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null; // no Web Audio → stay silent
  }
}

function noise(): AudioBuffer {
  const a = ctx!;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Gain node with an exponential attack/decay envelope, connected to master. */
function env(t0: number, peak: number, decay: number, attack = 0.004): GainNode {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(master!);
  return g;
}

/** One oscillator into an envelope; optional pitch glide. */
function tone(
  t0: number,
  type: OscillatorType,
  freq: number,
  peak: number,
  decay: number,
  glideTo?: number,
) {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + decay);
  o.connect(env(t0, peak, decay));
  o.start(t0);
  o.stop(t0 + decay + 0.05);
}

/** A burst of filtered noise (thud/clack/whoosh building block). */
function noiseHit(
  t0: number,
  peak: number,
  decay: number,
  filterType: BiquadFilterType,
  freq: number,
  q = 1,
) {
  const src = ctx!.createBufferSource();
  src.buffer = noise();
  const f = ctx!.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f);
  f.connect(env(t0, peak, decay));
  src.start(t0);
  src.stop(t0 + decay + 0.05);
}

// ---- the effects -----------------------------------------------------------

export const sfx = {
  /** Soft UI tick for buttons (sign in, menus, dice tray…). */
  click() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    tone(t, 'sine', 950, 0.1, 0.05, 500);
    noiseHit(t, 0.03, 0.03, 'highpass', 3000);
  },

  /** A piece sliding then settling — felt-and-wood, like a chess move. */
  move() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    noiseHit(t, 0.09, 0.16, 'lowpass', 420, 0.6); // felt slide
    noiseHit(t + 0.15, 0.12, 0.05, 'bandpass', 900, 2); // wooden settle
    tone(t + 0.15, 'triangle', 190, 0.12, 0.08);
  },

  /** Steel on steel — warriors clash. */
  clash() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    for (const [f, p] of [
      [2480, 0.16],
      [3700, 0.1],
      [5230, 0.07],
    ] as const) {
      tone(t, 'square', f, p, 0.22);
    }
    noiseHit(t, 0.2, 0.09, 'highpass', 2600); // ring of the strike
    tone(t, 'sine', 130, 0.16, 0.12, 60); // weight behind the blow
  },

  /** Arcane bolt — a mage attacks. */
  zap() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    tone(t, 'sawtooth', 1600, 0.14, 0.3, 140); // crackling descent
    tone(t, 'sine', 2400, 0.08, 0.18, 3400); // shimmer up
    noiseHit(t + 0.02, 0.08, 0.2, 'bandpass', 1800, 4);
  },

  /** Dice tumbling across the board. */
  diceRoll() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    for (let i = 0; i < 9; i++) {
      const at = t + i * 0.07 + Math.random() * 0.04;
      noiseHit(at, 0.07 + Math.random() * 0.05, 0.035, 'bandpass', 1100 + Math.random() * 900, 3);
      tone(at, 'triangle', 240 + Math.random() * 160, 0.05, 0.04);
    }
  },

  /** A die pushed off the tray. */
  discard() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    tone(t, 'triangle', 300, 0.09, 0.06, 180);
    noiseHit(t, 0.05, 0.04, 'bandpass', 1400, 2);
  },

  /** Collecting a MageStone — crystal chime. */
  collect() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    for (const [i, f] of [1320, 1760, 2200].entries()) {
      tone(t + i * 0.07, 'sine', f, 0.12, 0.4);
    }
  },

  /** Activating stones — a rising arcane chord. */
  activate() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    for (const [i, f] of [523, 659, 784, 1047].entries()) {
      tone(t + i * 0.09, 'triangle', f, 0.12, 0.5);
      tone(t + i * 0.09, 'sine', f * 2, 0.05, 0.4);
    }
  },

  /** Resurrection — a solemn bell. */
  resurrect() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    for (const [f, p] of [
      [392, 0.16],
      [988, 0.08],
      [1568, 0.045],
    ] as const) {
      tone(t, 'sine', f, p, 1.1);
    }
    tone(t + 0.5, 'sine', 587, 0.08, 0.9);
  },

  /** The ritual begins — a low ominous gong-drone. */
  ritual() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    tone(t, 'sine', 82, 0.22, 1.6, 55);
    tone(t, 'sine', 123, 0.1, 1.3);
    tone(t + 0.05, 'triangle', 164, 0.07, 1.1);
    noiseHit(t, 0.06, 0.9, 'lowpass', 300);
  },

  /** War-horn — a base has come under siege. */
  horn() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    const o = ctx!.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(196, t);
    o.frequency.linearRampToValueAtTime(294, t + 0.55);
    o.frequency.setValueAtTime(294, t + 0.55);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.2);
    g.gain.setValueAtTime(0.16, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    const f = ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    o.connect(f);
    f.connect(g);
    g.connect(master!);
    o.start(t);
    o.stop(t + 1.4);
    tone(t, 'sawtooth', 98, 0.08, 1.1); // octave-under body
  },

  /** A gravestone thunks onto the square. */
  grave() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    tone(t, 'sine', 95, 0.2, 0.22, 45);
    noiseHit(t, 0.12, 0.1, 'lowpass', 350);
  },

  /** A player is eliminated — funeral drum + dark gong. */
  eliminated() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    tone(t, 'sine', 70, 0.28, 0.5, 38);
    noiseHit(t, 0.16, 0.3, 'lowpass', 220);
    tone(t + 0.45, 'sine', 98, 0.14, 1.4, 92);
    tone(t + 0.45, 'sine', 147, 0.06, 1.2);
  },

  /** A Mage or Priest returns to the board. */
  respawn() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    tone(t, 'sine', 660, 0.08, 0.35, 1320);
    tone(t + 0.08, 'sine', 990, 0.06, 0.35, 1980);
  },

  /** Victory fanfare. */
  victory() {
    if (!ac()) return;
    const t = ctx!.currentTime;
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => {
      const at = t + i * 0.14;
      tone(at, 'square', f, 0.07, 0.28);
      tone(at, 'triangle', f, 0.12, 0.3);
    });
    tone(t + notes.length * 0.14, 'triangle', 1319, 0.14, 0.9);
    noiseHit(t + notes.length * 0.14, 0.05, 0.5, 'highpass', 4000);
  },
};

// ---- triggers ---------------------------------------------------------------

/** Wire the world to the speaker: a global button-click tick plus a store
 *  subscription mapping game-state changes to effects. Returns a cleanup fn.
 *  Sounds fire for local, remote and bot actions alike (they all flow through
 *  the same store state). */
export function initSfx(): () => void {
  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.('button')) sfx.click();
  };
  document.addEventListener('click', onClick, true);

  let prev = useGame.getState();
  const unsub = useGame.subscribe((s) => {
    const g = s.game;
    const pg = prev.game;

    // dice: physical roll begins / a die discarded
    if (s.rolling && !prev.rolling) sfx.diceRoll();
    if (g !== pg) {
      const discNow = g.dice.filter((d) => d.discarded).length;
      const discBefore = pg.dice.filter((d) => d.discarded).length;
      if (discNow > discBefore && g.turnPhase !== 'roll') sfx.discard();

      // movement — like a chess piece sliding
      if (g.unitsMovedThisTurn.length > pg.unitsMovedThisTurn.length) sfx.move();

      // combat — steel for warriors, arcana for mages
      if (g.lastCombat && g.lastCombat !== pg.lastCombat) {
        if (g.lastCombat.attackerKind === 'mage') sfx.zap();
        sfx.clash();
      }

      // one-shot events, read from the engine's own log
      if (g.log.length > pg.log.length) {
        for (const line of g.log.slice(pg.log.length)) {
          if (line.includes('collects')) sfx.collect();
          else if (line.includes('activates')) sfx.activate();
          else if (line.includes('resurrects')) sfx.resurrect();
          else if (line.includes('begins the Ritual')) sfx.ritual();
          else if (line.includes('Gravestone marks')) sfx.grave();
          else if (line.includes('is eliminated')) sfx.eliminated();
          else if (line.includes('respawns') || line.includes('returns to the board')) sfx.respawn();
        }
      }

      // a NEW siege → war-horn
      if (g.units !== pg.units) {
        const before = new Set(siegedPlayers(pg));
        if (siegedPlayers(g).some((p) => !before.has(p))) sfx.horn();
      }

      // victory
      if (g.winner && !pg.winner) sfx.victory();
    }
    prev = s;
  });

  return () => {
    document.removeEventListener('click', onClick, true);
    unsub();
  };
}
