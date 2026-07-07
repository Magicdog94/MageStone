// The room around the game: a medieval stone chamber, built to real
// proportions with the board treated as a REAL CHESSBOARD (~0.5 m across).
// Scale: the board is 16 world units ≈ 0.5 m → 1 m ≈ 32 units. Everything in
// here — walls, furniture, banners — is sized off that ruler. Only the wall
// banners are game-aware (one per PLAYING colour, hung behind that colour's
// seat).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard, useTexture } from '@react-three/drei';
import { RoundedBoxGeometry } from 'three-stdlib';
import type { PlayerColor } from '../game/types';
import { FLOOR_Y } from './coords';
import {
  bannerTexture,
  cobwebTexture,
  flameGlowTexture,
  lightShaftTexture,
  planksBumpTexture,
  planksTexture,
  plasterBumpTexture,
  plasterTexture,
  shadeGradientTexture,
  windowGlassTexture,
  windowLeadTexture,
  woodBumpTexture,
  type BannerTeam,
} from './textures';
import { useGame } from '../store';

// Bevelled box geometry cache — the antidote to the "perfect cube" look. Keyed
// by dimensions; radius scales with the smallest side.
const rboxCache = new Map<string, RoundedBoxGeometry>();
function rbox(w: number, h: number, d: number): RoundedBoxGeometry {
  const key = `${w}|${h}|${d}`;
  let g = rboxCache.get(key);
  if (!g) {
    const r = Math.min(w, h, d) * 0.12;
    g = new RoundedBoxGeometry(w, h, d, 2, r);
    rboxCache.set(key, g);
  }
  return g;
}

// ---- shared scale + materials ------------------------------------------------
const M = 32; // world units per metre (board = 16u ≈ 0.5 m, like a chessboard)
const CEIL_Y = FLOOR_Y + 2.8 * M; // 2.8 m ceiling
const WALL_X = 74; // wall centre planes (inner faces ≈ ±72 / ±88)
const WALL_Z = 90;

const IRON = { color: '#1d2023', roughness: 0.6, metalness: 0.5 } as const;
const STONE = { color: '#4c463e', roughness: 0.95, metalness: 0 } as const;

/** The real wood-grain photo (shared with the tabletop), cloned per use so each
 *  surface gets its own repeat — this is what stops the furniture reading as
 *  flat cartoon colour. `tint` multiplies the photo (darker/warmer variants). */
function useWoodMap(rx: number, ry: number): THREE.Texture {
  const base = useTexture('/wood-texture.png') as THREE.Texture;
  return useMemo(() => {
    const t = base.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  }, [base, rx, ry]);
}

/** Grained wood material (photo map + relief bump + tint). */
function WoodMat({ tint = '#a58860', rx = 0.6, ry = 0.6, rough = 0.8 }: { tint?: string; rx?: number; ry?: number; rough?: number }) {
  const map = useWoodMap(rx, ry);
  const bump = useMemo(() => {
    const t = woodBumpTexture().clone();
    t.repeat.set(rx * 4, ry * 4);
    t.needsUpdate = true;
    return t;
  }, [rx, ry]);
  return <meshStandardMaterial map={map} bumpMap={bump} bumpScale={0.05} color={tint} roughness={rough} metalness={0} />;
}

// ---- small parts ---------------------------------------------------------------

/** A warm point light with candle flicker (each keeps its own clock). */
function FlickerLight({
  base,
  seed,
  position,
  color,
  distance,
  decay,
}: {
  base: number;
  seed: number;
  position: [number, number, number];
  color: string;
  distance: number;
  decay: number;
}) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ref.current) {
      ref.current.intensity =
        base * (1 + 0.14 * Math.sin(t * 7.3 + seed) + 0.08 * Math.sin(t * 19 + seed * 3.1));
    }
  });
  return <pointLight ref={ref} position={position} color={color} intensity={base} distance={distance} decay={decay} />;
}

/** A real wax candle: tapered shaft, drips down the side, a pooled rim, black
 *  wick, and a warm flame with an additive glow sprite. */
function Candle({ h = 5.5, r = 1.1 }: { h?: number; r?: number }) {
  const glow = useMemo(() => flameGlowTexture(), []);
  return (
    <group>
      <mesh castShadow>
        <cylinderGeometry args={[r * 0.84, r, h, 12]} />
        {/* soft wax: low roughness sheen + faint warm bleed fakes subsurface glow */}
        <meshStandardMaterial color="#efe3c8" roughness={0.34} emissive="#96703a" emissiveIntensity={0.14} />
      </mesh>
      {/* wax drips down the shaft */}
      {[0.9, 2.6, 4.3].map((a, i) =>
        1.4 + i * 1.5 < h ? (
          <group key={a} position={[Math.cos(a) * r * 0.86, h / 2 - 1.1 - i * 1.5, Math.sin(a) * r * 0.86]}>
            <mesh scale={[1, 2.1, 1]}>
              <sphereGeometry args={[0.26 - i * 0.04, 6, 6]} />
              <meshStandardMaterial color="#f4e8ce" roughness={0.3} />
            </mesh>
          </group>
        ) : null,
      )}
      {/* pooled rim */}
      <mesh position={[0, h / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r * 0.72, 0.17, 6, 12]} />
        <meshStandardMaterial color="#f4e8ce" roughness={0.3} />
      </mesh>
      {/* black wick */}
      <mesh position={[0, h / 2 + 0.45, 0]} rotation={[0.15, 0, 0.1]}>
        <cylinderGeometry args={[0.08, 0.11, 0.8, 5]} />
        <meshStandardMaterial color="#15120e" roughness={0.9} />
      </mesh>
      {/* flame + glow halo */}
      <mesh position={[0, h / 2 + 1.3, 0]} scale={[1, 1.8, 1]}>
        <sphereGeometry args={[0.42, 8, 8]} />
        <meshStandardMaterial color="#ffd989" emissive="#ffa63a" emissiveIntensity={4} />
      </mesh>
      <Billboard position={[0, h / 2 + 1.45, 0]}>
        <mesh renderOrder={20}>
          <planeGeometry args={[4.4, 4.4]} />
          <meshBasicMaterial
            map={glow}
            transparent
            opacity={0.75}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </Billboard>
    </group>
  );
}

/**
 * A leaded medieval window over a REAL opening in the wall (see PiercedWall).
 * The world outside is the 3D castle-town diorama (Exterior.tsx) — seen here
 * through slightly cloudy old glass with raised lead cames, behind bevelled
 * stone jambs, sill, arch and keystone, with dark stone reveals lining the
 * cut. Cool daylight spills in: a soft halo around the opening, a shaft down
 * into the room, and a faint pool on the floorboards below.
 */
function MedievalWindow({ pos, yaw }: { pos: [number, number, number]; yaw: number }) {
  const glass = useMemo(() => windowGlassTexture(), []);
  const lead = useMemo(() => windowLeadTexture(), []);
  const shaft = useMemo(() => lightShaftTexture(), []);
  const glow = useMemo(() => flameGlowTexture(), []);
  return (
    <group position={pos} rotation={[0, yaw, 0]}>
      {/* stone surround: jambs + sill + arch + keystone (bevelled) */}
      {[-14.5, 14.5].map((jx) => (
        <mesh key={jx} geometry={rbox(4.5, 36, 4)} position={[jx, -3, 0.6]} castShadow receiveShadow>
          <meshStandardMaterial {...STONE} />
        </mesh>
      ))}
      <mesh geometry={rbox(36, 3.6, 6)} position={[0, -22.5, 0.8]} castShadow receiveShadow>
        <meshStandardMaterial {...STONE} />
      </mesh>
      {/* the arch hugs the painted opening so stone frames sky, not wall */}
      <mesh position={[0, 6.5, 0.6]} castShadow>
        <torusGeometry args={[13.6, 2.4, 8, 18, Math.PI]} />
        <meshStandardMaterial {...STONE} />
      </mesh>
      <mesh geometry={rbox(5, 4.4, 4.6)} position={[0, 20.1, 0.6]} castShadow>
        <meshStandardMaterial {...STONE} />
      </mesh>
      {/* dark stone reveals lining the cut through the wall */}
      {[-12.9, 12.9].map((rx) => (
        <mesh key={rx} position={[rx, 0, -2.15]}>
          <boxGeometry args={[1.6, 40, 3.9]} />
          <meshStandardMaterial color="#3a342c" roughness={0.98} metalness={0} />
        </mesh>
      ))}
      <mesh position={[0, 19.2, -2.15]}>
        <boxGeometry args={[27, 1.6, 3.9]} />
        <meshStandardMaterial color="#332d26" roughness={0.98} metalness={0} />
      </mesh>
      <mesh position={[0, -19.6, -2.15]}>
        <boxGeometry args={[27, 1.6, 3.9]} />
        <meshStandardMaterial color="#46403a" roughness={0.98} metalness={0} />
      </mesh>
      {/* cloudy old glass set into the opening — the 3D exterior shows
          through it slightly softened; env reflections give it a faint sheen */}
      <mesh position={[0, 0, -1.1]} renderOrder={12}>
        <planeGeometry args={[26, 40]} />
        <meshStandardMaterial
          map={glass}
          transparent
          roughness={0.22}
          metalness={0}
          envMapIntensity={0.8}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      {/* raised lead cames just inside the glass */}
      <mesh position={[0, 0, -0.9]} renderOrder={13}>
        <planeGeometry args={[26, 40]} />
        <meshStandardMaterial map={lead} transparent alphaTest={0.35} roughness={0.55} metalness={0.35} fog={false} />
      </mesh>
      {/* cool daylight halo spilling into the room around the opening */}
      <mesh position={[0, 0, 2.6]} renderOrder={15}>
        <planeGeometry args={[52, 62]} />
        <meshBasicMaterial
          map={glow}
          color="#ccdbe2"
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* shaft of cool daylight angling down into the room */}
      <mesh position={[0, -16, 13]} rotation={[-0.62, 0, 0]} renderOrder={16}>
        <planeGeometry args={[25, 42]} />
        <meshBasicMaterial
          map={shaft}
          color="#d3e0e4"
          transparent
          opacity={0.42}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* faint daylight pool on the floor below the window */}
      <mesh position={[0, -51.8, 18]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={14}>
        <planeGeometry args={[46, 24]} />
        <meshBasicMaterial
          map={glow}
          color="#c3d4dc"
          transparent
          opacity={0.13}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * The chamber's entrance: a grand arched double-height door of vertical oak
 * planks, hung on long black iron strap hinges with a ring handle, set in a
 * bevelled stone surround with a worn threshold. Built at real scale — the
 * opening is ~1.5 m wide and ~2.3 m to the crown of the arch.
 */
function GreatDoor({ pos, yaw }: { pos: [number, number, number]; yaw: number }) {
  const HALF = 24; // door leaf half-width
  const JAMB_H = 50; // straight rise before the arch springs
  const leafGeom = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-HALF, 0);
    s.lineTo(-HALF, JAMB_H);
    s.absarc(0, JAMB_H, HALF, Math.PI, 0, true);
    s.lineTo(HALF, 0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 2.4,
      bevelEnabled: true,
      bevelThickness: 0.5,
      bevelSize: 0.5,
      bevelSegments: 2,
    });
    return g;
  }, []);
  // vertical planks: extrude UVs are shape coords, so repeat maps 5 boards
  // across the leaf with the grain running upright
  const planks = useMemo(() => {
    const t = planksTexture().clone();
    t.repeat.set(1 / (HALF * 2), 1 / (JAMB_H + HALF));
    t.offset.set(0.5, 0);
    t.needsUpdate = true;
    return t;
  }, []);
  const planksBump = useMemo(() => {
    const t = planksBumpTexture().clone();
    t.repeat.set(1 / (HALF * 2), 1 / (JAMB_H + HALF));
    t.offset.set(0.5, 0);
    t.needsUpdate = true;
    return t;
  }, []);
  const leafMats = useMemo(
    () => [
      // front/back faces: aged oak boards
      new THREE.MeshStandardMaterial({
        map: planks,
        bumpMap: planksBump,
        bumpScale: 0.2,
        color: '#c7a97e',
        roughness: 0.85,
        metalness: 0,
      }),
      // extruded edge: dark end-grain
      new THREE.MeshStandardMaterial({ color: '#241a10', roughness: 0.95, metalness: 0 }),
    ],
    [planks, planksBump],
  );
  /** One long strap hinge: bar from the hinge side, chamfered tip, bolt heads. */
  const strap = (y: number, len: number) => (
    <group key={y} position={[-HALF + len / 2 - 1, y, 3.4]}>
      <mesh geometry={rbox(len, 3, 1)} castShadow>
        <meshStandardMaterial color="#181a1d" roughness={0.62} metalness={0.55} />
      </mesh>
      {/* spear tip on the free end */}
      <mesh position={[len / 2 + 2.4, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <coneGeometry args={[1.5, 5, 4]} />
        <meshStandardMaterial color="#181a1d" roughness={0.62} metalness={0.55} />
      </mesh>
      {/* knuckle barrel at the hinge side + bolts along the strap */}
      <mesh position={[-len / 2 + 1, 0, -0.4]}>
        <cylinderGeometry args={[1.1, 1.1, 4.6, 8]} />
        <meshStandardMaterial color="#101214" roughness={0.55} metalness={0.6} />
      </mesh>
      {[-len * 0.28, 0, len * 0.28].map((bx) => (
        <mesh key={bx} position={[bx, 0, 0.6]}>
          <sphereGeometry args={[0.55, 6, 6]} />
          <meshStandardMaterial color="#2e3338" roughness={0.4} metalness={0.7} />
        </mesh>
      ))}
    </group>
  );
  return (
    <group position={pos} rotation={[0, yaw, 0]}>
      {/* the leaf, planks upright (flush against the wall face — no backing
          plane, so nothing square peeks past the arched leaf) */}
      <mesh geometry={leafGeom} material={leafMats} position={[0, 0, 0]} castShadow receiveShadow />
      {/* three long strap hinges */}
      {strap(12, 34)}
      {strap(38, 40)}
      {strap(58, 30)}
      {/* iron ring handle on a backplate, latch side */}
      <group position={[HALF - 7, 32, 3.4]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[2.2, 2.2, 0.7, 10]} />
          <meshStandardMaterial color="#14161a" roughness={0.6} metalness={0.55} />
        </mesh>
        <mesh position={[0, -2.6, 0.8]} rotation={[0.35, 0, 0]} castShadow>
          <torusGeometry args={[2.4, 0.55, 8, 14]} />
          <meshStandardMaterial color="#1c1f23" roughness={0.5} metalness={0.65} />
        </mesh>
      </group>
      {/* stone surround: jambs, arch, keystone, worn threshold step */}
      {[-(HALF + 4.5), HALF + 4.5].map((jx) => (
        <mesh key={jx} geometry={rbox(6.5, JAMB_H + 4, 5.5)} position={[jx, (JAMB_H + 4) / 2 - 1, 0.6]} castShadow receiveShadow>
          <meshStandardMaterial {...STONE} />
        </mesh>
      ))}
      <mesh position={[0, JAMB_H, 0.6]} castShadow>
        <torusGeometry args={[HALF + 2.8, 3.4, 8, 20, Math.PI]} />
        <meshStandardMaterial {...STONE} />
      </mesh>
      <mesh geometry={rbox(7, 6, 6)} position={[0, JAMB_H + HALF + 4.4, 0.6]} castShadow>
        <meshStandardMaterial {...STONE} />
      </mesh>
      <mesh geometry={rbox(HALF * 2 + 16, 2.6, 9)} position={[0, 1, 2]} receiveShadow>
        <meshStandardMaterial color="#3e3831" roughness={0.96} metalness={0} />
      </mesh>
    </group>
  );
}

/** Iron wall sconce with a single dripping candle on a forged bracket. */
function Sconce({ pos, yaw, seed }: { pos: [number, number, number]; yaw: number; seed: number }) {
  return (
    <group position={pos} rotation={[0, yaw, 0]}>
      <mesh geometry={rbox(1.8, 8, 1.2)} position={[0, 0, -1.5]} castShadow>
        <meshStandardMaterial {...IRON} />
      </mesh>
      {/* scrolled arm out from the wall */}
      <mesh position={[0, -1.6, 0.8]} rotation={[0.9, 0, 0]}>
        <torusGeometry args={[1.6, 0.35, 6, 10, Math.PI * 1.3]} />
        <meshStandardMaterial {...IRON} />
      </mesh>
      <mesh position={[0, -2, 2]} castShadow>
        <cylinderGeometry args={[2.4, 1.5, 1.3, 10]} />
        <meshStandardMaterial {...IRON} roughness={0.5} />
      </mesh>
      <group position={[0, 1.4, 2]}>
        <Candle h={5.4} r={0.95} />
      </group>
      <FlickerLight base={2.8} seed={seed} position={[0, 6, 4]} color="#ffa562" distance={62} decay={1.9} />
    </group>
  );
}

// ---- pierced plaster walls -------------------------------------------------

// Window openings cut through the north/south walls (wall space: x across the
// wall, y up from the floor). Must match MedievalWindow's vista plane (26×40
// centred at FLOOR_Y+52) with a hair of margin for the stone reveal linings.
const WIN_W = 27;
const WIN_Y0 = 32;
const WIN_Y1 = 72;
const WALL_HALF_LEN = 76; // N/S walls span x −76..76
const WALL_H = 90;

/**
 * One plaster wall slab whose textures sample exactly the slice of the whole
 * wall's plaster that lies under it — so the grime gradient, cracks and stains
 * run continuously across the segments around the window openings. `mirror`
 * flips the u-mapping for the south wall, whose room-facing box face runs
 * u opposite to world x.
 */
function PlasterSeg({
  x0,
  x1,
  y0,
  y1,
  z,
  mirror,
}: {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z: number;
  mirror: boolean;
}) {
  const w = x1 - x0;
  const h = y1 - y0;
  const maps = useMemo(() => {
    const m = plasterTexture().clone();
    const b = plasterBumpTexture().clone();
    const du = (w / (WALL_HALF_LEN * 2)) * 2; // 2 texture repeats across the full wall
    const u0 = mirror
      ? ((WALL_HALF_LEN - x1) / (WALL_HALF_LEN * 2)) * 2
      : ((x0 + WALL_HALF_LEN) / (WALL_HALF_LEN * 2)) * 2;
    for (const t of [m, b]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(du, h / WALL_H);
      t.offset.set(u0, y0 / WALL_H);
      t.needsUpdate = true;
    }
    return { m, b };
  }, [x0, x1, y0, w, h, mirror]);
  return (
    <mesh position={[x0 + w / 2, FLOOR_Y + y0 + h / 2, z]} receiveShadow>
      <boxGeometry args={[w, h, 4]} />
      <meshStandardMaterial
        map={maps.m}
        bumpMap={maps.b}
        bumpScale={0.35}
        color="#c0b5a4"
        roughness={0.97}
        metalness={0}
      />
    </mesh>
  );
}

/** A north/south wall built from slabs around REAL window openings, so the
 *  windows genuinely pierce the wall instead of being painted onto it. */
function PiercedWall({ z, openings, mirror = false }: { z: number; openings: number[]; mirror?: boolean }) {
  const segs = useMemo(() => {
    const xs = [...openings].sort((a, b) => a - b);
    const out: { x0: number; x1: number; y0: number; y1: number }[] = [];
    let cursor = -WALL_HALF_LEN;
    for (const cx of xs) {
      const l = cx - WIN_W / 2;
      const r = cx + WIN_W / 2;
      if (l > cursor) out.push({ x0: cursor, x1: l, y0: 0, y1: WALL_H });
      out.push({ x0: l, x1: r, y0: 0, y1: WIN_Y0 }); // below the opening
      out.push({ x0: l, x1: r, y0: WIN_Y1, y1: WALL_H }); // above the opening
      cursor = r;
    }
    if (cursor < WALL_HALF_LEN) out.push({ x0: cursor, x1: WALL_HALF_LEN, y0: 0, y1: WALL_H });
    return out;
  }, [openings]);
  return (
    <group>
      {segs.map((s2, i) => (
        <PlasterSeg key={i} {...s2} z={z} mirror={mirror} />
      ))}
    </group>
  );
}

/**
 * Cheap faked ambient occlusion for the room shell: gradient planes darken the
 * four vertical corners and the wall/floor junction, so the room keeps depth
 * and weight even under the brighter daylight fill. 12 alpha planes, one
 * shared texture — no extra lights, no per-frame cost.
 */
function RoomShading() {
  const shade = useMemo(() => shadeGradientTexture(), []);
  const midY = FLOOR_Y + 45;
  // two planes per corner, one on each adjoining wall, dark edge into the corner
  const corners: { pos: [number, number, number]; yaw: number; flip: boolean }[] = [
    { pos: [-60, midY, -87.6], yaw: 0, flip: false },
    { pos: [60, midY, -87.6], yaw: 0, flip: true },
    { pos: [60, midY, 87.6], yaw: Math.PI, flip: false },
    { pos: [-60, midY, 87.6], yaw: Math.PI, flip: true },
    { pos: [-71.6, midY, 76], yaw: Math.PI / 2, flip: false },
    { pos: [-71.6, midY, -76], yaw: Math.PI / 2, flip: true },
    { pos: [71.6, midY, -76], yaw: -Math.PI / 2, flip: false },
    { pos: [71.6, midY, 76], yaw: -Math.PI / 2, flip: true },
  ];
  // contact-shadow strips on the floor along each wall, dark edge at the wall
  const strips: { pos: [number, number, number]; rz: number; len: number }[] = [
    { pos: [0, FLOOR_Y + 0.08, -83], rz: -Math.PI / 2, len: 148 },
    { pos: [0, FLOOR_Y + 0.08, 83], rz: Math.PI / 2, len: 148 },
    { pos: [-67, FLOOR_Y + 0.08, 0], rz: 0, len: 176 },
    { pos: [67, FLOOR_Y + 0.08, 0], rz: Math.PI, len: 176 },
  ];
  return (
    <group>
      {corners.map((c2, i) => (
        <mesh
          key={`c${i}`}
          position={c2.pos}
          rotation={[0, c2.yaw, 0]}
          scale={[c2.flip ? -1 : 1, 1, 1]}
          renderOrder={4}
        >
          <planeGeometry args={[26, 90]} />
          <meshBasicMaterial map={shade} transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {strips.map((s2, i) => (
        <mesh key={`s${i}`} position={s2.pos} rotation={[-Math.PI / 2, 0, s2.rz]} renderOrder={4}>
          <planeGeometry args={[10, s2.len]} />
          <meshBasicMaterial map={shade} transparent opacity={0.55} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

// ---- the room -------------------------------------------------------------------

/**
 * Walls, timber ceiling, windows, the great door and real-scale furnishings —
 * pottery shelves, crates, candelabra and sconces — kept deliberately
 * uncluttered. Warm flame lights flicker on a shared clock.
 */
export function SmithyRoom() {
  const plaster = useMemo(() => {
    const t = plasterTexture();
    t.repeat.set(2, 1);
    return t;
  }, []);
  const plasterBump = useMemo(() => {
    const t = plasterBumpTexture();
    t.repeat.set(2, 1);
    return t;
  }, []);
  const cobweb = useMemo(() => cobwebTexture(), []);
  const woodBump = useMemo(() => {
    const t = woodBumpTexture().clone();
    t.repeat.set(6, 2);
    t.needsUpdate = true;
    return t;
  }, []);

  const wallMat = (
    <meshStandardMaterial
      map={plaster}
      bumpMap={plasterBump}
      bumpScale={0.35}
      color="#c0b5a4"
      roughness={0.97}
      metalness={0}
    />
  );

  return (
    <group>
      {/* faked ambient occlusion: darkened vertical corners + wall/floor
          contact strips (cheap gradient planes, no extra lights) */}
      <RoomShading />
      {/* ---- shell: four walls + timber ceiling ---- */}
      <mesh position={[-WALL_X, FLOOR_Y + 45, 0]} receiveShadow>
        <boxGeometry args={[4, 90, 188]} />
        {wallMat}
      </mesh>
      <mesh position={[WALL_X, FLOOR_Y + 45, 0]} receiveShadow>
        <boxGeometry args={[4, 90, 188]} />
        {wallMat}
      </mesh>
      {/* north + south walls pierced with real window openings */}
      <PiercedWall z={-WALL_Z} openings={[-38, 38]} />
      <PiercedWall z={WALL_Z} openings={[-44]} mirror />
      {/* ceiling boards — self-lit a touch so looking up never reads as void */}
      <mesh position={[0, CEIL_Y + 2, 0]}>
        <boxGeometry args={[156, 4, 192]} />
        <meshStandardMaterial
          color="#54422e"
          bumpMap={woodBump}
          bumpScale={0.08}
          roughness={0.92}
          metalness={0}
          emissive="#54422e"
          emissiveIntensity={0.55}
        />
      </mesh>
      {/* ceiling beams (~60 cm apart) + kingpost beam */}
      {[-72, -48, -24, 0, 24, 48, 72].map((bz, i) => (
        <mesh
          key={bz}
          geometry={rbox(150, 8, 9)}
          position={[0, CEIL_Y - 3, bz]}
          rotation={[0, 0, (i % 3) * 0.004 - 0.004]}
          castShadow
        >
          <WoodMat tint="#4a3826" rx={3} ry={0.3} rough={0.9} />
        </mesh>
      ))}
      <mesh geometry={rbox(10, 9, 186)} position={[0, CEIL_Y - 9, 0]} castShadow>
        <WoodMat tint="#41301f" rx={0.4} ry={3} rough={0.9} />
      </mesh>
      {/* ---- leaded windows (north wall pair + one on the south) over real
              openings — the 3D castle-town exterior shows through the glass,
              a different angle of the same world at each window ---- */}
      <MedievalWindow pos={[-38, FLOOR_Y + 52, -WALL_Z + 2.2]} yaw={0} />
      <MedievalWindow pos={[38, FLOOR_Y + 52, -WALL_Z + 2.2]} yaw={0} />
      <MedievalWindow pos={[-44, FLOOR_Y + 52, WALL_Z - 2.2]} yaw={Math.PI} />

      {/* ---- the great oak door (east wall, south of the banner zone) ---- */}
      <GreatDoor pos={[WALL_X - 2, FLOOR_Y, 52]} yaw={-Math.PI / 2} />

      {/* (no wall shelves — the east wall stays bare beside the door) */}
      {/* ---- dusty cobwebs in the high corners ---- */}
      {[
        { pos: [WALL_X - 3, CEIL_Y - 4, -WALL_Z + 3] as [number, number, number], yaw: -Math.PI * 0.75 },
        { pos: [-WALL_X + 3, CEIL_Y - 4, WALL_Z - 3] as [number, number, number], yaw: Math.PI * 0.25 },
      ].map((w, i) => (
        <mesh key={i} position={w.pos} rotation={[0, w.yaw, Math.PI]}>
          <planeGeometry args={[26, 26]} />
          <meshBasicMaterial
            map={cobweb}
            transparent
            opacity={0.4}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* ---- lights: candles on the walls only (sconces carry the room) ---- */}
      <Sconce pos={[-30, FLOOR_Y + 55, WALL_Z - 3]} yaw={Math.PI} seed={9.5} />
      <Sconce pos={[64, FLOOR_Y + 55, WALL_Z - 3]} yaw={Math.PI} seed={11.4} />
      <Sconce pos={[-WALL_X + 3, FLOOR_Y + 55, 44]} yaw={Math.PI / 2} seed={13.3} />
      <Sconce pos={[-WALL_X + 3, FLOOR_Y + 55, -50]} yaw={Math.PI / 2} seed={15.2} />
    </group>
  );
}

// ---- team banners (wall hangings) ---------------------------------------------

/**
 * Banner art per team. If real artwork exists at /banners/<colour>.png (the
 * reference images — drop them into app/public/banners/), it is used directly;
 * otherwise the procedural recreation of that design (bannerTexture) stands in.
 */
function useBannerTexture(color: PlayerColor): THREE.Texture {
  const fallback = useMemo(() => bannerTexture(color as BannerTeam), [color]);
  const [tex, setTex] = useState<THREE.Texture>(fallback);
  useEffect(() => {
    let live = true;
    new THREE.TextureLoader().load(
      `/banners/${color}.png`,
      (t) => {
        if (!live) return;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        setTex(t);
      },
      undefined,
      () => {
        if (live) setTex(fallback);
      },
    );
    return () => {
      live = false;
    };
  }, [color, fallback]);
  return tex;
}

/** Seat index (quarter-turns from top) → outward direction on the floor. */
const SEAT_DIR: [number, number][] = [
  [0, -1], // 0 top edge (row 0 is -Z)
  [1, 0], // 1 right
  [0, 1], // 2 bottom
  [-1, 0], // 3 left
];

/** Draped banner plane: the top (with the baked-in rod) stays rigid; folds
 *  build gently toward the free-hanging swallow tails. */
function drapedCloth(): THREE.PlaneGeometry {
  const W = 40;
  const H = 65.5; // matches the banner art's 640×1048 aspect
  const g = new THREE.PlaneGeometry(W, H, 16, 20);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const hang = Math.max(0, 0.9 - (y + H / 2) / H); // 0 near the rod
    const folds = Math.sin((x / W) * Math.PI * 3.2) * 1.1 + Math.sin((x / W) * Math.PI * 7 + 1.2) * 0.4;
    pos.setZ(i, folds * hang + Math.sin(y * 0.22) * 0.35 * hang);
  }
  g.computeVertexNormals();
  return g;
}

function WallBanner({ color, seat }: { color: PlayerColor; seat: number }) {
  const tex = useBannerTexture(color);
  const cloth = useMemo(() => drapedCloth(), []);
  const [dx, dz] = SEAT_DIR[seat] ?? SEAT_DIR[0];
  const dist = (dx !== 0 ? WALL_X : WALL_Z) - 4.5; // just off the wall face
  const yaw = Math.atan2(-dx, -dz);
  return (
    <group position={[dx * dist, FLOOR_Y + 54, dz * dist]} rotation={[0, yaw, 0]}>
      {/* soft contact shadow on the wall behind the cloth */}
      <mesh position={[0, -2, -1.6]}>
        <planeGeometry args={[44, 68]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      {/* the banner (rod, tassels and trim are part of the artwork) */}
      <mesh geometry={cloth} position={[0, 0, 1.2]} rotation={[0.035, 0, 0]} castShadow>
        <meshStandardMaterial
          map={tex}
          transparent
          alphaTest={0.4}
          side={THREE.DoubleSide}
          roughness={0.92}
          metalness={0}
        />
      </mesh>
    </group>
  );
}

/** One wall banner behind every PLAYING colour's seat — none for absent teams. */
export function TeamBanners() {
  const players = useGame((s) => s.game.players);
  const seats = useGame((s) => s.game.seats);
  return (
    <group>
      {players.map((p) => (
        <WallBanner key={p} color={p} seat={seats[p]} />
      ))}
    </group>
  );
}
