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

// ---- Team banners -----------------------------------------------------------

export type BannerSymbol = 'swords' | 'tower' | 'tree' | 'sun';

function drawBannerSymbol(ctx: CanvasRenderingContext2D, symbol: BannerSymbol) {
  // Drawn in a local space centred on (0,0), roughly 300 units across, in gold
  // with a dark outline so it reads against any team colour.
  const gold = goldGradient(ctx, -150, -150, 150, 150);
  ctx.fillStyle = gold;
  ctx.strokeStyle = '#4a3610';
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';

  if (symbol === 'swords') {
    // two crossed swords, points up
    for (const s of [1, -1]) {
      ctx.save();
      ctx.rotate((s * 35 * Math.PI) / 180);
      ctx.beginPath(); // blade
      ctx.moveTo(0, -170);
      ctx.lineTo(16, -140);
      ctx.lineTo(16, 60);
      ctx.lineTo(-16, 60);
      ctx.lineTo(-16, -140);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(-52, 60, 104, 22); // guard
      ctx.strokeRect(-52, 60, 104, 22);
      ctx.fillRect(-11, 82, 22, 62); // grip
      ctx.strokeRect(-11, 82, 22, 62);
      ctx.beginPath(); // pommel
      ctx.arc(0, 162, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  } else if (symbol === 'tower') {
    // castle keep with battlements, arched door and windows
    ctx.beginPath();
    ctx.moveTo(-95, 160);
    ctx.lineTo(-95, -90);
    for (let i = 0; i < 4; i++) {
      const x = -95 + i * 47.5;
      ctx.lineTo(x, -90);
      ctx.lineTo(x, -130);
      ctx.lineTo(x + 28, -130);
      ctx.lineTo(x + 28, -90);
    }
    ctx.lineTo(95, -90);
    ctx.lineTo(95, 160);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // door + windows knocked out in the cloth's dark outline colour
    ctx.fillStyle = '#4a3610';
    ctx.beginPath();
    ctx.moveTo(-30, 160);
    ctx.lineTo(-30, 80);
    ctx.arc(0, 80, 30, Math.PI, 0);
    ctx.lineTo(30, 160);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-14, -60, 28, 44);
    ctx.fillRect(-58, 0, 24, 36);
    ctx.fillRect(34, 0, 24, 36);
  } else if (symbol === 'tree') {
    // great oak: trunk, roots and a three-lobed canopy
    ctx.beginPath();
    ctx.moveTo(-18, 150);
    ctx.lineTo(-12, 20);
    ctx.lineTo(12, 20);
    ctx.lineTo(18, 150);
    ctx.lineTo(46, 162);
    ctx.lineTo(-46, 162);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-58, -20, 55, 0, Math.PI * 2);
    ctx.arc(58, -20, 55, 0, Math.PI * 2);
    ctx.arc(0, -88, 62, 0, Math.PI * 2);
    ctx.arc(0, -18, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-58, -20, 55, Math.PI * 0.4, Math.PI * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(58, -20, 55, Math.PI * 1.5, Math.PI * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -88, 62, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  } else {
    // radiant sun: disc + twelve rays
    for (let i = 0; i < 12; i++) {
      ctx.save();
      ctx.rotate((i / 12) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(-16, -92);
      ctx.lineTo(0, -168);
      ctx.lineTo(16, -92);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** A hanging war banner in the team's colour: swallow-tailed cloth with a gold
 *  border and the team's heraldic symbol. Transparent outside the cloth. */
export function bannerTexture(colorHex: string, symbol: BannerSymbol): THREE.Texture {
  const key = `banner-${symbol}-${colorHex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = 512;
  const H = 768;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  // swallow-tailed cloth silhouette
  const cloth = () => {
    ctx.beginPath();
    ctx.moveTo(16, 12);
    ctx.lineTo(496, 12);
    ctx.lineTo(496, 730);
    ctx.lineTo(256, 596);
    ctx.lineTo(16, 730);
    ctx.closePath();
  };
  // team-coloured cloth with vertical shading
  const base = ctx.createLinearGradient(0, 0, 0, H);
  const teamCol = colorHex;
  base.addColorStop(0, teamCol);
  base.addColorStop(1, '#0e0d0b');
  cloth();
  ctx.fillStyle = teamCol;
  ctx.fill();
  cloth();
  ctx.save();
  ctx.clip();
  // darken toward the bottom + weave grain
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(255,255,255,0.14)');
  shade.addColorStop(0.35, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.035)';
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 1);
  }
  // vertical fold shadows
  for (const fx of [110, 250, 390]) {
    const fold = ctx.createLinearGradient(fx - 34, 0, fx + 34, 0);
    fold.addColorStop(0, 'rgba(0,0,0,0)');
    fold.addColorStop(0.5, 'rgba(0,0,0,0.16)');
    fold.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fold;
    ctx.fillRect(fx - 34, 0, 68, H);
  }
  ctx.restore();
  // gold border
  cloth();
  ctx.strokeStyle = goldGradient(ctx, 0, 0, W, H);
  ctx.lineWidth = 14;
  ctx.stroke();
  // hanging band at the top
  ctx.fillStyle = goldGradient(ctx, 0, 0, W, 60);
  ctx.fillRect(16, 12, 480, 34);
  // the heraldic symbol
  ctx.save();
  ctx.translate(W / 2, 300);
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 14;
  drawBannerSymbol(ctx, symbol);
  ctx.restore();

  return finish(c, key);
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
