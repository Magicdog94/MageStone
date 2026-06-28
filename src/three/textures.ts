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

// ---- Dice faces ----------------------------------------------------------

const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

// Warrior = red, Mage = blue, Priest = green (no kind symbols — colour alone).
const DIE_STYLE = {
  mage: { face: '#2f5fb0', pip: '#eef4ff', edge: '#21407a' },
  priest: { face: '#2e8b57', pip: '#ecfaf1', edge: '#1f603c' },
  warrior: { face: '#b23636', pip: '#f7efe3', edge: '#7d2424' },
} as const;

export type DiceKind = keyof typeof DIE_STYLE;

/** BoxGeometry face order [+x,-x,+y,-y,+z,-z] with opposite faces summing to 7. */
export const FACE_VALUES = [1, 6, 2, 5, 3, 4];

function pipFace(value: number, kind: DiceKind): THREE.Texture {
  const key = `die-${kind}-${value}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 128;
  const [c, ctx] = canvas(S);
  const st = DIE_STYLE[kind];
  // rounded face with a subtle inset border
  ctx.fillStyle = st.edge;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = st.face;
  const m = 8;
  ctx.fillRect(m, m, S - 2 * m, S - 2 * m);
  ctx.fillStyle = st.pip;
  for (const [cx, cy] of PIP_LAYOUT[value]) {
    const x = (0.24 + cx * 0.26) * S;
    const y = (0.24 + cy * 0.26) * S;
    ctx.beginPath();
    ctx.arc(x, y, S * 0.072, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c, key);
}

/** Six face textures for a die of `kind`, in BoxGeometry material order. */
export function diceFaceTextures(kind: DiceKind): THREE.Texture[] {
  return FACE_VALUES.map((v) => pipFace(v, kind));
}
