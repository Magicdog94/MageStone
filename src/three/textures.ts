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

// ---- Duel-night backdrop (equirectangular, box-cover theme) ---------------

/** One tower of a castle silhouette: keep body, battlements and a spire. */
function tower(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  h: number,
  fill: string,
) {
  ctx.fillStyle = fill;
  ctx.fillRect(x - w / 2, baseY - h, w, h);
  // battlement teeth
  const teeth = Math.max(2, Math.round(w / 12));
  const tw = w / (teeth * 2 - 1);
  for (let i = 0; i < teeth; i++) {
    ctx.fillRect(x - w / 2 + i * tw * 2, baseY - h - tw * 1.4, tw, tw * 1.4);
  }
  // spire
  ctx.beginPath();
  ctx.moveTo(x - w * 0.34, baseY - h - tw * 1.2);
  ctx.lineTo(x, baseY - h - tw * 1.2 - h * 0.55);
  ctx.lineTo(x + w * 0.34, baseY - h - tw * 1.2);
  ctx.closePath();
  ctx.fill();
}

/** A gothic castle silhouette on a crag, rim-lit and haloed in `glowRGB`. */
function castle(
  ctx: CanvasRenderingContext2D,
  x: number,
  horizon: number,
  scale: number,
  glowRGB: string,
  rim: string,
) {
  // halo behind the keep
  const g = ctx.createRadialGradient(x, horizon - scale * 0.5, 0, x, horizon - scale * 0.5, scale * 1.9);
  g.addColorStop(0, `rgba(${glowRGB},0.34)`);
  g.addColorStop(0.55, `rgba(${glowRGB},0.12)`);
  g.addColorStop(1, `rgba(${glowRGB},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - scale * 2, horizon - scale * 2.4, scale * 4, scale * 2.6);

  // crag the castle stands on
  const dark = '#04100b';
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(x - scale * 1.5, horizon + 4);
  ctx.lineTo(x - scale * 0.8, horizon - scale * 0.34);
  ctx.lineTo(x - scale * 0.2, horizon - scale * 0.2);
  ctx.lineTo(x + scale * 0.5, horizon - scale * 0.4);
  ctx.lineTo(x + scale * 1.4, horizon + 4);
  ctx.closePath();
  ctx.fill();

  // towers (central keep flanked by smaller ones)
  tower(ctx, x, horizon - scale * 0.3, scale * 0.34, scale * 0.9, dark);
  tower(ctx, x - scale * 0.42, horizon - scale * 0.26, scale * 0.24, scale * 0.55, dark);
  tower(ctx, x + scale * 0.4, horizon - scale * 0.3, scale * 0.22, scale * 0.62, dark);
  tower(ctx, x - scale * 0.75, horizon - scale * 0.1, scale * 0.18, scale * 0.34, dark);
  tower(ctx, x + scale * 0.78, horizon - scale * 0.12, scale * 0.16, scale * 0.4, dark);

  // rim light on the glow side + a few lit windows
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2.4;
  ctx.globalAlpha = 0.5;
  for (const [tx, tw2, th] of [
    [x, scale * 0.34, scale * 0.9],
    [x + scale * 0.4, scale * 0.22, scale * 0.62],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(tx - tw2 / 2, horizon - scale * 0.3);
    ctx.lineTo(tx - tw2 / 2, horizon - scale * 0.3 - th);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = rim;
  for (let i = 0; i < 10; i++) {
    const wx = x + (Math.random() - 0.5) * scale * 1.1;
    const wy = horizon - scale * (0.25 + Math.random() * 0.75);
    ctx.globalAlpha = 0.25 + Math.random() * 0.4;
    ctx.fillRect(wx, wy, 3, 5);
  }
  ctx.globalAlpha = 1;
}

/**
 * The scene background: the box-cover duel at night painted onto an
 * equirectangular skydome. An emerald storm sky with a green-gold radiance and
 * a faint arcane sigil over the board, stars, layered mountain + forest
 * silhouettes wrapping 360°, and two rival castles — one rim-lit blue, one red —
 * flanking the default view. Not cached/disposed — lives for the app's lifetime.
 */
export function duelNightTexture(): THREE.Texture {
  const W = 4096;
  const H = 2048;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const HORIZON = H * 0.5;
  const FX = W * 0.25; // the default camera looks toward u=0.25

  // emerald night sky → dark ground haze below the horizon
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#050f0a');
  sky.addColorStop(0.18, '#0b2417');
  sky.addColorStop(0.38, '#123727');
  sky.addColorStop(0.47, '#1d5434');
  sky.addColorStop(0.5, '#0a1f14');
  sky.addColorStop(0.56, '#04100a');
  sky.addColorStop(1, '#020705');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // green-gold radiance behind the front of the scene (the cover's title glow)
  let g = ctx.createRadialGradient(FX, H * 0.4, 0, FX, H * 0.4, H * 0.56);
  g.addColorStop(0, 'rgba(120,190,120,0.38)');
  g.addColorStop(0.5, 'rgba(80,140,90,0.16)');
  g.addColorStop(1, 'rgba(80,140,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(FX - H * 0.6, 0, H * 1.2, H * 0.55);
  g = ctx.createRadialGradient(FX, H * 0.42, 0, FX, H * 0.42, H * 0.2);
  g.addColorStop(0, 'rgba(225,235,170,0.25)');
  g.addColorStop(1, 'rgba(225,235,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(FX - H * 0.25, H * 0.2, H * 0.5, H * 0.45);

  // storm clouds — dark emerald blobs swirling around the sky band (each drawn
  // at x and x±W so the equirect seam stays invisible)
  const cloudGreens = ['#08160e', '#0d2517', '#123122', '#1a4229'];
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * W;
    const y = (0.04 + Math.random() * 0.4) * H;
    const rx = 120 + Math.random() * 420;
    const ry = rx * (0.22 + Math.random() * 0.2);
    const col = cloudGreens[(Math.random() * cloudGreens.length) | 0];
    const a = 0.2 + Math.random() * 0.3;
    for (const ox of [0, -W, W]) {
      const cg = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, rx);
      cg.addColorStop(0, col + Math.round(a * 255).toString(16).padStart(2, '0'));
      cg.addColorStop(1, col + '00');
      ctx.fillStyle = cg;
      ctx.save();
      ctx.translate(x + ox, y);
      ctx.scale(1, ry / rx);
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // gold-lit cloud rims near the radiance
  for (let i = 0; i < 46; i++) {
    const x = FX + (Math.random() - 0.5) * W * 0.24;
    const y = (0.16 + Math.random() * 0.26) * H;
    const rx = 90 + Math.random() * 260;
    const cg = ctx.createRadialGradient(x, y, 0, x, y, rx);
    cg.addColorStop(0, 'rgba(200,180,100,0.12)');
    cg.addColorStop(1, 'rgba(200,180,100,0)');
    ctx.fillStyle = cg;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.32);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // stars
  for (let i = 0; i < 420; i++) {
    const y = Math.random() * H * 0.42;
    const v = 190 + ((Math.random() * 60) | 0);
    ctx.fillStyle = `rgba(${v},${v + 8},${v - 20},${0.12 + Math.random() * 0.45})`;
    ctx.fillRect(Math.random() * W, y, Math.random() < 0.2 ? 2 : 1, 1);
  }

  // faint arcane sigil hanging in the sky over the board — the cover's rune
  // circle. Drawn as an ellipse widened by 1/cos(elevation) so it reads as a
  // circle on the skydome.
  {
    const sy = H * 0.33;
    const elev = (1 - sy / H - 0.5) * Math.PI;
    const stretch = 1 / Math.cos(elev);
    const r = H * 0.15;
    ctx.save();
    ctx.translate(FX, sy);
    ctx.scale(stretch, 1);
    ctx.strokeStyle = 'rgba(214,178,94,0.13)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(214,178,94,0.1)';
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      runeGlyph(ctx, Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88, r * 0.06, a + Math.PI / 2);
    }
    ctx.shadowColor = 'rgba(240,205,120,0.5)';
    ctx.shadowBlur = 26;
    drawEmblem(ctx, 0, 0, r * 0.5, 0.1);
    ctx.restore();
  }

  // layered mountain silhouettes along the whole horizon
  for (const [amp, col] of [
    [H * 0.062, '#0b1d14'],
    [H * 0.088, '#071510'],
  ] as const) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON + 6);
    let y = HORIZON - amp * (0.3 + Math.random() * 0.5);
    for (let x = 0; x <= W; x += 64) {
      y += (Math.random() - 0.5) * amp * 0.55;
      y = Math.min(HORIZON - amp * 0.08, Math.max(HORIZON - amp * 1.35, y));
      // pull the ends together so the strip tiles at the seam
      const blend = Math.min(1, Math.min(x, W - x) / (W * 0.06));
      ctx.lineTo(x, HORIZON - (HORIZON - y) * (0.55 + 0.45 * blend));
    }
    ctx.lineTo(W, HORIZON + 6);
    ctx.closePath();
    ctx.fill();
  }

  // the rival keeps — blue to the left of the default view, red to the right —
  // plus two distant neutral towers for the far side of the orbit
  castle(ctx, W * 0.155, HORIZON, H * 0.155, '74,140,220', 'rgba(124,192,255,0.8)');
  castle(ctx, W * 0.345, HORIZON, H * 0.155, '220,80,58', 'rgba(255,138,114,0.8)');
  castle(ctx, W * 0.62, HORIZON, H * 0.085, '120,160,130', 'rgba(170,210,180,0.5)');
  castle(ctx, W * 0.86, HORIZON, H * 0.1, '120,160,130', 'rgba(170,210,180,0.5)');

  // forest silhouette line at the foot of the mountains
  ctx.fillStyle = '#04110b';
  for (let x = -20; x < W + 20; x += 14) {
    const h2 = 18 + Math.random() * 58;
    const w2 = 10 + Math.random() * 16;
    ctx.beginPath();
    ctx.moveTo(x - w2 / 2, HORIZON + 6);
    ctx.lineTo(x, HORIZON - h2);
    ctx.lineTo(x + w2 / 2, HORIZON + 6);
    ctx.closePath();
    ctx.fill();
  }

  // mist band hugging the horizon
  g = ctx.createLinearGradient(0, HORIZON - H * 0.025, 0, HORIZON + H * 0.02);
  g.addColorStop(0, 'rgba(140,210,160,0)');
  g.addColorStop(0.5, 'rgba(140,210,160,0.09)');
  g.addColorStop(1, 'rgba(140,210,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, HORIZON - H * 0.03, W, H * 0.06);

  // pole vignettes
  const vg = ctx.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, 'rgba(0,0,0,0.5)');
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

/** Dark flagstone paving with moss and a rare gilt fleck — the arena floor the
 *  table stands on. Tiles seamlessly (stones wrap across the x edge; rows fit
 *  the y edge exactly). */
export function stoneFloorTexture(): THREE.Texture {
  const hit = cache.get('stoneFloor');
  if (hit) return hit;
  const S = 1024;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#0a130d';
  ctx.fillRect(0, 0, S, S);
  const shades = ['#0d1912', '#0f1c14', '#0b150f', '#101f16', '#0e1a11'];
  const rows = 6;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = -Math.random() * 80;
    while (x < S) {
      const w = 120 + Math.random() * 150;
      const shade = shades[(Math.random() * shades.length) | 0];
      for (const ox of [0, S]) {
        // draw at x and x+S so stones crossing the left edge wrap to the right
        const sg = ctx.createLinearGradient(x + ox, r * rh, x + ox + w, r * rh + rh);
        sg.addColorStop(0, shade);
        sg.addColorStop(1, '#0a140e');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.roundRect(x + ox + 3, r * rh + 3, w - 6, rh - 6, 10);
        ctx.fill();
      }
      x += w;
    }
  }
  // moss patches (drawn with wrap copies so the tile edge stays seamless)
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 20 + Math.random() * 70;
    for (const ox of [0, -S, S]) {
      for (const oy of [0, -S, S]) {
        const mg = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        mg.addColorStop(0, `rgba(38,84,54,${0.05 + Math.random() * 0.09})`);
        mg.addColorStop(1, 'rgba(38,84,54,0)');
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // grain + the odd gilt fleck
  for (let i = 0; i < 5000; i++) {
    const v = 6 + ((Math.random() * 26) | 0);
    ctx.fillStyle = `rgba(${v},${v + 10},${v + 4},${Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  }
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgba(190,160,90,${0.04 + Math.random() * 0.08})`;
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
