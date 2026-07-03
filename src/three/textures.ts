import * as THREE from 'three';

// Procedural canvas textures so the board needs no external image assets.
// Each generator is memoised — the textures are shared across all tiles.

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

const cache = new Map<string, THREE.Texture>();

function finish(c: HTMLCanvasElement, key: string, repeat = false): THREE.Texture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cache.set(key, tex);
  return tex;
}

// ---- Shared gold-inlay helpers (cover-art motifs) -------------------------

const INLAY_LIGHT = '#f6e4ab';
const INLAY_MID = '#cfa64e';
const INLAY_DARK = '#8a6a22';

/** The standard three-stop gilt gradient used by every inlay motif. */
function goldGradient(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, INLAY_LIGHT);
  g.addColorStop(0.5, INLAY_MID);
  g.addColorStop(1, INLAY_DARK);
  return g;
}

/** A short angular rune glyph centred on (x,y): a vertical spine crossed by a
 *  few random strokes — reads as arcane script at a distance. */
function runeGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  const n = 2 + ((Math.random() * 3) | 0);
  for (let k = 0; k < n; k++) {
    ctx.moveTo((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    ctx.lineTo((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }
  ctx.moveTo(0, -s / 2);
  ctx.lineTo(0, s / 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * The MageStone flower emblem from the box cover: two elongated vertical shards,
 * six vein-detailed leaf petals offset 30° from vertical, and a ringed compass
 * star at the heart. Drawn in a local −50..50 space scaled to radius `r`.
 */
function drawEmblem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha = 1) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r / 50, r / 50);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  const gold = goldGradient(ctx, -50, -50, 50, 50);

  // elongated vertical shards (behind the petals)
  for (const s of [1, -1]) {
    ctx.save();
    ctx.scale(1, s);
    ctx.beginPath();
    ctx.moveTo(0, -60);
    ctx.quadraticCurveTo(3.4, -34, 2.6, -24);
    ctx.lineTo(0, -8);
    ctx.lineTo(-2.6, -24);
    ctx.quadraticCurveTo(-3.4, -34, 0, -60);
    ctx.closePath();
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.strokeStyle = '#6e521a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  // six leaf petals, offset 30° from vertical (the shards take the poles)
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate(((30 + i * 60) * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -46);
    ctx.bezierCurveTo(9, -34, 10, -18, 0, -9);
    ctx.bezierCurveTo(-10, -18, -9, -34, 0, -46);
    ctx.closePath();
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.strokeStyle = '#6e521a';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    // leaf veins
    ctx.strokeStyle = 'rgba(110,82,26,0.75)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, -43);
    ctx.lineTo(0, -11);
    for (let v = 0; v < 3; v++) {
      const vy = -36 + v * 8;
      ctx.moveTo(0, vy);
      ctx.lineTo(4.2, vy + 4.5);
      ctx.moveTo(0, vy);
      ctx.lineTo(-4.2, vy + 4.5);
    }
    ctx.stroke();
    ctx.restore();
  }
  // central ring + compass star
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 2.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(2.6, -2.6);
  ctx.lineTo(12, 0);
  ctx.lineTo(2.6, 2.6);
  ctx.lineTo(0, 12);
  ctx.lineTo(-2.6, 2.6);
  ctx.lineTo(-12, 0);
  ctx.lineTo(-2.6, -2.6);
  ctx.closePath();
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.strokeStyle = '#6e521a';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();
}

// ---- Bump maps (grayscale relief, NOT colour) ----------------------------

/** Fine speckled relief for the ground/floor — subtle grain + soft undulations. */
export function groundBumpTexture(): THREE.Texture {
  const hit = cache.get('groundBump');
  if (hit) return hit;
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  // broad soft undulations
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 24 + Math.random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const up = Math.random() < 0.5;
    g.addColorStop(0, up ? 'rgba(175,175,175,0.10)' : 'rgba(86,86,86,0.10)');
    g.addColorStop(1, 'rgba(128,128,128,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  // fine speckle
  for (let i = 0; i < 16000; i++) {
    const v = Math.round(128 + (Math.random() * 2 - 1) * 70);
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.25})`;
    const r = Math.random() < 0.15 ? 2 : 1;
    ctx.fillRect(Math.random() * S, Math.random() * S, r, r);
  }
  const t = finish(c, 'groundBump', true);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Vertical wood grain + plank seams for the tabletop relief. Tiles on x. */
export function woodBumpTexture(): THREE.Texture {
  const hit = cache.get('woodBump');
  if (hit) return hit;
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#888888';
  ctx.fillRect(0, 0, S, S);
  // wandering vertical grain lines
  for (let i = 0; i < 260; i++) {
    const v = Math.round(128 + (Math.random() * 2 - 1) * 60);
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.05 + Math.random() * 0.12})`;
    ctx.lineWidth = Math.random() < 0.3 ? 1.5 : 0.8;
    let x = Math.random() * S;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= S; y += 16) {
      x += (Math.random() - 0.5) * 1.2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // plank seams (include both edges so it tiles cleanly on x)
  const planks = 5;
  for (let p = 0; p <= planks; p++) {
    const x = (p / planks) * S + (p > 0 && p < planks ? (Math.random() - 0.5) * 4 : 0);
    ctx.strokeStyle = 'rgba(45,45,45,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, S);
    ctx.stroke();
  }
  const t = finish(c, 'woodBump', true);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ---- Board surface (emerald marble) --------------------------------------

/**
 * Dark emerald-marble board surface — the themed replacement for the old painted
 * map art. One large continuous texture; Board.tsx gives each tile a UV slice of
 * it so the marbling flows across the whole board under the gold lattice (no
 * pictorial artwork — just stone). Tinted gold flecks + veins tie it to the
 * MageStone box cover (deep green + gilt).
 */
export function emeraldBoardTexture(): THREE.Texture {
  const hit = cache.get('emeraldBoard');
  if (hit) return hit;
  const S = 2048;
  const [c, ctx] = canvas(S);
  // deep emerald base
  ctx.fillStyle = '#15321f';
  ctx.fillRect(0, 0, S, S);
  // broad marbling blotches in varied greens/teal
  const greens = ['#0e2417', '#1d4b30', '#21563a', '#13352a', '#27613f'];
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 80 + Math.random() * 360;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, greens[(Math.random() * greens.length) | 0] + 'cc');
    g.addColorStop(1, 'rgba(20,48,32,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // gilt veins — thin meandering gold filaments through the stone
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(${190 + Math.random() * 40},${150 + Math.random() * 40},${70 + Math.random() * 30},${0.05 + Math.random() * 0.1})`;
    ctx.lineWidth = Math.random() < 0.3 ? 2.4 : 1.2;
    let x = Math.random() * S;
    let y = Math.random() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 18 + (Math.random() * 26) | 0;
    let ax = (Math.random() - 0.5) * 60;
    let ay = (Math.random() - 0.5) * 60;
    for (let s = 0; s < steps; s++) {
      ax += (Math.random() - 0.5) * 40;
      ay += (Math.random() - 0.5) * 40;
      x += ax;
      y += ay;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // faint gold flecks
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(${200 + Math.random() * 40},${165 + Math.random() * 40},${90 + Math.random() * 40},${Math.random() * 0.22})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, Math.random() < 0.2 ? 2 : 1, 1);
  }
  // dark speckle for grain
  for (let i = 0; i < 9000; i++) {
    const v = 10 + (Math.random() * 30) | 0;
    ctx.fillStyle = `rgba(${v},${v + 18},${v + 6},${Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  // —— arcane gold inlay (cover-art motif) ——————————————————————————
  // A rune circle rings the central 8×8 MageStone zone (rows/cols 4–11 → the
  // middle half of the texture), and the flower emblem sits dead-centre,
  // spanning the 2×2 Nexus. Low alpha = aged inlay worked into the stone.
  const cx = S / 2;
  const cy = S / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(216,180,100,0.16)';
  ctx.lineWidth = S * 0.004;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.235, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = S * 0.0016;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.246, 0, Math.PI * 2);
  ctx.stroke();
  // tick marks between the two rings
  ctx.lineWidth = S * 0.0022;
  ctx.strokeStyle = 'rgba(216,180,100,0.13)';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * S * 0.237, cy + Math.sin(a) * S * 0.237);
    ctx.lineTo(cx + Math.cos(a) * S * 0.244, cy + Math.sin(a) * S * 0.244);
    ctx.stroke();
  }
  // arcane script around the inside of the ring
  ctx.strokeStyle = 'rgba(216,180,100,0.14)';
  ctx.lineWidth = S * 0.0015;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    runeGlyph(ctx, cx + Math.cos(a) * S * 0.222, cy + Math.sin(a) * S * 0.222, S * 0.012, a + Math.PI / 2);
  }
  // inner orbit around the Nexus + diagonal node dots
  ctx.strokeStyle = 'rgba(216,180,100,0.13)';
  ctx.lineWidth = S * 0.002;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.088, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(216,180,100,0.2)';
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * S * 0.088, cy + Math.sin(a) * S * 0.088, S * 0.0045, 0, Math.PI * 2);
    ctx.fill();
  }
  // the flower emblem, glowing softly in the heart of the Nexus
  ctx.shadowColor = 'rgba(240,205,120,0.9)';
  ctx.shadowBlur = S * 0.012;
  drawEmblem(ctx, cx, cy, S * 0.052, 0.95);
  ctx.restore();

  // soft edge vignette so the board reads as recessed under the gold frame
  const vg = ctx.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(2,10,6,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, S, S);
  return finish(c, 'emeraldBoard');
}

// ---- Smithy interior surfaces -----------------------------------------------

/** Aged lime-plaster wall with water stains and patches of exposed stone —
 *  the smithy's walls (tiles horizontally). */
export function plasterTexture(): THREE.Texture {
  const hit = cache.get('plaster');
  if (hit) return hit;
  const S = 1024;
  const [c, ctx] = canvas(S);
  // warm grey plaster base with a vertical grime gradient
  const base = ctx.createLinearGradient(0, 0, 0, S);
  base.addColorStop(0, '#8a8177');
  base.addColorStop(0.6, '#7c746a');
  base.addColorStop(1, '#5f584f');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  // broad tonal blotches (drawn with x-wrap copies so the wall tiles)
  for (let i = 0; i < 130; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 40 + Math.random() * 160;
    const light = Math.random() < 0.5;
    for (const ox of [0, -S, S]) {
      const g = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      g.addColorStop(0, light ? 'rgba(160,150,135,0.1)' : 'rgba(50,44,38,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + ox, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // exposed stone patches near the bottom (plaster fallen away)
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * S;
    const y = S * 0.55 + Math.random() * S * 0.42;
    const w = 30 + Math.random() * 70;
    const h = 18 + Math.random() * 34;
    for (const ox of [0, -S, S]) {
      ctx.fillStyle = `rgba(${70 + (Math.random() * 25) | 0},${64 + (Math.random() * 20) | 0},${56 + (Math.random() * 16) | 0},0.9)`;
      ctx.beginPath();
      ctx.roundRect(x + ox, y, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,26,22,0.55)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  // water-stain streaks from the top
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * S;
    const w = 6 + Math.random() * 22;
    const h = 80 + Math.random() * 260;
    for (const ox of [0, -S, S]) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(52,46,38,0.16)');
      g.addColorStop(1, 'rgba(52,46,38,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - w / 2, 0, w, h);
    }
  }
  // fine grain
  for (let i = 0; i < 12000; i++) {
    const v = 90 + ((Math.random() * 80) | 0);
    ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  const t = finish(c, 'plaster', true);
  return t;
}

/** The inside of the forge — banked coals glowing under ash. Emissive map. */
export function forgeEmbersTexture(): THREE.Texture {
  const hit = cache.get('embers');
  if (hit) return hit;
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#0c0705';
  ctx.fillRect(0, 0, S, S);
  // heart of the fire
  let g = ctx.createRadialGradient(S / 2, S * 0.68, 0, S / 2, S * 0.68, S * 0.52);
  g.addColorStop(0, '#ffb454');
  g.addColorStop(0.35, '#e2571d');
  g.addColorStop(0.7, '#6e1d08');
  g.addColorStop(1, 'rgba(20,8,4,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // individual coals
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.random() * S * 0.34;
    const x = S / 2 + Math.cos(a) * rr;
    const y = S * 0.68 + Math.sin(a) * rr * 0.55;
    const r = 4 + Math.random() * 14;
    g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const hot = Math.random() < 0.4;
    g.addColorStop(0, hot ? '#ffd98a' : '#f4712c');
    g.addColorStop(1, 'rgba(60,16,6,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // ash crust flecks
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(30,24,20,${0.2 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * S, S * 0.4 + Math.random() * S * 0.6, 2, 2);
  }
  return finish(c, 'embers');
}

/** A leaded arched window glowing with pale daylight (transparent outside the
 *  arch — use with alphaTest). */
export function windowTexture(): THREE.Texture {
  const hit = cache.get('window');
  if (hit) return hit;
  const W = 256;
  const H = 384;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const arch = () => {
    ctx.beginPath();
    ctx.moveTo(18, H - 10);
    ctx.lineTo(18, 130);
    ctx.arc(W / 2, 130, W / 2 - 18, Math.PI, 0);
    ctx.lineTo(W - 18, H - 10);
    ctx.closePath();
  };
  // pale foggy daylight
  arch();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#d8e4e6');
  g.addColorStop(0.55, '#b9c9c6');
  g.addColorStop(1, '#8fa39c');
  ctx.fillStyle = g;
  ctx.fill();
  // soft hot spot (the smothered sun)
  arch();
  ctx.save();
  ctx.clip();
  const s = ctx.createRadialGradient(W * 0.42, H * 0.3, 0, W * 0.42, H * 0.3, W * 0.7);
  s.addColorStop(0, 'rgba(255,252,238,0.85)');
  s.addColorStop(1, 'rgba(255,252,238,0)');
  ctx.fillStyle = s;
  ctx.fillRect(0, 0, W, H);
  // frosted, cloudy old glass — uneven blotches per pane
  for (let i = 0; i < 60; i++) {
    const bx = Math.random() * W;
    const by = Math.random() * H;
    const br = 12 + Math.random() * 40;
    const lite = Math.random() < 0.55;
    const g2 = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    g2.addColorStop(0, lite ? 'rgba(255,255,250,0.16)' : 'rgba(120,135,130,0.14)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }
  // lead cames: diamond lattice + mullion, with a light edge so they read RAISED
  for (let k = -6; k < 10; k++) {
    for (const [dir, off] of [
      [1, 0],
      [-1, H],
    ] as const) {
      ctx.strokeStyle = 'rgba(230,232,228,0.5)'; // catchlight above the came
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(k * 48 + (dir === 1 ? 0 : off), dir === 1 ? 0 : 0);
      ctx.lineTo(k * 48 + (dir === 1 ? H : off - H), H);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(34,32,28,0.9)'; // the lead itself
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(k * 48 + (dir === 1 ? 0 : off) + 1, dir === 1 ? 1 : 1);
      ctx.lineTo(k * 48 + (dir === 1 ? H : off - H) + 1, H);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(230,232,228,0.5)';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(W / 2, 40);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(34,32,28,0.92)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(W / 2 + 1, 41);
  ctx.lineTo(W / 2 + 1, H);
  ctx.stroke();
  ctx.restore();
  // thin dark reveal where glass meets the stone frame (frame is geometry)
  arch();
  ctx.strokeStyle = '#26221c';
  ctx.lineWidth = 8;
  ctx.stroke();
  return finish(c, 'window');
}

// ---- Team banners -----------------------------------------------------------

export type BannerTeam = 'red' | 'blue' | 'green' | 'yellow';

// Cloth + gem palettes matched to the reference banner art (rich velvet cloth,
// bright faceted gem, gold filigree identical across teams).
const BANNER_PALETTE: Record<
  BannerTeam,
  { cloth: string; clothDark: string; gemHi: string; gemMid: string; gemLo: string }
> = {
  red: { cloth: '#7e1f1c', clothDark: '#3d0e0c', gemHi: '#ff8a72', gemMid: '#d62a1e', gemLo: '#6e0f0c' },
  green: { cloth: '#1f6b33', clothDark: '#0b3318', gemHi: '#7ef2a8', gemMid: '#22b054', gemLo: '#0c5c2a' },
  blue: { cloth: '#1f3f8e', clothDark: '#0e1c4c', gemHi: '#7ab4ff', gemMid: '#2158d6', gemLo: '#0e2a78' },
  yellow: { cloth: '#a97c1e', clothDark: '#5c400c', gemHi: '#ffe888', gemMid: '#e0a81e', gemLo: '#8a6410' },
};

/** A tapered gold spike (pointed both ends), drawn vertically, centred. */
function goldSpike(ctx: CanvasRenderingContext2D, x: number, y: number, halfLen: number, halfW: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - halfLen);
  ctx.quadraticCurveTo(x + halfW, y - halfLen * 0.35, x + halfW * 0.7, y);
  ctx.quadraticCurveTo(x + halfW, y + halfLen * 0.35, x, y + halfLen);
  ctx.quadraticCurveTo(x - halfW, y + halfLen * 0.35, x - halfW * 0.7, y);
  ctx.quadraticCurveTo(x - halfW, y - halfLen * 0.35, x, y - halfLen);
  ctx.closePath();
}

/** A four-point sparkle star. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.18, y - r * 0.18, x + r, y);
  ctx.quadraticCurveTo(x + r * 0.18, y + r * 0.18, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.18, y + r * 0.18, x - r, y);
  ctx.quadraticCurveTo(x - r * 0.18, y - r * 0.18, x, y - r);
  ctx.closePath();
}

/**
 * A war banner matched to the reference art: dark wooden hanging rod with gold
 * finials, corner ropes with tassels, cloth tabs, rich velvet cloth with a
 * double gold border, swallow-tailed hem, and a faceted team-colour gem set in
 * a gold filigree of blades, crescents and sparks. Transparent outside the
 * artwork — the mesh is a single plane.
 */
export function bannerTexture(team: BannerTeam): THREE.Texture {
  const key = `banner2-${team}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const P = BANNER_PALETTE[team];
  const W = 640;
  const H = 1048;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const CX = W / 2;

  // ---- cloth silhouette (drawn under everything else) ----
  const clothTop = 74;
  const clothL = 74;
  const clothR = W - 74;
  const tailY = 966;
  const notchY = 836;
  const cloth = () => {
    ctx.beginPath();
    ctx.moveTo(clothL, clothTop);
    ctx.lineTo(clothR, clothTop);
    ctx.lineTo(clothR, tailY);
    ctx.lineTo(CX, notchY);
    ctx.lineTo(clothL, tailY);
    ctx.closePath();
  };

  // velvet base with vertical light falloff
  const base = ctx.createLinearGradient(0, clothTop, 0, tailY);
  base.addColorStop(0, P.cloth);
  base.addColorStop(0.45, P.cloth);
  base.addColorStop(1, P.clothDark);
  cloth();
  ctx.fillStyle = base;
  ctx.fill();

  cloth();
  ctx.save();
  ctx.clip();
  // velvet sheen down the middle
  const sheen = ctx.createLinearGradient(clothL, 0, clothR, 0);
  sheen.addColorStop(0, 'rgba(0,0,0,0.30)');
  sheen.addColorStop(0.3, 'rgba(255,255,255,0.08)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.03)');
  sheen.addColorStop(0.72, 'rgba(0,0,0,0.16)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);
  // soft vertical fold shadows (the mesh adds real geometry folds on top)
  for (const fx of [150, 260, 380, 490]) {
    const fold = ctx.createLinearGradient(fx - 30, 0, fx + 30, 0);
    fold.addColorStop(0, 'rgba(0,0,0,0)');
    fold.addColorStop(0.5, 'rgba(0,0,0,0.14)');
    fold.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fold;
    ctx.fillRect(fx - 30, clothTop, 60, H);
  }
  // cloth grain: weave threads + mottle
  for (let y = clothTop; y < H; y += 3) {
    ctx.fillStyle = `rgba(0,0,0,${y % 9 === 0 ? 0.05 : 0.025})`;
    ctx.fillRect(clothL, y, clothR - clothL, 1);
  }
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(clothL + Math.random() * (clothR - clothL), clothTop + Math.random() * (H - clothTop), 2, 1);
  }
  // worn darkening along the hem
  const hem = ctx.createLinearGradient(0, notchY - 40, 0, tailY);
  hem.addColorStop(0, 'rgba(0,0,0,0)');
  hem.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = hem;
  ctx.fillRect(0, notchY - 40, W, tailY - notchY + 40);
  ctx.restore();

  // ---- double gold border following the silhouette ----
  const border = (inset: number, width: number, alpha: number) => {
    ctx.beginPath();
    const t = clothTop + inset;
    const l = clothL + inset;
    const r = clothR - inset;
    const ty = tailY - inset * 1.6;
    const ny = notchY - inset * 0.4;
    ctx.moveTo(l, t);
    ctx.lineTo(r, t);
    ctx.lineTo(r, ty);
    ctx.lineTo(CX, ny);
    ctx.lineTo(l, ty);
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = goldGradient(ctx, 0, 0, W, H);
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 6;
  border(26, 11, 0.95);
  ctx.shadowBlur = 0;
  border(44, 3.5, 0.8);
  // diamond accents on the border
  ctx.fillStyle = goldGradient(ctx, 0, 0, W, H);
  ctx.strokeStyle = '#4a3610';
  ctx.lineWidth = 2;
  for (const [dx, dy, r] of [
    [CX, clothTop + 26, 20],
    [clothL + 26, 470, 14],
    [clothR - 26, 470, 14],
    [CX, notchY - 26, 16],
  ] as const) {
    sparkle(ctx, dx, dy, r);
    ctx.fill();
    ctx.stroke();
  }

  // ---- central medallion: filigree + faceted gem ----
  const cy = 440;
  ctx.save();
  // seat the emblem with a soft shadow on the cloth
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 18;

  const gold = goldGradient(ctx, CX - 170, cy - 200, CX + 170, cy + 220);
  ctx.fillStyle = gold;
  ctx.strokeStyle = '#4a3610';
  ctx.lineWidth = 2.5;

  // long vertical blade through the composition
  goldSpike(ctx, CX, cy - 175, 105, 13);
  ctx.fill();
  ctx.stroke();
  goldSpike(ctx, CX, cy + 195, 115, 13);
  ctx.fill();
  ctx.stroke();
  // cross-guards on the blade
  for (const gy of [cy - 235, cy + 260]) {
    goldSpike(ctx, CX, gy, 9, 26);
    ctx.fill();
    ctx.stroke();
  }

  // crescent horns (upper-left and lower-right, mirrored pair each side)
  const crescent = (sx: number, sy: number, rot: number) => {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.arc(0, 0, 118, Math.PI * 0.15, Math.PI * 0.95);
    ctx.arc(0, 26, 96, Math.PI * 0.92, Math.PI * 0.2, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  crescent(CX, cy - 34, Math.PI * 0.02);
  crescent(CX, cy + 34, Math.PI * 1.02);

  // thin radiating spikes + sparkles
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(214,178,94,0.75)';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.22;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * 120, cy + Math.sin(a) * 130);
    ctx.lineTo(CX + Math.cos(a) * (155 + (i % 3) * 16), cy + Math.sin(a) * (168 + (i % 3) * 16));
    ctx.stroke();
  }
  ctx.fillStyle = gold;
  ctx.strokeStyle = '#4a3610';
  for (const [sx2, sy2, r2] of [
    [CX - 128, cy - 118, 15],
    [CX + 128, cy - 118, 15],
    [CX - 148, cy + 66, 11],
    [CX + 148, cy + 66, 11],
    [CX, cy - 226, 12],
  ] as const) {
    sparkle(ctx, sx2, sy2, r2);
    ctx.fill();
    ctx.stroke();
  }

  // gold kite bezel for the gem
  const kite = (s: number) => {
    ctx.beginPath();
    ctx.moveTo(CX, cy - 118 * s);
    ctx.lineTo(CX + 66 * s, cy - 6 * s);
    ctx.lineTo(CX, cy + 142 * s);
    ctx.lineTo(CX - 66 * s, cy - 6 * s);
    ctx.closePath();
  };
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  kite(1.16);
  ctx.fillStyle = gold;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  kite(1.05);
  ctx.fillStyle = '#5c4514';
  ctx.fill();

  // the faceted gem
  kite(1);
  ctx.fillStyle = P.gemMid;
  ctx.fill();
  ctx.save();
  kite(1);
  ctx.clip();
  const facet = (pts: [number, number][], fill: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const T: [number, number] = [CX, cy - 118];
  const R: [number, number] = [CX + 66, cy - 6];
  const B: [number, number] = [CX, cy + 142];
  const L: [number, number] = [CX - 66, cy - 6];
  const M1: [number, number] = [CX - 20, cy - 20];
  const M2: [number, number] = [CX + 20, cy - 20];
  const M3: [number, number] = [CX, cy + 34];
  facet([T, M2, M1], P.gemHi); // crown
  facet([T, R, M2], P.gemMid);
  facet([T, L, M1], `${P.gemHi}cc`);
  facet([R, M3, M2], P.gemLo); // pavilion right
  facet([L, M1, M3], P.gemMid);
  facet([R, B, M3], `${P.gemLo}dd`);
  facet([L, M3, B], P.gemLo);
  facet([M1, M2, M3], P.gemHi); // table glow
  // inner light bloom + glints
  const bloom = ctx.createRadialGradient(CX, cy - 10, 0, CX, cy - 10, 90);
  bloom.addColorStop(0, 'rgba(255,255,255,0.5)');
  bloom.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  bloom.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(CX - 90, cy - 100, 180, 190);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(...T);
  ctx.lineTo(...M1);
  ctx.moveTo(...T);
  ctx.lineTo(...M2);
  ctx.moveTo(...M1);
  ctx.lineTo(...M3);
  ctx.moveTo(...M2);
  ctx.lineTo(...M3);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  sparkle(ctx, CX - 16, cy - 52, 12);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // ---- hanging rod, tabs, finials and tassels (over everything) ----
  const rodY = 46;
  // cloth tabs wrapping the rod
  ctx.fillStyle = P.cloth;
  for (let i = 0; i < 5; i++) {
    const tx = clothL + 30 + i * ((clothR - clothL - 116) / 4);
    ctx.beginPath();
    ctx.roundRect(tx, rodY - 26, 56, clothTop - rodY + 34, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(tx, clothTop - 8, 56, 10);
    ctx.fillStyle = P.cloth;
  }
  // rod
  const rodGrad = ctx.createLinearGradient(0, rodY - 12, 0, rodY + 12);
  rodGrad.addColorStop(0, '#5a4530');
  rodGrad.addColorStop(0.4, '#3a2c1c');
  rodGrad.addColorStop(1, '#241a10');
  ctx.fillStyle = rodGrad;
  ctx.beginPath();
  ctx.roundRect(34, rodY - 11, W - 68, 22, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(40, rodY - 8, W - 80, 3);
  // gold finials
  const finial = (fx: number, dir: number) => {
    ctx.fillStyle = goldGradient(ctx, fx - 26, rodY - 20, fx + 26, rodY + 20);
    ctx.strokeStyle = '#4a3610';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fx, rodY, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fx + dir * 10, rodY - 9);
    ctx.lineTo(fx + dir * 34, rodY);
    ctx.lineTo(fx + dir * 10, rodY + 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  finial(34, -1);
  finial(W - 34, 1);
  // ropes + tassels
  const tassel = (tx: number) => {
    ctx.strokeStyle = '#c9a24a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(tx, rodY + 8);
    ctx.quadraticCurveTo(tx + (tx < CX ? -14 : 14), rodY + 130, tx + (tx < CX ? -6 : 6), rodY + 240);
    ctx.stroke();
    const bx = tx + (tx < CX ? -6 : 6);
    ctx.fillStyle = goldGradient(ctx, bx - 14, rodY + 240, bx + 14, rodY + 320);
    ctx.beginPath();
    ctx.roundRect(bx - 9, rodY + 240, 18, 22, 5);
    ctx.fill();
    for (let s = -3; s <= 3; s++) {
      ctx.strokeStyle = 'rgba(201,162,74,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bx + s * 2.4, rodY + 262);
      ctx.quadraticCurveTo(bx + s * 4, rodY + 292, bx + s * 5, rodY + 316);
      ctx.stroke();
    }
  };
  tassel(86);
  tassel(W - 86);

  return finish(c, key);
}

// ---- Realism helpers: relief, planks, light + cobwebs -----------------------

/** Grayscale relief companion to `plasterTexture` — undulations, stone-patch
 *  ridges and pockmarks, so walls catch light like real rough plaster. */
export function plasterBumpTexture(): THREE.Texture {
  const hit = cache.get('plasterBump');
  if (hit) return hit;
  const S = 1024;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  // broad undulations (trowel marks)
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 30 + Math.random() * 130;
    for (const ox of [0, -S, S]) {
      const g = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      const up = Math.random() < 0.5;
      g.addColorStop(0, up ? 'rgba(178,178,178,0.16)' : 'rgba(84,84,84,0.16)');
      g.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + ox, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // raised stone patches near the bottom (matching the colour map's patches)
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * S;
    const y = S * 0.55 + Math.random() * S * 0.42;
    const w = 30 + Math.random() * 70;
    const h = 18 + Math.random() * 34;
    for (const ox of [0, -S, S]) {
      ctx.fillStyle = 'rgba(190,190,190,0.5)';
      ctx.beginPath();
      ctx.roundRect(x + ox, y, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,40,40,0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  // pocks + grain
  for (let i = 0; i < 9000; i++) {
    const v = 90 + ((Math.random() * 80) | 0);
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, Math.random() < 0.2 ? 2 : 1, 1);
  }
  const t = finish(c, 'plasterBump', true);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Aged plank boards: colour map with per-plank tone shifts, dark seams, grain
 *  streaks and nail heads. Pairs with `planksBumpTexture` (same layout). */
export function planksTexture(): THREE.Texture {
  const hit = cache.get('planks');
  if (hit) return hit;
  const S = 512;
  const [c, ctx] = canvas(S);
  const planks = 5;
  const pw = S / planks;
  for (let p = 0; p < planks; p++) {
    const shade = 0.82 + Math.random() * 0.36;
    const base = `rgb(${(74 * shade) | 0},${(52 * shade) | 0},${(33 * shade) | 0})`;
    ctx.fillStyle = base;
    ctx.fillRect(p * pw, 0, pw, S);
    // grain streaks
    for (let i = 0; i < 26; i++) {
      const v = Math.random() < 0.5 ? 'rgba(30,20,12,0.25)' : 'rgba(120,90,58,0.2)';
      ctx.strokeStyle = v;
      ctx.lineWidth = 1 + Math.random() * 1.4;
      let x = p * pw + 4 + Math.random() * (pw - 8);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= S; y += 24) {
        x += (Math.random() - 0.5) * 2.4;
        ctx.lineTo(Math.min(p * pw + pw - 2, Math.max(p * pw + 2, x)), y);
      }
      ctx.stroke();
    }
    // the odd knot
    if (Math.random() < 0.7) {
      const kx = p * pw + pw * (0.3 + Math.random() * 0.4);
      const ky = Math.random() * S;
      const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, 9);
      g.addColorStop(0, 'rgba(28,18,10,0.9)');
      g.addColorStop(0.6, 'rgba(58,40,24,0.5)');
      g.addColorStop(1, 'rgba(58,40,24,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(kx, ky, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    // dark seam + nail heads
    ctx.fillStyle = 'rgba(12,8,5,0.85)';
    ctx.fillRect(p * pw - 1.5, 0, 3, S);
    for (const ny of [S * 0.12, S * 0.88]) {
      ctx.fillStyle = '#1a1c1f';
      ctx.beginPath();
      ctx.arc(p * pw + pw / 2, ny + (Math.random() - 0.5) * 8, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(p * pw + pw / 2 - 1, ny - 1, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return finish(c, 'planks', true);
}

/** Relief for `planksTexture`: deep seams, grain ridges, knot dips. */
export function planksBumpTexture(): THREE.Texture {
  const hit = cache.get('planksBump');
  if (hit) return hit;
  const S = 512;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, S, S);
  const planks = 5;
  const pw = S / planks;
  for (let p = 0; p < planks; p++) {
    // slight per-plank height difference (uneven alignment)
    const lvl = 120 + ((Math.random() * 30) | 0);
    ctx.fillStyle = `rgb(${lvl},${lvl},${lvl})`;
    ctx.fillRect(p * pw + 2, 0, pw - 4, S);
    for (let i = 0; i < 30; i++) {
      const v = 90 + ((Math.random() * 90) | 0);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.3)`;
      ctx.lineWidth = 1;
      let x = p * pw + 4 + Math.random() * (pw - 8);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= S; y += 24) {
        x += (Math.random() - 0.5) * 2.4;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(p * pw - 2, 0, 4, S);
  }
  const t = finish(c, 'planksBump', true);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Soft vertical light gradient on transparency — a faked window light shaft. */
export function lightShaftTexture(): THREE.Texture {
  const hit = cache.get('lightShaft');
  if (hit) return hit;
  const W = 256;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(226,238,244,0.55)');
  g.addColorStop(0.55, 'rgba(226,238,244,0.18)');
  g.addColorStop(1, 'rgba(226,238,244,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // feather the sides
  const side = ctx.createLinearGradient(0, 0, W, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.2, 'rgba(0,0,0,0)');
  side.addColorStop(0.8, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  return finish(c, 'lightShaft');
}

/** A faint dusty cobweb on transparency, for high corners. */
export function cobwebTexture(): THREE.Texture {
  const hit = cache.get('cobweb');
  if (hit) return hit;
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.strokeStyle = 'rgba(210,210,200,0.5)';
  ctx.lineWidth = 1;
  // radial anchor threads from the corner (0,0)
  const rays: number[] = [];
  for (let i = 0; i <= 7; i++) {
    const a = (i / 7) * (Math.PI / 2);
    rays.push(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * S * (0.8 + Math.random() * 0.2), Math.sin(a) * S * (0.8 + Math.random() * 0.2));
    ctx.stroke();
  }
  // sagging spiral threads
  for (let ring = 0.2; ring < 0.95; ring += 0.13) {
    ctx.beginPath();
    for (let i = 0; i < rays.length; i++) {
      const a = rays[i];
      const r = S * ring * (0.94 + Math.random() * 0.1);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else {
        const pa = rays[i - 1];
        const mx = Math.cos((a + pa) / 2) * r * 1.06;
        const my = Math.sin((a + pa) / 2) * r * 1.06;
        ctx.quadraticCurveTo(mx, my, x, y);
      }
    }
    ctx.stroke();
  }
  return finish(c, 'cobweb');
}

/** Warm radial glow sprite for candle flames (additive billboard). */
export function flameGlowTexture(): THREE.Texture {
  const hit = cache.get('flameGlow');
  if (hit) return hit;
  const S = 128;
  const [c, ctx] = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,220,150,0.9)');
  g.addColorStop(0.3, 'rgba(255,170,80,0.4)');
  g.addColorStop(1, 'rgba(255,140,50,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return finish(c, 'flameGlow');
}

// ---- Hazy fog backdrop (equirectangular) -----------------------------------

/**
 * The scene background: a cold, hazy night fog painted onto an equirectangular
 * skydome. No scenery — just layered drifting fog banks around the horizon, a
 * faint moonlit glow lost in the murk, and darkness above. Matches the scene
 * fog colour so the floor dissolves seamlessly into the distance. Eerie by
 * design. Not cached/disposed — lives for the app's lifetime.
 */
export function hazyFogTexture(): THREE.Texture {
  const W = 4096;
  const H = 2048;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const HORIZON = H * 0.5;

  // cold desaturated night: near-black zenith → pale fog band → dark ground
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#05070a');
  sky.addColorStop(0.24, '#0b0f10');
  sky.addColorStop(0.4, '#161d1c');
  sky.addColorStop(0.48, '#28322f');
  sky.addColorStop(0.52, '#242e2b');
  sky.addColorStop(0.6, '#121815');
  sky.addColorStop(1, '#05080a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // a cold moon glow, smothered by the fog (over the default view, u≈0.25)
  const FX = W * 0.25;
  let g = ctx.createRadialGradient(FX, H * 0.34, 0, FX, H * 0.34, H * 0.4);
  g.addColorStop(0, 'rgba(180,200,195,0.16)');
  g.addColorStop(0.4, 'rgba(150,170,165,0.07)');
  g.addColorStop(1, 'rgba(150,170,165,0)');
  ctx.fillStyle = g;
  ctx.fillRect(FX - H * 0.45, 0, H * 0.9, H * 0.6);

  // layered fog banks drifting around the whole horizon — wide, soft, and
  // slightly varied in temperature so the murk reads as depth, not a gradient.
  // Each blob is drawn at x and x±W so the equirect seam stays invisible.
  const fogs = ['#39443f', '#2e3936', '#46524c', '#26302c', '#515e57'];
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * W;
    const band = Math.random();
    // most banks hug the horizon; a few wisps climb higher or sink lower
    const y = band < 0.7 ? H * (0.42 + Math.random() * 0.16) : H * (0.28 + Math.random() * 0.42);
    const rx = 180 + Math.random() * 520;
    const ry = rx * (0.1 + Math.random() * 0.14);
    const col = fogs[(Math.random() * fogs.length) | 0];
    const a = 0.045 + Math.random() * 0.1;
    for (const ox of [0, -W, W]) {
      const fg = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, rx);
      fg.addColorStop(0, col + Math.round(a * 255).toString(16).padStart(2, '0'));
      fg.addColorStop(1, col + '00');
      ctx.fillStyle = fg;
      ctx.save();
      ctx.translate(x + ox, y);
      ctx.scale(1, ry / rx);
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // dense bright core right on the horizon line — the fog wall itself
  g = ctx.createLinearGradient(0, HORIZON - H * 0.05, 0, HORIZON + H * 0.05);
  g.addColorStop(0, 'rgba(120,138,130,0)');
  g.addColorStop(0.5, 'rgba(120,138,130,0.2)');
  g.addColorStop(1, 'rgba(120,138,130,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, HORIZON - H * 0.05, W, H * 0.1);

  // fine grain so the murk doesn't band
  for (let i = 0; i < 9000; i++) {
    const v = 60 + ((Math.random() * 60) | 0);
    ctx.fillStyle = `rgba(${v},${v + 8},${v + 4},${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * W, H * 0.2 + Math.random() * H * 0.55, 1, 1);
  }

  // pole vignettes
  const vg = ctx.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, 'rgba(0,0,0,0.6)');
  vg.addColorStop(0.5, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- Stone plaza floor (tiling) -------------------------------------------

/** Large weathered stone slabs — the arena floor the table stands on. Big
 *  tiles (2 courses per texture repeat) with bevel-shaded edges, hairline
 *  cracks, damp mottling and a whisper of moss in the joints. Tiles seamlessly
 *  (slabs wrap across the x edge; rows fit the y edge exactly). */
export function stoneFloorTexture(): THREE.Texture {
  const hit = cache.get('stoneFloor');
  if (hit) return hit;
  const S = 1024;
  const [c, ctx] = canvas(S);
  // damp joint mortar underneath
  ctx.fillStyle = '#070b09';
  ctx.fillRect(0, 0, S, S);
  const shades = ['#151b18', '#181f1b', '#121815', '#1b2320', '#161d19'];
  const rows = 2; // two courses per repeat → big slabs
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = -Math.random() * 160;
    while (x < S) {
      const w = 380 + Math.random() * 220;
      const shade = shades[(Math.random() * shades.length) | 0];
      for (const ox of [0, S]) {
        // draw at x and x+S so slabs crossing the left edge wrap to the right
        const px = x + ox + 6;
        const py = r * rh + 6;
        const pw = w - 12;
        const ph = rh - 12;
        // slab face with a diagonal light-to-damp gradient
        const sg = ctx.createLinearGradient(px, py, px + pw, py + ph);
        sg.addColorStop(0, shade);
        sg.addColorStop(1, '#0e1411');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, 14);
        ctx.fill();
        // bevel: light top-left edge, dark bottom-right edge
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(140,155,145,0.12)';
        ctx.beginPath();
        ctx.moveTo(px + 8, py + ph - 10);
        ctx.lineTo(px + 8, py + 10);
        ctx.lineTo(px + pw - 10, py + 10);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.moveTo(px + pw - 8, py + 12);
        ctx.lineTo(px + pw - 8, py + ph - 8);
        ctx.lineTo(px + 12, py + ph - 8);
        ctx.stroke();
        // hairline cracks
        const cracks = 1 + ((Math.random() * 2) | 0);
        ctx.strokeStyle = 'rgba(5,8,7,0.55)';
        ctx.lineWidth = 1.6;
        for (let k = 0; k < cracks; k++) {
          let cx2 = px + 30 + Math.random() * (pw - 60);
          let cy2 = py + 20 + Math.random() * (ph - 40);
          ctx.beginPath();
          ctx.moveTo(cx2, cy2);
          for (let seg = 0; seg < 5; seg++) {
            cx2 += (Math.random() - 0.5) * 90;
            cy2 += (Math.random() - 0.3) * 70;
            ctx.lineTo(Math.min(px + pw - 12, Math.max(px + 12, cx2)), Math.min(py + ph - 12, Math.max(py + 12, cy2)));
          }
          ctx.stroke();
        }
        // damp mottling on the face
        for (let k = 0; k < 8; k++) {
          const mx = px + Math.random() * pw;
          const my = py + Math.random() * ph;
          const mr = 24 + Math.random() * 70;
          const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
          mg.addColorStop(0, `rgba(8,14,11,${0.08 + Math.random() * 0.12})`);
          mg.addColorStop(1, 'rgba(8,14,11,0)');
          ctx.fillStyle = mg;
          ctx.beginPath();
          ctx.arc(mx, my, mr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      x += w;
    }
  }
  // moss creeping from the joints (wrap copies keep the tile seamless)
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * S;
    const y = (((Math.random() * rows) | 0) + (Math.random() < 0.5 ? 0 : 1)) * rh + (Math.random() - 0.5) * 26;
    const r = 14 + Math.random() * 46;
    for (const ox of [0, -S, S]) {
      for (const oy of [0, -S, S]) {
        const mg = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        mg.addColorStop(0, `rgba(40,76,50,${0.05 + Math.random() * 0.08})`);
        mg.addColorStop(1, 'rgba(40,76,50,0)');
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // stone grain
  for (let i = 0; i < 7000; i++) {
    const v = 10 + ((Math.random() * 34) | 0);
    ctx.fillStyle = `rgba(${v},${v + 6},${v + 3},${Math.random() * 0.28})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  return finish(c, 'stoneFloor', true);
}

// ---- Arena summoning circle (floor decal) ----------------------------------

/** A grand gold summoning circle inlaid in the plaza around the table's stand:
 *  concentric rings, tick marks, arcane script and four flower emblems. Drawn on
 *  transparency — laid flat as a decal. */
export function arenaCircleTexture(): THREE.Texture {
  const hit = cache.get('arenaCircle');
  if (hit) return hit;
  const S = 2048;
  const [c, ctx] = canvas(S);
  const cx = S / 2;
  const cy = S / 2;
  ctx.shadowColor = 'rgba(230,190,100,0.7)';
  ctx.shadowBlur = 20;

  const ring = (r: number, w: number, a: number) => {
    ctx.strokeStyle = `rgba(214,178,94,${a})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(S * 0.478, S * 0.005, 0.5);
  ring(S * 0.455, S * 0.0016, 0.45);
  ring(S * 0.39, S * 0.0012, 0.32);
  ring(S * 0.275, S * 0.003, 0.45);

  // tick marks between the outer rings
  ctx.strokeStyle = 'rgba(214,178,94,0.4)';
  ctx.lineWidth = S * 0.002;
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * S * 0.457, cy + Math.sin(a) * S * 0.457);
    ctx.lineTo(cx + Math.cos(a) * S * 0.476, cy + Math.sin(a) * S * 0.476);
    ctx.stroke();
  }
  // arcane script ring
  ctx.strokeStyle = 'rgba(214,178,94,0.42)';
  ctx.lineWidth = S * 0.0016;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    runeGlyph(ctx, cx + Math.cos(a) * S * 0.425, cy + Math.sin(a) * S * 0.425, S * 0.02, a + Math.PI / 2);
  }
  // four flower emblems at the diagonals
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    drawEmblem(ctx, cx + Math.cos(a) * S * 0.335, cy + Math.sin(a) * S * 0.335, S * 0.042, 0.5);
  }
  return finish(c, 'arenaCircle');
}

// ---- Dice faces ----------------------------------------------------------

const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

// Warrior = red, Mage = blue, Priest = green — marbled stone face, gilt frame
// with corner flourishes, and gold-dome pips (matching the carved-token art).
const DIE_STYLE = {
  mage: { c1: '#2f63b6', c2: '#163a82', vein: '#6f9ce8' }, // blue
  priest: { c1: '#22844c', c2: '#0e5530', vein: '#57c690' }, // green
  warrior: { c1: '#ab2d31', c2: '#6e171a', vein: '#db6060' }, // red
} as const;

export type DiceKind = keyof typeof DIE_STYLE;

/** BoxGeometry face order [+x,-x,+y,-y,+z,-z] with opposite faces summing to 7. */
export const FACE_VALUES = [1, 6, 2, 5, 3, 4];

const GOLD_HI = '#f6e191';
const GOLD_MID = '#c9a23a';
const GOLD_LO = '#7c5a1e';

/** A raised, shaded gold pip sitting in a recessed socket. */
function goldDome(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r * 1.16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(30,20,6,0.5)';
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
  g.addColorStop(0, '#fff2bf');
  g.addColorStop(0.5, GOLD_HI);
  g.addColorStop(0.82, GOLD_MID);
  g.addColorStop(1, GOLD_LO);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.strokeStyle = GOLD_LO;
  ctx.stroke();
}

function pipFace(value: number, kind: DiceKind): THREE.Texture {
  const key = `die-${kind}-${value}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 256;
  const [c, ctx] = canvas(S);
  const st = DIE_STYLE[kind];

  // bevelled gilt frame fills the tile
  const frame = ctx.createLinearGradient(0, 0, S, S);
  frame.addColorStop(0, GOLD_HI);
  frame.addColorStop(0.5, GOLD_MID);
  frame.addColorStop(1, GOLD_LO);
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, S, S);

  // marbled stone face (thin gilt trim → small margin)
  const m = S * 0.06;
  const rad = S * 0.1;
  const iw = S - 2 * m;
  const ih = S - 2 * m;
  const face = ctx.createLinearGradient(m, m, m + iw, m + ih);
  face.addColorStop(0, st.c1);
  face.addColorStop(1, st.c2);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(m, m, iw, ih, rad);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.clip();
  for (let i = 0; i < 16; i++) {
    ctx.strokeStyle = st.vein;
    ctx.globalAlpha = 0.04 + Math.random() * 0.08;
    ctx.lineWidth = Math.random() < 0.3 ? 2 : 1;
    let x = m + Math.random() * iw;
    let y = m + Math.random() * ih;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (Math.random() - 0.5) * iw * 0.4;
      y += (Math.random() - 0.5) * ih * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(m + Math.random() * iw, m + Math.random() * ih, 1, 1);
  }
  ctx.restore();

  // gilt double inner line + corner flourishes
  ctx.lineWidth = S * 0.02;
  ctx.strokeStyle = GOLD_HI;
  ctx.beginPath();
  ctx.roundRect(m, m, iw, ih, rad);
  ctx.stroke();
  const j = S * 0.035;
  ctx.lineWidth = S * 0.008;
  ctx.strokeStyle = GOLD_LO;
  ctx.beginPath();
  ctx.roundRect(m + j, m + j, iw - 2 * j, ih - 2 * j, rad * 0.7);
  ctx.stroke();
  ctx.strokeStyle = GOLD_HI;
  ctx.lineWidth = S * 0.01;
  const k = S * 0.06;
  for (const [px, py, sx, sy] of [
    [m + j, m + j, 1, 1],
    [m + iw - j, m + j, -1, 1],
    [m + j, m + ih - j, 1, -1],
    [m + iw - j, m + ih - j, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(px + sx * k * 1.4, py);
    ctx.quadraticCurveTo(px + sx * k * 0.4, py + sy * k * 0.1, px + sx * k * 0.5, py + sy * k * 0.7);
    ctx.quadraticCurveTo(px + sx * k * 0.55, py + sy * k * 1.2, px, py + sy * k * 1.4);
    ctx.stroke();
  }

  // gold pips
  const r = S * 0.082;
  for (const [cx, cy] of PIP_LAYOUT[value]) {
    goldDome(ctx, (0.27 + cx * 0.23) * S, (0.27 + cy * 0.23) * S, r);
  }
  return finish(c, key);
}

/** Six face textures for a die of `kind`, in BoxGeometry material order. */
export function diceFaceTextures(kind: DiceKind): THREE.Texture[] {
  return FACE_VALUES.map((v) => pipFace(v, kind));
}
