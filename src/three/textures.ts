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
  // soft edge vignette so the board reads as recessed under the gold frame
  const vg = ctx.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(2,10,6,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, S, S);
  return finish(c, 'emeraldBoard');
}

// ---- Castle-hall backdrop (equirectangular) ------------------------------

/**
 * Torch-lit medieval great-hall painted onto an equirectangular canvas, used as
 * the scene background (a skydome) so the board reads as sitting on a table in a
 * castle. Stone-block walls wrap 360°, with tall arched windows glowing at dusk,
 * hanging banners, and warm torch sconces between the bays. Not cached/disposed —
 * it lives for the app's lifetime.
 */
export function castleHallTexture(): THREE.Texture {
  const W = 4096;
  const H = 2048;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  // vertical wash: dark vaulted ceiling → lit wall → dark floor
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0a0907');
  sky.addColorStop(0.32, '#221c14');
  sky.addColorStop(0.5, '#3a2f22');
  sky.addColorStop(0.72, '#1c160f');
  sky.addColorStop(1, '#070504');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // stone-block courses across the wall band (v ~0.28–0.72)
  const wallTop = H * 0.28;
  const wallBot = H * 0.74;
  const course = 64;
  for (let y = wallTop; y < wallBot; y += course) {
    const off = ((y - wallTop) / course) % 2 < 1 ? 0 : 96;
    for (let x = -96; x < W; x += 192) {
      const bx = x + off;
      const shade = 38 + ((Math.random() * 18) | 0);
      ctx.fillStyle = `rgb(${shade + 16},${shade + 8},${shade - 4})`;
      ctx.fillRect(bx + 3, y + 3, 192 - 6, course - 6);
    }
  }
  // mortar darkening overlay
  ctx.fillStyle = 'rgba(10,8,5,0.28)';
  ctx.fillRect(0, wallTop, W, wallBot - wallTop);

  // bays: arches with dusk glow, torches + banners between them
  const BAYS = 8;
  const bw = W / BAYS;
  for (let i = 0; i < BAYS; i++) {
    const cx = i * bw + bw / 2;
    // tall arched opening
    const aw = bw * 0.42;
    const aTop = H * 0.33;
    const aBot = H * 0.66;
    const glow = ctx.createLinearGradient(0, aTop, 0, aBot);
    glow.addColorStop(0, '#3b2a14');
    glow.addColorStop(0.5, '#9c5f24');
    glow.addColorStop(1, '#d59a44');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(cx - aw / 2, aBot);
    ctx.lineTo(cx - aw / 2, aTop + aw / 2);
    ctx.arc(cx, aTop + aw / 2, aw / 2, Math.PI, 0);
    ctx.lineTo(cx + aw / 2, aBot);
    ctx.closePath();
    ctx.fill();
    // arch stone frame
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#2a241b';
    ctx.stroke();
    // mullion
    ctx.fillStyle = '#241d14';
    ctx.fillRect(cx - 4, aTop + aw / 4, 8, aBot - aTop - aw / 4);

    // torch sconces on the piers between bays
    for (const tx of [cx - bw / 2, cx + bw / 2]) {
      const ty = H * 0.46;
      const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 150);
      tg.addColorStop(0, 'rgba(255,196,96,0.85)');
      tg.addColorStop(0.4, 'rgba(214,120,40,0.4)');
      tg.addColorStop(1, 'rgba(214,120,40,0)');
      ctx.fillStyle = tg;
      ctx.fillRect(tx - 150, ty - 150, 300, 300);
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath();
      ctx.ellipse(tx, ty - 6, 9, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // hanging banner over alternating piers
    if (i % 2 === 0) {
      const bx2 = cx - bw / 2;
      ctx.fillStyle = i % 4 === 0 ? '#1f5138' : '#6f2723';
      ctx.beginPath();
      ctx.moveTo(bx2 - 26, H * 0.3);
      ctx.lineTo(bx2 + 26, H * 0.3);
      ctx.lineTo(bx2 + 26, H * 0.52);
      ctx.lineTo(bx2, H * 0.56);
      ctx.lineTo(bx2 - 26, H * 0.52);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(201,162,74,0.85)';
      ctx.beginPath();
      ctx.arc(bx2, H * 0.4, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // floor flagstones (lower band), faint
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 3;
  for (let y = wallBot; y < H * 0.92; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // overall warm vignette top & bottom (toward the equirect poles)
  const vg = ctx.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, 'rgba(0,0,0,0.55)');
  vg.addColorStop(0.5, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
