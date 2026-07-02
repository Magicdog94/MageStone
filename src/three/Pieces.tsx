import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { useFrame } from '@react-three/fiber';
import { Billboard, useAnimations, useGLTF } from '@react-three/drei';
import type { CombatResult, Unit, UnitKind } from '../game/types';
import { cellKey, sameCell } from '../game/board';
import { COLORS, TILE_SURFACE, cellToWorld } from './coords';
import { attackTargetIds, useGame, type DeathEvent } from '../store';
import { combatOdds, plannedAttackers } from '../game/rules';
import { useTokens, type TokenKind } from './tokens';

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

// Semantic animation states the unit can be in. When a GLB ships skeletal clips,
// these map (fuzzily, by name) to its clips; otherwise the procedural motion in
// UnitPiece / DyingUnit drives the whole body instead.
export type UnitAnim = 'idle' | 'walk' | 'attack' | 'death';
const CLIP_ALIASES: Record<UnitAnim, string[]> = {
  idle: ['idle', 'breath', 'stand', 'rest'],
  walk: ['walk', 'run', 'move'],
  attack: ['attack', 'strike', 'swing', 'slash', 'cast'],
  death: ['death', 'die', 'dead', 'fall', 'collapse'],
};

/** Pick the action whose clip name best matches a semantic state (case-insensitive). */
function pickAction(
  actions: Record<string, THREE.AnimationAction | null>,
  anim: UnitAnim,
): THREE.AnimationAction | null {
  const names = Object.keys(actions);
  if (names.length === 0) return null;
  for (const alias of CLIP_ALIASES[anim]) {
    const hit = names.find((n) => n.toLowerCase().includes(alias));
    if (hit && actions[hit]) return actions[hit];
  }
  // Fall back to the first clip for idle so a rigged model still shows life.
  return anim === 'idle' ? actions[names[0]] : null;
}


/** Procedural strike pose over a normalised attack timeline lt∈[0,1]: wind back,
 *  thrust forward (toward the faced target) with a pitch, then recover. */
function attackPose(lt: number): { z: number; pitch: number; y: number } {
  if (lt < 0.26) {
    const u = lt / 0.26; // wind up — lean back, slight crouch
    return { z: -0.14 * u, pitch: -0.13 * u, y: -0.05 * u };
  }
  if (lt < 0.46) {
    const u = easeOutCubic((lt - 0.26) / 0.2); // strike — thrust forward + pitch
    return { z: -0.14 + 0.6 * u, pitch: -0.13 + 0.5 * u, y: -0.05 + 0.05 * u };
  }
  const u = easeOutCubic((lt - 0.46) / 0.54); // recover to neutral
  return { z: 0.46 * (1 - u), pitch: 0.37 * (1 - u), y: 0 };
}

const MODEL_URL: Record<UnitKind, string> = {
  mage: '/models/mage.glb',
  warrior: '/models/warrior.glb',
  priest: '/models/priest.glb',
};

// Every unit is normalised into the SAME box so they all read as one size with
// an identical base footprint: the model's base (its lowest slice) is scaled to
// TARGET_BASE Ø and its height to TARGET_HEIGHT. Horizontal scale stays uniform
// (no left-right squish) — only each sculpt's height/width ratio is nudged to a
// shared value, which is what makes the differently-proportioned sculpts (e.g.
// the stout Priest vs the lanky Mage) end up the same size on the board.
const TARGET_HEIGHT = 1.2; // standing height, in board cells
const TARGET_BASE = 0.8; // base diameter, in board cells (< 1 leaves a tile margin)

// Extra yaw per model to align its built-in forward axis to +Z (world), so that
// combined with FACING_YAW the unit looks into the board. Tuned per sculpt:
// all three sculpts share a forward axis, so 0 makes them look inward.
const MODEL_FORWARD: Record<UnitKind, number> = {
  mage: 0,
  warrior: 0,
  priest: 0,
};

// Inward-facing yaw per board *seat* (quarter-turns from the top), so every unit
// faces the centre regardless of which colour occupies the seat. Seats are
// decoupled from colour, so this must key off `GameState.seats`, not the colour.
const SEAT_YAW = [
  0, // 0 top edge → face +Z (into the board)
  -Math.PI / 2, // 1 right edge → face -X
  Math.PI, // 2 bottom edge → face -Z
  Math.PI / 2, // 3 left edge → face +X
];
const seatYaw = (seat: number | undefined) => SEAT_YAW[seat ?? 0] ?? 0;

// Units are tinted a single flat team colour (see StaticGLB). The source sculpts
// are a single untextured mesh, so one clean team-coloured PBR material reads best.

interface ModelMetrics {
  cx: number; // footprint centre X (scale 1)
  cz: number; // footprint centre Z (scale 1)
  minY: number; // lowest point Y (feet, scale 1)
  height: number; // total height (scale 1)
  baseDia: number; // base footprint diameter = max(baseX, baseZ) (scale 1)
}

// Per-sculpt metrics are intrinsic to the geometry, so measure once and reuse
// across every instance/team (the Priest mesh is ~230k verts — only walked once).
const metricsCache = new Map<string, ModelMetrics>();

/** Measure a model at scale 1: footprint centre, height, and base diameter. The
 *  "base" is the lowest 6% slice (the disc the unit stands on, ignoring weapons,
 *  outstretched arms, staves, etc. that inflate the full bounding box). */
function measureModel(root: THREE.Object3D, url: string): ModelMetrics {
  const hit = metricsCache.get(url);
  if (hit) return hit;

  const v = new THREE.Vector3();
  const pts: { x: number; z: number; y: number }[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      pts.push({ x: v.x, z: v.z, y: v.y });
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  });
  const height = maxY - minY || 1;
  const thresh = minY + height * 0.06; // lowest 6% = the base
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let n = 0;
  for (const p of pts) {
    if (p.y > thresh) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    n++;
  }
  let metrics: ModelMetrics;
  if (n === 0) {
    const b = new THREE.Box3().setFromObject(root);
    metrics = {
      cx: (b.min.x + b.max.x) / 2,
      cz: (b.min.z + b.max.z) / 2,
      minY: b.min.y,
      height,
      baseDia: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) || 1,
    };
  } else {
    metrics = {
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      minY,
      height,
      baseDia: Math.max(maxX - minX, maxZ - minZ) || 1,
    };
  }
  metricsCache.set(url, metrics);
  return metrics;
}

// ---- Procedural miniature paint job ---------------------------------------
// The sculpts are single untextured meshes (no parts, no UVs on the priest), so
// the painted-miniature look is baked into vertex colours from the geometry
// itself: a team-coloured base coat under zenithal light, darkened folds in the
// crevices, gold edge-highlights along raised trim (the classic tabletop paint
// recipe from the box-art miniatures), and a leather band at a robed sculpt's
// feet. Every team gets the same recipe with its own colour swapped in.

interface SculptAnalysis {
  conv: Float32Array; // per-vertex convexity: + on ridges, − in cavities
  height: Float32Array; // per-vertex normalised height 0..1
}
// Analysis is intrinsic to the sculpt (keyed by source-geometry uuid — clones
// share geometry); painted geometries are cached per sculpt + team colour.
const analysisCache = new Map<string, SculptAnalysis>();
const paintedCache = new Map<string, THREE.BufferGeometry>();

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Measure per-vertex convexity + height. Duplicated (seam) vertices are welded
 *  by position so curvature sees the true surface neighbourhood; the dot of each
 *  outgoing edge with the vertex normal is scale-free, so one threshold set
 *  works for every sculpt. Runs once per sculpt for the app's lifetime. */
function analyseSculpt(geo: THREE.BufferGeometry): SculptAnalysis {
  const hit = analysisCache.get(geo.uuid);
  if (hit) return hit;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const n = pos.count;
  const rep = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    const r = seen.get(k);
    if (r === undefined) {
      seen.set(k, i);
      rep[i] = i;
    } else rep[i] = r;
  }
  const sum = new Float32Array(n);
  const cnt = new Float32Array(n);
  const edge = (a: number, b: number) => {
    const ra = rep[a];
    const rb = rep[b];
    if (ra === rb) return;
    const dx = pos.getX(rb) - pos.getX(ra);
    const dy = pos.getY(rb) - pos.getY(ra);
    const dz = pos.getZ(rb) - pos.getZ(ra);
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) return;
    sum[ra] += (dx * nor.getX(ra) + dy * nor.getY(ra) + dz * nor.getZ(ra)) / len;
    cnt[ra]++;
  };
  const idx = geo.index;
  const total = idx ? idx.count : n;
  for (let t = 0; t + 2 < total; t += 3) {
    const a = idx ? idx.getX(t) : t;
    const b = idx ? idx.getX(t + 1) : t + 1;
    const c = idx ? idx.getX(t + 2) : t + 2;
    edge(a, b);
    edge(b, a);
    edge(b, c);
    edge(c, b);
    edge(a, c);
    edge(c, a);
  }
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const h = Math.max(1e-6, bb.max.y - bb.min.y);
  const conv = new Float32Array(n);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rep[i];
    conv[i] = cnt[r] > 0 ? -sum[r] / cnt[r] : 0;
    height[i] = (pos.getY(i) - bb.min.y) / h;
  }
  const out = { conv, height };
  analysisCache.set(geo.uuid, out);
  return out;
}

const PAINT_GOLD = new THREE.Color('#d8b46a');
const PAINT_LEATHER = new THREE.Color('#3f2d1c');

/** Bake the team paint job into a clone of the sculpt's geometry. */
function paintedGeometry(src: THREE.BufferGeometry, kind: UnitKind, colorHex: string): THREE.BufferGeometry {
  const key = `${src.uuid}|${colorHex}`;
  const hit = paintedCache.get(key);
  if (hit) return hit;
  const { conv, height } = analyseSculpt(src);
  const geo = src.clone();
  const n = (geo.attributes.position as THREE.BufferAttribute).count;
  const team = new THREE.Color(colorHex);
  // Every sculpt wears the same team-liveried steel — dark armour tones pulled
  // toward the team colour — so warriors, priests and mages read as one
  // consistently painted set (per the box minis).
  const base = new THREE.Color('#3e434b').lerp(team, 0.3);
  const dark = new THREE.Color('#211d1a'); // the mini's plain dark base disc
  let seed = 123456789;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const arr = new Float32Array(n * 3);
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    col.copy(base);
    col.multiplyScalar(0.6 + 0.4 * Math.pow(height[i], 0.9)); // zenithal light
    if (kind !== 'warrior' && height[i] < 0.14) {
      col.lerp(PAINT_LEATHER, 0.6 * (1 - height[i] / 0.14)); // leather boots band
    }
    const cv = conv[i];
    if (cv > 0) {
      col.lerp(PAINT_GOLD, 0.9 * smoothstep(0.12, 0.4, cv)); // gold edge trim
    } else {
      col.multiplyScalar(1 - 0.6 * smoothstep(0.08, 0.35, -cv)); // shaded folds
    }
    // The sculpt's own base (a taller rocky mound on the warrior, a thicker
    // disc on the robed sculpts) is painted the SAME plain dark on every kind,
    // so all units stand on identical-looking dark bases.
    const baseBand = kind === 'warrior' ? 0.12 : 0.09;
    if (height[i] < baseBand) col.lerp(dark, 0.92);
    const nz = (rand() - 0.5) * 0.05; // paint mottle
    arr[i * 3] = Math.min(1, Math.max(0, col.r + nz));
    arr[i * 3 + 1] = Math.min(1, Math.max(0, col.g + nz));
    arr[i * 3 + 2] = Math.min(1, Math.max(0, col.b + nz));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  paintedCache.set(key, geo);
  return geo;
}

/** The painted-miniature material: the baked vertex paint under a clearcoat
 *  glaze. One finish for every sculpt (the warrior's armoured look), so the
 *  whole team reads as one consistently painted set. */
function miniatureMaterial(colorHex: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.4,
    metalness: 0.45,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
    sheen: 0.15,
    sheenColor: new THREE.Color('#d8c08a'),
    sheenRoughness: 0.6,
    envMapIntensity: 0.8,
    emissive: new THREE.Color(colorHex),
    emissiveIntensity: 0.05,
  });
}

const urlKind = (url: string): UnitKind =>
  (Object.keys(MODEL_URL) as UnitKind[]).find((k) => MODEL_URL[k] === url) ?? 'warrior';

/**
 * Static (un-rigged) sculpt path: clones per instance, swaps in the team-painted
 * geometry + painted-miniature material, and normalises every unit into one
 * uniform box (TARGET_BASE Ø, TARGET_HEIGHT), centred by footprint. Used when
 * the GLB has no skeletal clips.
 */
function StaticGLB({ url, color }: { url: string; color: string }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => {
    const kind = urlKind(url);
    const root = scene.clone(true);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.geometry = paintedGeometry(mesh.geometry as THREE.BufferGeometry, kind, color);
      mesh.material = miniatureMaterial(color);
    });
    // Uniform-box normalise. Horizontal scale equalises the base; vertical scale
    // equalises the height. Because the clone sits at the origin, its scale-1
    // metrics scale linearly — no second traversal needed to re-centre.
    const m = measureModel(root, url);
    const hScale = TARGET_BASE / m.baseDia;
    const vScale = TARGET_HEIGHT / m.height;
    root.scale.set(hScale, vScale, hScale);
    root.position.x = -m.cx * hScale;
    root.position.z = -m.cz * hScale;
    root.position.y = -m.minY * vScale;
    root.updateMatrixWorld(true);
    return root;
  }, [scene, color, url]);
  return <primitive object={object} />;
}

/**
 * Rigged sculpt path: clones the skinned hierarchy (SkeletonUtils, so the
 * skeleton is preserved), team-tints the materials WITHOUT touching geometry (so
 * skinning stays intact), normalises to the same box, and plays the clip that
 * matches the current semantic `anim`. Active only when the GLB ships clips.
 */
function AnimatedGLB({
  url,
  color,
  anim,
}: {
  url: string;
  color: string;
  anim: RefObject<UnitAnim>;
}) {
  const { scene, animations } = useGLTF(url);
  const object = useMemo(() => {
    const root = SkeletonUtils.clone(scene) as THREE.Object3D;
    root.updateMatrixWorld(true);
    const tint = new THREE.Color(color);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const src = mesh.material as THREE.MeshStandardMaterial;
      const mat = src.clone();
      // Tint toward the team colour (multiplies any baked texture map).
      mat.color = mat.map ? mat.color.clone().lerp(tint, 0.45) : tint.clone();
      mesh.material = mat;
    });
    const m = measureModel(root, url);
    const hScale = TARGET_BASE / m.baseDia;
    const vScale = TARGET_HEIGHT / m.height;
    root.scale.set(hScale, vScale, hScale);
    root.position.set(-m.cx * hScale, -m.minY * vScale, -m.cz * hScale);
    root.updateMatrixWorld(true);
    return root;
  }, [scene, color, url]);

  const { actions } = useAnimations(animations, object);
  const current = useRef<THREE.AnimationAction | null>(null);
  const currentAnim = useRef<UnitAnim | null>(null);
  // Start idle once the clips are bound.
  useEffect(() => {
    const idle = pickAction(actions, 'idle');
    if (idle) {
      idle.reset().fadeIn(0.2).play();
      current.current = idle;
      currentAnim.current = 'idle';
    }
  }, [actions]);
  // Poll the desired anim each frame and crossfade when it changes (the anim is a
  // ref so attack/death pulses never trigger React re-renders).
  useFrame(() => {
    const a = anim.current ?? 'idle';
    if (a === currentAnim.current) return;
    currentAnim.current = a;
    const want = pickAction(actions, a) ?? pickAction(actions, 'idle');
    if (!want || want === current.current) return;
    current.current?.fadeOut(0.18);
    want.reset().fadeIn(0.18).play();
    if (a === 'attack' || a === 'death') {
      want.setLoop(THREE.LoopOnce, 1);
      want.clampWhenFinished = true;
    } else {
      want.setLoop(THREE.LoopRepeat, Infinity);
    }
    current.current = want;
  });

  return <primitive object={object} />;
}

/** Dispatch to the rigged path when the GLB has clips, else the static path. */
function GLBUnit({
  url,
  color,
  anim,
}: {
  url: string;
  color: string;
  anim: RefObject<UnitAnim>;
}) {
  const { animations } = useGLTF(url);
  return animations.length > 0 ? (
    <AnimatedGLB url={url} color={color} anim={anim} />
  ) : (
    <StaticGLB url={url} color={color} />
  );
}

// ---- Three distinct unit sculpts (team-tinted GLBs) ---------------------

function Warrior({ color, anim }: { color: string; anim: RefObject<UnitAnim> }) {
  // Team-tinted "Knight" GLB sculpt.
  return <GLBUnit url={MODEL_URL.warrior} color={color} anim={anim} />;
}

function Mage({ color, carried, anim }: { color: string; carried: number; anim: RefObject<UnitAnim> }) {
  // Team-tinted "Arcane Wanderer" GLB sculpt + orbiting carried MageStones.
  const orbs = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (orbs.current) orbs.current.rotation.y += dt * 0.8;
  });
  return (
    <group>
      <GLBUnit url={MODEL_URL.mage} color={color} anim={anim} />
      {/* carried MageStones orbit the mage */}
      <group ref={orbs} position={[0, 0.95, 0]}>
        {Array.from({ length: Math.min(carried, 6) }).map((_, i) => {
          const a = (i / Math.min(Math.max(carried, 1), 6)) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.5, 0.1 * Math.sin(a * 2), Math.sin(a) * 0.5]}>
              <octahedronGeometry args={[0.06]} />
              <meshStandardMaterial color={'#7fe7c4'} emissive={'#39d98a'} emissiveIntensity={1} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function Priest({ color, anim }: { color: string; anim: RefObject<UnitAnim> }) {
  // Team-tinted "Priest" GLB sculpt.
  return <GLBUnit url={MODEL_URL.priest} color={color} anim={anim} />;
}

const MESH: Record<
  UnitKind,
  (p: { color: string; carried: number; anim: RefObject<UnitAnim> }) => React.ReactNode
> = {
  warrior: ({ color, anim }) => <Warrior color={color} anim={anim} />,
  mage: ({ color, carried, anim }) => <Mage color={color} carried={carried} anim={anim} />,
  priest: ({ color, anim }) => <Priest color={color} anim={anim} />,
};

/** Does this kind's GLB ship skeletal clips? If so the clips drive the body and
 *  we suppress the procedural motion; otherwise procedural transforms animate it. */
function useHasClips(kind: UnitKind): boolean {
  return useGLTF(MODEL_URL[kind]).animations.length > 0;
}

// Square selection frame (matches the tile shape), shared across all pieces.
const SELECT_FRAME = (() => {
  const o = 0.46;
  const i = 0.37;
  const shape = new THREE.Shape();
  shape.moveTo(-o, -o);
  shape.lineTo(o, -o);
  shape.lineTo(o, o);
  shape.lineTo(-o, o);
  shape.lineTo(-o, -o);
  const hole = new THREE.Path();
  hole.moveTo(-i, -i);
  hole.lineTo(i, -i);
  hole.lineTo(i, i);
  hole.lineTo(-i, i);
  hole.lineTo(-i, -i);
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape);
})();


// Canvas-text textures for the "win %" badge — cached per value (no font CDN).
const pctTexCache = new Map<number, THREE.CanvasTexture>();
function pctTexture(pct: number): THREE.CanvasTexture {
  const hit = pctTexCache.get(pct);
  if (hit) return hit;
  const W = 168;
  const H = 88;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const x = 6;
  const y = 16;
  const w = W - 12;
  const h = H - 32;
  const r = 22;
  ctx.fillStyle = 'rgba(8,10,12,0.86)';
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
  ctx.fillStyle = pct >= 60 ? '#7fe6a0' : pct >= 35 ? '#e8c14a' : '#ef6a5a';
  ctx.font = 'bold 46px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${pct}%`, W / 2, H / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  pctTexCache.set(pct, tex);
  return tex;
}

/** Floating "chance of victory" badge shown above a unit you could attack. */
function WinLabel({ y, pct }: { y: number; pct: number }) {
  const tex = useMemo(() => pctTexture(pct), [pct]);
  return (
    <Billboard position={[0, y, 0]}>
      <mesh renderOrder={30}>
        <planeGeometry args={[0.74, 0.39]} />
        <meshBasicMaterial map={tex} transparent depthTest={false} />
      </mesh>
    </Billboard>
  );
}

function UnitPiece({ unit }: { unit: Unit }) {
  const game = useGame((s) => s.game);
  const selectedUnitId = useGame((s) => s.selectedUnitId);
  const selectUnit = useGame((s) => s.selectUnit);
  const attack = useGame((s) => s.attack);
  const setHovered = useGame((s) => s.setHovered);
  const online = useGame((s) => s.online);
  const myColor = useGame((s) => s.myColor);

  const selected = selectedUnitId === unit.id;
  const bots = useGame((s) => s.bots);
  // Online: only your own colour's pieces are interactive (and only on your
  // turn). Bot-owned pieces are never human-clickable — the BotDriver moves them.
  const isCurrent =
    game.current === unit.owner && !bots[unit.owner] && (!online || unit.owner === myColor);
  const isTarget = useMemo(
    () => attackTargetIds(game, selectedUnitId).has(unit.id),
    [game, selectedUnitId, unit.id],
  );
  // Pre-attack chance of victory for the attack the selected unit would launch.
  const winPct = useMemo(() => {
    if (!isTarget || !selectedUnitId) return null;
    const ids = plannedAttackers(game, selectedUnitId, unit.id);
    if (ids.length === 0) return null;
    return Math.round(combatOdds(game, ids, unit.id).win * 100);
  }, [isTarget, selectedUnitId, game, unit.id]);

  const ref = useRef<THREE.Group>(null);
  const outer = useRef<THREE.Group>(null);
  const inited = useRef(false);
  const yawInited = useRef(false);
  const lungeStart = useRef(-1e9); // attacker thrust timestamp
  const flinchStart = useRef(-1e9); // defender stagger timestamp
  // Sit the unit on TOP of any disk stack on its square (so the base never sinks
  // into a stone/gravestone) — one disk-height per token at the cell.
  const tokenLift = useMemo(() => {
    let n = 0;
    for (const st of game.stones) if (!st.collected && sameCell(st.cell, unit.cell)) n++;
    for (const g of game.gravestones) if (sameCell(g.cell, unit.cell)) n++;
    return n * DISK_H;
  }, [game.stones, game.gravestones, unit.cell]);
  const target = cellToWorld(unit.cell, TILE_SURFACE + tokenLift);
  const facingY = seatYaw(game.seats[unit.owner]) + MODEL_FORWARD[unit.kind];

  // If the GLB has skeletal clips, they drive the body; else procedural motion.
  const hasClips = useHasClips(unit.kind);
  // Desired clip state, held in a ref (polled per frame by AnimatedGLB) so the
  // transient attack pulse never causes React re-renders.
  const anim = useRef<UnitAnim>('idle');
  const animRevert = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (animRevert.current) clearTimeout(animRevert.current);
    },
    [],
  );

  // Trigger the strike/flinch (and the 'attack' clip) on each new combat.
  useEffect(() => {
    const c = game.lastCombat;
    if (!c) return;
    if (c.attackerIds.includes(unit.id)) {
      lungeStart.current = performance.now();
      anim.current = 'attack';
      if (animRevert.current) clearTimeout(animRevert.current);
      animRevert.current = setTimeout(() => {
        anim.current = 'idle';
      }, 620);
    } else if (c.defenderId === unit.id && c.defeatedId !== unit.id) {
      flinchStart.current = performance.now();
    }
  }, [game.lastCombat, unit.id]);

  // Wizard-chess facing: while this unit is an attacker in the latest combat, it
  // turns to face the square it struck (kept until the turn ends), then eases
  // back to its default inward facing. atan2(Δc, Δr) maps a board direction to a
  // yaw whose 0 = +Z (matching FACING_YAW's convention).
  const combat = game.lastCombat;
  const isAttacker = !!combat && combat.attackerIds.includes(unit.id);
  const desiredYaw = isAttacker
    ? Math.atan2(combat!.defenderCell.c - unit.cell.c, combat!.defenderCell.r - unit.cell.r) +
      MODEL_FORWARD[unit.kind]
    : facingY;

  useFrame((_, dt) => {
    const o = outer.current;
    if (o) {
      if (!inited.current) {
        o.position.set(target[0], target[1], target[2]);
        inited.current = true;
      } else {
        // frame-rate-independent ease toward the unit's cell (smooth glide)
        const a = 1 - Math.pow(0.0015, dt);
        o.position.x += (target[0] - o.position.x) * a;
        o.position.y += (target[1] - o.position.y) * a;
        o.position.z += (target[2] - o.position.z) * a;
      }
    }
    const r = ref.current;
    if (r) {
      // Ease the facing toward desiredYaw along the shortest angular path (always,
      // even for rigged models — facing is placement, not body animation).
      if (!yawInited.current) {
        r.rotation.y = desiredYaw;
        yawInited.current = true;
      } else {
        const wrap = Math.atan2(
          Math.sin(desiredYaw - r.rotation.y),
          Math.cos(desiredYaw - r.rotation.y),
        );
        r.rotation.y += wrap * (1 - Math.pow(0.0009, dt));
      }

      const raise = selected ? 0.14 : 0;
      let py = raise;
      let pz = 0;
      let rx = 0;
      let rz = 0;
      if (!hasClips) {
        // Procedural full-body motion (the clips would do this on a rigged model).
        // Units stand stationary when idle (no hover); only motion is event-driven.
        const now = performance.now();
        const tt = now / 1000;
        // Walk bob + forward lean while gliding between cells.
        if (o) {
          const dx = target[0] - o.position.x;
          const dz = target[2] - o.position.z;
          if (dx * dx + dz * dz > 0.012) {
            py += Math.abs(Math.sin(tt * 11)) * 0.05;
            rx += 0.08;
          }
        }
        // Attack: wind-up → strike → recover.
        const lt = (now - lungeStart.current) / 560;
        if (lt >= 0 && lt < 1) {
          const p = attackPose(lt);
          pz += p.z;
          rx += p.pitch;
          py += p.y;
        }
        // Defender stagger: back-step, dip and a damped lean.
        const ft = (now - flinchStart.current) / 460;
        if (ft >= 0 && ft < 1) {
          py -= 0.12 * Math.sin(Math.PI * ft);
          pz -= 0.1 * Math.sin(Math.PI * ft);
          rz += Math.sin(ft * Math.PI * 3) * 0.3 * (1 - ft);
        }
      }
      r.position.y += (py - r.position.y) * 0.35;
      r.position.z += (pz - r.position.z) * 0.45;
      r.rotation.x += (rx - r.rotation.x) * 0.45;
      r.rotation.z += (rz - r.rotation.z) * 0.45;
    }
  });

  return (
    <group ref={outer}>
      <group
        ref={ref}
        onClick={(e) => {
          e.stopPropagation();
          if (isTarget) attack(unit.id);
          else if (isCurrent) selectUnit(selected ? null : unit.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(unit.id);
          if (isCurrent || isTarget) document.body.style.cursor = isTarget ? 'crosshair' : 'pointer';
        }}
        onPointerOut={() => {
          setHovered(null);
          document.body.style.cursor = 'auto';
        }}
      >
        {/* gilt miniature pedestal — emerald marble puck with a gold rim */}
        <mesh castShadow receiveShadow position={[0, 0.035, 0]}>
          <cylinderGeometry args={[0.345, 0.385, 0.07, 28]} />
          <meshStandardMaterial color="#122018" roughness={0.45} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.073, 0]}>
          <cylinderGeometry args={[0.36, 0.36, 0.018, 28]} />
          <meshStandardMaterial
            color="#caa85e"
            metalness={0.85}
            roughness={0.3}
            emissive="#5a3f12"
            emissiveIntensity={0.2}
          />
        </mesh>
        <group position={[0, 0.082, 0]}>
          {MESH[unit.kind]({ color: COLORS[unit.owner], carried: unit.carried, anim })}
        </group>
      </group>
      {selected && (
        <mesh geometry={SELECT_FRAME} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color={'#ffd54a'} transparent opacity={0.95} />
        </mesh>
      )}
      {isTarget && (
        <mesh position={[0, 1.7, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.16, 0.3, 4]} />
          <meshBasicMaterial color={'#ff5a4d'} />
        </mesh>
      )}
      {isTarget && winPct !== null && <WinLabel y={TARGET_HEIGHT + 0.95} pct={winPct} />}
    </group>
  );
}

export function Units() {
  const units = useGame((s) => s.game.units);
  return (
    <group>
      {units.map((u) => (
        <UnitPiece key={u.id} unit={u} />
      ))}
    </group>
  );
}

// ---- MageStones & gravestones as solid, stacking coin-chips --------------

const DISK_H = 0.08; // thin chip — only a hairline edge shows
const DISK_R = TARGET_BASE / 2; // exactly the unit-base radius, so they align
// The coin is re-centred to fill its texture; size the decal so it spans the
// whole disk and drapes a touch past the edge → no metal rim shows on top.
const DECAL = DISK_R * 2 * 1.08;
// Edge colour matched to each coin (low metalness + emissive so it stays that
// hue instead of reflecting the scene as grey/silver).
const SIDE_COLOR: Record<TokenKind, string> = {
  activated: '#b8902f', // gold
  unactivated: '#9aa0a6', // silver
  gravestone: '#33363b', // dark iron
};

/** A solid coin-chip the size of a unit base: a short metal cylinder with the
 *  background-keyed coin cut-out laid flat on top as a decal (no white, full
 *  coin, centred). It rests on its square (gravity) and is lifted by
 *  `stackIndex × height` so a gravestone + MageStone(s) stack. Gravestones pop in. */
function TokenDisk({
  cell,
  kind,
  texture,
  stackIndex,
  grow,
}: {
  cell: Unit['cell'];
  kind: TokenKind;
  texture: THREE.Texture;
  stackIndex: number;
  grow: boolean;
}) {
  const grp = useRef<THREE.Group>(null);
  const start = useRef(0);
  const base = cellToWorld(cell, TILE_SURFACE);
  const y = base[1] + DISK_H / 2 + stackIndex * DISK_H;
  useFrame(() => {
    if (!grow || !grp.current) return;
    if (!start.current) start.current = performance.now();
    const t = (performance.now() - start.current - 480) / 340; // delay, then grow
    grp.current.scale.setScalar(t <= 0 ? 0.0001 : t >= 1 ? 1 : Math.max(0.0001, easeOutBack(t)));
  });
  return (
    <group ref={grp} position={[base[0], y, base[2]]} scale={grow ? 0 : 1}>
      {/* solid metal chip body — low metalness + matching emissive so the edge
          keeps its colour (gold/silver/iron) instead of mirroring the scene */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[DISK_R, DISK_R, DISK_H, 48]} />
        <meshStandardMaterial
          color={SIDE_COLOR[kind]}
          roughness={0.55}
          metalness={0.15}
          emissive={SIDE_COLOR[kind]}
          emissiveIntensity={0.2}
        />
      </mesh>
      {/* coin cut-out laid flat on the top face (unlit so it reads like the photo) */}
      <mesh position={[0, DISK_H / 2 + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[DECAL, DECAL]} />
        <meshBasicMaterial map={texture} transparent alphaTest={0.5} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** All board tokens, grouped per square so a gravestone + MageStone(s) stack
 *  (gravestone on the bottom, stones above). */
export function BoardTokens() {
  const stones = useGame((s) => s.game.stones);
  const graves = useGame((s) => s.game.gravestones);
  const tokens = useTokens();
  type Item = { id: string; kind: TokenKind; cell: Unit['cell']; grow: boolean };
  const stacks = useMemo(() => {
    const m = new Map<string, Item[]>();
    const add = (cell: Unit['cell'], item: Item) => {
      const k = cellKey(cell);
      const a = m.get(k) ?? [];
      a.push(item);
      m.set(k, a);
    };
    for (const g of graves) add(g.cell, { id: g.id, kind: 'gravestone', cell: g.cell, grow: true });
    for (const s of stones)
      if (!s.collected)
        add(s.cell, { id: s.id, kind: s.activated ? 'activated' : 'unactivated', cell: s.cell, grow: false });
    return m;
  }, [stones, graves]);

  if (!tokens) return null;
  const disks: ReactNode[] = [];
  for (const items of stacks.values()) {
    items.forEach((it, i) =>
      disks.push(
        <TokenDisk key={it.id} cell={it.cell} kind={it.kind} texture={tokens[it.kind]} stackIndex={i} grow={it.grow} />,
      ),
    );
  }
  return <group>{disks}</group>;
}

/** A defeated unit toppling to the ground then sinking away, played at the square
 *  where it fell (the engine has already removed the real unit). */
function DyingUnit({ ev, onDone }: { ev: DeathEvent & { nonce: number }; onDone: (n: number) => void }) {
  const seat = useGame((s) => s.game.seats[ev.owner]);
  const inner = useRef<THREE.Group>(null);
  const start = useRef(0);
  const done = useRef(false);
  const deathAnim = useRef<UnitAnim>('death');
  const pos = cellToWorld(ev.cell, TILE_SURFACE);
  // With a rigged 'death' clip the clip poses the fall; we only need to hold the
  // ghost on screen, then fade it. Without clips, procedurally topple + sink.
  const hasClips = useHasClips(ev.kind);
  useFrame(() => {
    const g = inner.current;
    if (!g || done.current) return;
    if (!start.current) start.current = performance.now();
    const t = Math.min(1, (performance.now() - start.current) / 950);
    if (!hasClips) {
      const topple = Math.min(1, t / 0.6); // fall over during the first 60%
      g.rotation.x = -(Math.PI / 2) * easeOutCubic(topple);
      const sink = t > 0.6 ? (t - 0.6) / 0.4 : 0; // then sink + shrink away
      g.position.y = -0.18 * sink;
      g.scale.setScalar(Math.max(0.0001, 1 - 0.96 * sink));
    } else {
      const fade = t > 0.7 ? (t - 0.7) / 0.3 : 0; // let the clip play, then shrink out
      g.scale.setScalar(Math.max(0.0001, 1 - 0.96 * fade));
    }
    if (t >= 1) {
      done.current = true;
      onDone(ev.nonce);
    }
  });
  return (
    <group position={pos} rotation={[0, seatYaw(seat), 0]}>
      <group ref={inner}>{MESH[ev.kind]({ color: COLORS[ev.owner], carried: 0, anim: deathAnim })}</group>
    </group>
  );
}

export function DeathAnimations() {
  const lastDeath = useGame((s) => s.lastDeath);
  const deathNonce = useGame((s) => s.deathNonce);
  const [list, setList] = useState<(DeathEvent & { nonce: number })[]>([]);
  const seen = useRef(0);
  useEffect(() => {
    if (!lastDeath || deathNonce === seen.current) return;
    seen.current = deathNonce;
    setList((l) => [...l, { ...lastDeath, nonce: deathNonce }]);
  }, [lastDeath, deathNonce]);
  const remove = (n: number) => setList((l) => l.filter((d) => d.nonce !== n));
  return (
    <group>
      {list.map((ev) => (
        <DyingUnit key={ev.nonce} ev={ev} onDone={remove} />
      ))}
    </group>
  );
}

/** A brief impact flash where attacker and defender meet — sells the sword clash. */
function Spark({ nonce, pos, onDone }: { nonce: number; pos: [number, number, number]; onDone: (n: number) => void }) {
  const ring = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const start = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    if (!start.current) start.current = performance.now();
    const t = Math.min(1, (performance.now() - start.current) / 320);
    if (ring.current) {
      ring.current.scale.setScalar(0.2 + t * 1.0);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
    }
    if (core.current) core.current.scale.setScalar((1 - t) * 0.6 + 0.04);
    if (light.current) light.current.intensity = (1 - t) * 6;
    if (t >= 1) {
      done.current = true;
      onDone(nonce);
    }
  });
  return (
    <group position={pos}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.18, 0.3, 24]} />
        <meshBasicMaterial
          color="#ffe6a0"
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.26, 0]} />
        <meshBasicMaterial
          color="#fff4d0"
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight ref={light} color="#ffd98a" distance={3.2} intensity={5} />
    </group>
  );
}

export function ClashEffect() {
  const combat = useGame((s) => s.game.lastCombat);
  const units = useGame((s) => s.game.units);
  const [list, setList] = useState<{ nonce: number; pos: [number, number, number] }[]>([]);
  const seen = useRef<CombatResult | null>(null);
  const nonce = useRef(0);
  useEffect(() => {
    if (!combat || combat === seen.current) return;
    seen.current = combat;
    // Contact point: midway between the defender's square and an attacker's.
    const dc = combat.defenderCell;
    const atk = units.find((u) => combat.attackerIds.includes(u.id));
    const ac = atk ? atk.cell : dc;
    const mid = { r: (ac.r + dc.r) / 2, c: (ac.c + dc.c) / 2 };
    const w = cellToWorld(mid, TILE_SURFACE + 0.55);
    const n = ++nonce.current;
    setList((l) => [...l, { nonce: n, pos: w }]);
  }, [combat, units]);
  const remove = (n: number) => setList((l) => l.filter((s) => s.nonce !== n));
  return (
    <group>
      {list.map((s) => (
        <Spark key={s.nonce} nonce={s.nonce} pos={s.pos} onDone={remove} />
      ))}
    </group>
  );
}

useGLTF.preload(MODEL_URL.mage);
useGLTF.preload(MODEL_URL.warrior);
useGLTF.preload(MODEL_URL.priest);
