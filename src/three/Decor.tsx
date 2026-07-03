// The room around the game: a blacksmith's workshop interior, built to real
// proportions with the board treated as a REAL CHESSBOARD (~0.5 m across).
// Scale: the board is 16 world units ≈ 0.5 m → 1 m ≈ 32 units. Everything in
// here — walls, forge, furniture, banners — is sized off that ruler. The table
// and the flagstone floor are untouched. Only the wall banners are game-aware
// (one per PLAYING colour, hung behind that colour's seat).
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard, useTexture } from '@react-three/drei';
import { RoundedBoxGeometry } from 'three-stdlib';
import type { PlayerColor } from '../game/types';
import { COLORS, FLOOR_Y } from './coords';
import {
  bannerTexture,
  cobwebTexture,
  flameGlowTexture,
  forgeEmbersTexture,
  lightShaftTexture,
  planksBumpTexture,
  planksTexture,
  plasterBumpTexture,
  plasterTexture,
  windowTexture,
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
const STEEL = { color: '#5f666e', roughness: 0.38, metalness: 0.85 } as const;
const OAK = { color: '#4a3421', roughness: 0.85, metalness: 0 } as const;
const DARKOAK = { color: '#2f241a', roughness: 0.9, metalness: 0 } as const;
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

function Pot({
  x,
  z,
  y,
  r = 3,
  h = 6,
  glaze = '#96603e',
}: {
  x: number;
  z: number;
  y: number;
  r?: number;
  h?: number;
  /** Fired-clay glaze colour — varied per pot so the shelf reads hand-made. */
  glaze?: string;
}) {
  return (
    <group position={[x, y, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[r * 0.75, r, h, 12]} />
        <meshStandardMaterial color={glaze} roughness={0.45} metalness={0} />
      </mesh>
      <mesh position={[0, h / 2, 0]}>
        <torusGeometry args={[r * 0.62, r * 0.18, 8, 14]} />
        <meshStandardMaterial color={glaze} roughness={0.4} metalness={0} />
      </mesh>
    </group>
  );
}

function Barrel({ x, z, lean = 0, yaw = 0 }: { x: number; z: number; lean?: number; yaw?: number }) {
  return (
    <group position={[x, FLOOR_Y + 14, z]} rotation={[lean, yaw, 0]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[12, 13.5, 28, 14]} />
        <WoodMat tint="#7d5f3e" rx={0.9} ry={0.45} />
      </mesh>
      {[-9, 0, 9].map((hy) => (
        <mesh key={hy} position={[0, hy, 0]}>
          <cylinderGeometry args={[13.9 - Math.abs(hy) * 0.12, 13.9 - Math.abs(hy) * 0.12, 1.6, 14]} />
          <meshStandardMaterial {...IRON} />
        </mesh>
      ))}
    </group>
  );
}

/** A bevelled plank crate with iron straps and bolt heads — no perfect cubes. */
function PlankCrate({ x, z, s, ry, lift = 0 }: { x: number; z: number; s: number; ry: number; lift?: number }) {
  const planks = useMemo(() => planksTexture(), []);
  const planksBump = useMemo(() => planksBumpTexture(), []);
  return (
    <group position={[x, FLOOR_Y + s / 2 + lift, z]} rotation={[0.015, ry, -0.01]}>
      <mesh geometry={rbox(s, s, s)} castShadow receiveShadow>
        <meshStandardMaterial map={planks} bumpMap={planksBump} bumpScale={0.16} color="#a9865c" roughness={0.85} />
      </mesh>
      {/* iron straps + bolts */}
      {[-s * 0.32, s * 0.32].map((sy) => (
        <group key={sy}>
          <mesh geometry={rbox(s * 1.03, s * 0.09, s * 1.03)} position={[0, sy, 0]}>
            <meshStandardMaterial color="#26292d" roughness={0.55} metalness={0.6} />
          </mesh>
          {[0, 1, 2, 3].map((k) => {
            const a = (k * Math.PI) / 2 + Math.PI / 4;
            return (
              <mesh key={k} position={[Math.cos(a) * s * 0.53, sy, Math.sin(a) * s * 0.53]}>
                <sphereGeometry args={[s * 0.035, 6, 6]} />
                <meshStandardMaterial color="#3c4147" roughness={0.4} metalness={0.7} />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

function Chain({ x, z, len }: { x: number; z: number; len: number }) {
  return (
    <group position={[x, CEIL_Y - 6, z]}>
      <mesh>
        <cylinderGeometry args={[0.7, 0.7, len, 6]} />
        <meshStandardMaterial {...IRON} />
      </mesh>
      <mesh position={[0, -len / 2 - 1.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.4, 0.7, 6, 12]} />
        <meshStandardMaterial {...IRON} />
      </mesh>
    </group>
  );
}

/** A warm point light with candle/forge flicker (each keeps its own clock). */
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
 * A leaded medieval window with real depth: stone jambs, sill and arch proud of
 * the wall, cloudy glass recessed behind them, a soft cool halo into the room
 * and a faked shaft of daylight angling down to the floor.
 */
function MedievalWindow({ pos, yaw }: { pos: [number, number, number]; yaw: number }) {
  const winTex = useMemo(() => windowTexture(), []);
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
      <mesh position={[0, 14.4, 0.6]} rotation={[0, 0, 0]} castShadow>
        <torusGeometry args={[13.6, 2.4, 8, 18, Math.PI]} />
        <meshStandardMaterial {...STONE} />
      </mesh>
      <mesh geometry={rbox(5, 4.4, 4.6)} position={[0, 27.6, 0.6]} castShadow>
        <meshStandardMaterial {...STONE} />
      </mesh>
      {/* cloudy leaded glass, recessed into the wall */}
      <mesh position={[0, 0, -0.9]}>
        <planeGeometry args={[26, 40]} />
        <meshStandardMaterial
          map={winTex}
          transparent
          alphaTest={0.3}
          emissiveMap={winTex}
          emissive="#ffffff"
          emissiveIntensity={1.05}
          color="#7d837c"
          roughness={0.35}
        />
      </mesh>
      {/* cool halo bleeding into the room */}
      <mesh position={[0, 0, 2.6]} renderOrder={15}>
        <planeGeometry args={[48, 58]} />
        <meshBasicMaterial
          map={glow}
          color="#bcd4de"
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* shaft of daylight angling down into the room */}
      <mesh position={[0, -16, 13]} rotation={[-0.62, 0, 0]} renderOrder={16}>
        <planeGeometry args={[25, 42]} />
        <meshBasicMaterial
          map={shaft}
          color="#d4e4ea"
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** A standing wrought-iron candelabrum (~1.4 m) with three uneven candles. */
function Candelabrum({ x, z, seed }: { x: number; z: number; seed: number }) {
  const H = 44;
  return (
    <group position={[x, FLOOR_Y, z]}>
      {/* tripod feet + stem with a twist collar */}
      {[0, 2.1, 4.2].map((a) => (
        <mesh key={a} position={[Math.cos(a) * 4, 1.2, Math.sin(a) * 4]} rotation={[0, -a, 0.5]} castShadow>
          <cylinderGeometry args={[0.9, 1.1, 9, 8]} />
          <meshStandardMaterial {...IRON} />
        </mesh>
      ))}
      <mesh position={[0, H / 2, 0]} castShadow>
        <cylinderGeometry args={[1.0, 1.5, H, 10]} />
        <meshStandardMaterial {...IRON} roughness={0.5} />
      </mesh>
      <mesh position={[0, H * 0.55, 0]}>
        <torusGeometry args={[1.5, 0.4, 6, 12]} />
        <meshStandardMaterial {...IRON} />
      </mesh>
      {/* drip pan + three candles of different heights */}
      <mesh position={[0, H, 0]} castShadow>
        <cylinderGeometry args={[7, 5.5, 1.6, 12]} />
        <meshStandardMaterial {...IRON} roughness={0.5} />
      </mesh>
      {[
        [0, 6.8],
        [2.1, 5.2],
        [4.2, 4.0],
      ].map(([a, ch]) => (
        <group key={a} position={[Math.cos(a) * 3.6, H + 0.8 + ch / 2, Math.sin(a) * 3.6]}>
          <Candle h={ch} r={1.05} />
        </group>
      ))}
      <FlickerLight base={3} seed={seed} position={[0, H + 8, 0]} color="#ffb066" distance={70} decay={1.8} />
    </group>
  );
}

/** Iron wall sconce with a single dripping candle on a forged bracket. */
function Sconce({ pos, yaw, seed }: { pos: [number, number, number]; yaw: number; seed: number }) {
  return (
    <group position={pos} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0, -1.5]} castShadow>
        <boxGeometry args={[1.8, 8, 1.2]} />
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
      <FlickerLight base={1.6} seed={seed} position={[0, 6, 4]} color="#ffa562" distance={46} decay={1.9} />
    </group>
  );
}

// ---- the room -------------------------------------------------------------------

/**
 * Walls, timber ceiling, forge, windows, doorway and real-scale furnishings —
 * anvil on its stump, workbench with tools, pottery shelves, barrels, crates,
 * a leaning ladder, hanging chains, candelabra and sconces. Warm flame lights
 * flicker on a shared clock.
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
  const embers = useMemo(() => forgeEmbersTexture(), []);
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
      color="#b0a698"
      roughness={0.97}
      metalness={0}
    />
  );

  return (
    <group>
      {/* ---- shell: four walls + timber ceiling ---- */}
      <mesh position={[-WALL_X, FLOOR_Y + 45, 0]} receiveShadow>
        <boxGeometry args={[4, 90, 188]} />
        {wallMat}
      </mesh>
      <mesh position={[WALL_X, FLOOR_Y + 45, 0]} receiveShadow>
        <boxGeometry args={[4, 90, 188]} />
        {wallMat}
      </mesh>
      <mesh position={[0, FLOOR_Y + 45, -WALL_Z]} receiveShadow>
        <boxGeometry args={[152, 90, 4]} />
        {wallMat}
      </mesh>
      <mesh position={[0, FLOOR_Y + 45, WALL_Z]} receiveShadow>
        <boxGeometry args={[152, 90, 4]} />
        {wallMat}
      </mesh>
      <mesh position={[0, CEIL_Y + 2, 0]}>
        <boxGeometry args={[156, 4, 192]} />
        <meshStandardMaterial {...DARKOAK} bumpMap={woodBump} bumpScale={0.08} />
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
      {/* chains + hooks hanging from the beams near the forge */}
      <Chain x={-42} z={-52} len={22} />
      <Chain x={-30} z={-40} len={30} />
      <Chain x={-50} z={-28} len={16} />

      {/* ---- forge (west wall, offset clear of the banner) ---- */}
      <group position={[-70, FLOOR_Y, -52]}>
        {/* chimney breast rising into the ceiling */}
        <mesh position={[6, 45, 0]} castShadow receiveShadow>
          <boxGeometry args={[16, 90, 60]} />
          <meshStandardMaterial {...STONE} />
        </mesh>
        {/* hearth opening: dark firebox + banked coals */}
        <mesh position={[14.5, 16, 0]}>
          <planeGeometry args={[44, 32]} />
          <meshStandardMaterial color="#0a0605" roughness={1} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[15, 4.5, 0]} rotation={[-Math.PI / 2 + 0.35, Math.PI / 2, 0]}>
          <planeGeometry args={[40, 20]} />
          <meshStandardMaterial map={embers} emissiveMap={embers} emissive="#ffffff" emissiveIntensity={1.6} color="#1c0f08" />
        </mesh>
        {/* mantel beam + jambs */}
        <mesh geometry={rbox(6, 5, 56)} position={[15, 34, 0]} castShadow>
          <WoodMat tint="#4a3826" rx={0.3} ry={1.4} rough={0.9} />
        </mesh>
        {[-26, 26].map((jz) => (
          <mesh key={jz} position={[14.5, 16, jz]} castShadow>
            <boxGeometry args={[5, 32, 6]} />
            <meshStandardMaterial {...STONE} />
          </mesh>
        ))}
        <FlickerLight base={14} seed={0.7} position={[18, 12, 0]} color="#ff7a30" distance={150} decay={1.7} />
      </group>

      {/* ---- leaded windows (north wall pair + one on the south) ---- */}
      <MedievalWindow pos={[-38, FLOOR_Y + 52, -WALL_Z + 2.2]} yaw={0} />
      <MedievalWindow pos={[38, FLOOR_Y + 52, -WALL_Z + 2.2]} yaw={0} />
      <MedievalWindow pos={[-44, FLOOR_Y + 52, WALL_Z - 2.2]} yaw={Math.PI} />

      {/* ---- doorway (east wall): stone arch over a dark passage ---- */}
      <group position={[WALL_X - 3, FLOOR_Y, 42]}>
        <mesh position={[0, 26, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[30, 52]} />
          <meshStandardMaterial color="#171310" roughness={1} />
        </mesh>
        {/* faint lamplight down the passage */}
        <mesh position={[-0.5, 30, -6]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[8, 40]} />
          <meshStandardMaterial color="#2a1c10" emissive="#c96f2a" emissiveIntensity={0.35} />
        </mesh>
        {[-17, 17].map((jz) => (
          <mesh key={jz} position={[-1, 24, jz]} castShadow>
            <boxGeometry args={[6, 48, 5]} />
            <meshStandardMaterial {...STONE} />
          </mesh>
        ))}
        <mesh position={[-1, 50, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} castShadow>
          <torusGeometry args={[17, 3, 8, 16, Math.PI]} />
          <meshStandardMaterial {...STONE} />
        </mesh>
      </group>

      {/* ---- furnishings (all at real scale) ---- */}
      {/* anvil on an oak stump, near the forge */}
      <group position={[-48, FLOOR_Y, -26]} rotation={[0, 0.5, 0]}>
        <mesh position={[0, 8, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[8, 9.5, 16, 12]} />
          <WoodMat tint="#6e5233" rx={0.7} ry={0.5} rough={0.9} />
        </mesh>
        {/* dark forged body, brighter work-polished face */}
        <mesh position={[0, 18.5, 0]} castShadow>
          <boxGeometry args={[10, 5, 7]} />
          <meshStandardMaterial color="#33383e" roughness={0.55} metalness={0.8} />
        </mesh>
        <mesh position={[0, 22.5, 0]} castShadow>
          <boxGeometry args={[15, 3.5, 6]} />
          <meshStandardMaterial color="#33383e" roughness={0.55} metalness={0.8} />
        </mesh>
        <mesh position={[0, 24.3, 0]}>
          <boxGeometry args={[14.6, 0.3, 5.6]} />
          <meshStandardMaterial color="#9aa2ac" roughness={0.22} metalness={0.9} />
        </mesh>
        <mesh position={[10, 22.5, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
          <coneGeometry args={[2.6, 9, 10]} />
          <meshStandardMaterial color="#3c4147" roughness={0.5} metalness={0.8} />
        </mesh>
        {/* hammer resting on the face */}
        <mesh position={[-3, 25.2, 1]} rotation={[0, 0.4, 0]}>
          <boxGeometry args={[5, 2.4, 2.4]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[-3, 25.2, 5]} rotation={[Math.PI / 2, 0, 0.4]}>
          <cylinderGeometry args={[0.8, 0.9, 9, 6]} />
          <meshStandardMaterial {...OAK} />
        </mesh>
      </group>
      {/* quenching bucket */}
      <group position={[-36, FLOOR_Y, -40]}>
        <mesh position={[0, 5.5, 0]} castShadow>
          <cylinderGeometry args={[6, 5, 11, 12]} />
          <meshStandardMaterial {...OAK} />
        </mesh>
        <mesh position={[0, 9.5, 0]}>
          <cylinderGeometry args={[6.2, 6.2, 1, 12]} />
          <meshStandardMaterial {...IRON} />
        </mesh>
        <mesh position={[0, 10.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[5.6, 12]} />
          <meshStandardMaterial color="#101418" roughness={0.15} metalness={0.4} />
        </mesh>
      </group>
      {/* workbench along the south wall, tools on top */}
      <group position={[34, FLOOR_Y, 76]}>
        {/* two slightly offset plank slabs — a heavy, uneven medieval top */}
        <mesh geometry={rbox(56, 3.2, 11)} position={[0, 26, -4.6]} rotation={[0, 0, 0.004]} castShadow receiveShadow>
          <WoodMat tint="#8f6f45" rx={1.4} ry={0.35} rough={0.78} />
        </mesh>
        <mesh geometry={rbox(56, 3.2, 10)} position={[0.8, 25.7, 5.4]} rotation={[0, 0, -0.005]} castShadow receiveShadow>
          <WoodMat tint="#977a4e" rx={1.4} ry={0.32} rough={0.78} />
        </mesh>
        {[-24, 24].map((lx) =>
          [-7, 7].map((lz) => (
            <mesh key={`${lx}${lz}`} geometry={rbox(4, 24, 4)} position={[lx, 12, lz]} castShadow>
              <WoodMat tint="#57422b" rx={0.25} ry={0.8} rough={0.85} />
            </mesh>
          )),
        )}
        {/* tankard by the tools */}
        <group position={[-22, 29.4, 4]}>
          <mesh castShadow>
            <cylinderGeometry args={[1.9, 2.2, 4.4, 12]} />
            <meshStandardMaterial color="#4e5258" roughness={0.45} metalness={0.7} />
          </mesh>
          <mesh position={[0, 2.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.9, 0.3, 6, 12]} />
            <meshStandardMaterial color="#5e646c" roughness={0.4} metalness={0.75} />
          </mesh>
          <mesh position={[2.6, 0, 0]} rotation={[0, 0, 0]}>
            <torusGeometry args={[1.3, 0.32, 6, 12, Math.PI]} />
            <meshStandardMaterial color="#4e5258" roughness={0.45} metalness={0.7} />
          </mesh>
        </group>
        {/* tongs, horseshoes, a jug */}
        <mesh position={[-14, 28.6, 2]} rotation={[0, 0.5, 0]}>
          <boxGeometry args={[16, 1, 1.6]} />
          <meshStandardMaterial {...IRON} />
        </mesh>
        <mesh position={[-13, 28.6, 4]} rotation={[0, 0.9, 0]}>
          <boxGeometry args={[16, 1, 1.6]} />
          <meshStandardMaterial {...IRON} />
        </mesh>
        {[4, 11].map((hx) => (
          <mesh key={hx} position={[hx, 28.4, -3]} rotation={[Math.PI / 2, 0, hx * 0.2]}>
            <torusGeometry args={[3.4, 1, 6, 12, Math.PI * 1.3]} />
            <meshStandardMaterial {...IRON} />
          </mesh>
        ))}
        <Pot x={21} z={2} y={31.5} r={4} h={7} />
      </group>
      {/* pottery shelves on the east wall */}
      <group position={[68, FLOOR_Y, -46]}>
        {[40, 56].map((sy) => (
          <group key={sy}>
            <mesh geometry={rbox(10, 2.6, 44)} position={[0, sy, 0]} castShadow>
              <WoodMat tint="#8a6a44" rx={1.1} ry={0.3} />
            </mesh>
            {/* forged iron brackets */}
            {[-16, 16].map((bz) => (
              <mesh key={bz} position={[2.4, sy - 3.2, bz]} rotation={[0, 0, 0.78]}>
                <boxGeometry args={[6.5, 1.2, 1.2]} />
                <meshStandardMaterial {...IRON} />
              </mesh>
            ))}
          </group>
        ))}
        {/* pottery, old books and a pair of scrolls */}
        <Pot x={0} z={-14} y={44.3} r={3.4} h={7} glaze="#96603e" />
        <Pot x={0} z={-4} y={43.8} r={4.2} h={6} glaze="#5d6e52" />
        {[
          [6, '#5a3030', 7, 0],
          [8.4, '#2f4a3a', 6.2, 0],
          [10.8, '#3a3a5c', 7.4, 0],
          [13.8, '#6b5a2c', 6.6, -0.24],
        ].map(([bz, col, bh, lean], i) => (
          <mesh
            key={i}
            geometry={rbox(5.4, bh as number, 1.9)}
            position={[0, 41.3 + (bh as number) / 2, bz as number]}
            rotation={[Number(lean), 0, 0]}
            castShadow
          >
            <meshStandardMaterial color={col as string} roughness={0.85} />
          </mesh>
        ))}
        <Pot x={0} z={-12} y={59.6} r={3.6} h={6.5} glaze="#4f5d6e" />
        <Pot x={0} z={-1} y={60} r={3} h={7.5} glaze="#8a6a3e" />
        {/* rolled parchments */}
        {[
          [8, 57.6, 0],
          [9.2, 59.4, 0.35],
          [13, 57.6, -0.2],
        ].map(([sz2, sy2, ry2], i) => (
          <group key={i} position={[0, sy2 as number, sz2 as number]} rotation={[0, ry2 as number, Math.PI / 2]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.9, 0.9, 7.5, 8]} />
              <meshStandardMaterial color="#d8c9a3" roughness={0.8} />
            </mesh>
            <mesh>
              <cylinderGeometry args={[1.0, 1.0, 1.6, 8]} />
              <meshStandardMaterial color="#7a2a24" roughness={0.8} />
            </mesh>
          </group>
        ))}
      </group>
      {/* barrels + crates in the corners */}
      <Barrel x={58} z={-72} />
      <Barrel x={38} z={-76} />
      <Barrel x={52} z={-52} lean={Math.PI / 2} yaw={0.9} />
      {[
        [-56, 66, 22, 0.2],
        [-40, 72, 18, 0.7],
        [-52, 62, 16, 0.45],
      ].map(([cx, cz, s, ry], i) => (
        <PlankCrate key={i} x={cx} z={cz} s={s} ry={ry} lift={i === 2 ? 22 : 0} />
      ))}
      {/* grain sacks slumped beside the crates */}
      {[
        [-42, 54, 1.0],
        [-33, 62, 2.1],
      ].map(([sx, sz, sr], i) => (
        <group key={i} position={[sx, FLOOR_Y, sz]} rotation={[0, sr, 0]}>
          <mesh position={[0, 5, 0]} scale={[1, 0.8, 0.9]} castShadow receiveShadow>
            <sphereGeometry args={[6.4, 10, 8]} />
            <meshStandardMaterial color="#8a7350" roughness={1} bumpMap={woodBump} bumpScale={0.1} />
          </mesh>
          <mesh position={[0, 10.2, 0]} rotation={[0.2, 0.4, 0.15]} castShadow>
            <cylinderGeometry args={[1.4, 2.6, 3, 8]} />
            <meshStandardMaterial color="#796444" roughness={1} />
          </mesh>
        </group>
      ))}
      {/* ladder leaning on the east wall */}
      <group position={[58, FLOOR_Y, -14]} rotation={[0, 0, -0.24]}>
        {[-5, 5].map((lz) => (
          <mesh key={lz} position={[0, 39, lz]} castShadow>
            <cylinderGeometry args={[1.4, 1.6, 78, 8]} />
            <WoodMat tint="#94744c" rx={0.3} ry={1.4} />
          </mesh>
        ))}
        {Array.from({ length: 7 }, (_, k) => (
          <mesh key={k} position={[0, 10 + k * 10, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[1, 1, 10, 6]} />
            <meshStandardMaterial {...OAK} />
          </mesh>
        ))}
      </group>

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

      {/* ---- lights: candelabra ring + wall sconces ---- */}
      <Candelabrum x={-34} z={-34} seed={1.9} />
      <Candelabrum x={34} z={-34} seed={3.8} />
      <Candelabrum x={-34} z={34} seed={5.7} />
      <Candelabrum x={34} z={34} seed={7.6} />
      <Sconce pos={[-30, FLOOR_Y + 55, WALL_Z - 3]} yaw={Math.PI} seed={9.5} />
      <Sconce pos={[64, FLOOR_Y + 55, WALL_Z - 3]} yaw={Math.PI} seed={11.4} />
      <Sconce pos={[-WALL_X + 3, FLOOR_Y + 55, 44]} yaw={Math.PI / 2} seed={13.3} />
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

// ---- chairs at the table --------------------------------------------------------

/** A tall backless oak stool (seat ~1.15 m — matched to the 1.5 m table) with
 *  footrest stretchers and a cushion in the player's colour. No back, so it
 *  never blocks the view of the board or the banners. */
function GameStool({ color, seat }: { color: PlayerColor; seat: number }) {
  const [dx, dz] = SEAT_DIR[seat] ?? SEAT_DIR[0];
  const yaw = Math.atan2(-dx, -dz); // footrests square-on to the table
  const SEAT_H = 37;
  return (
    <group position={[dx * 18, FLOOR_Y, dz * 18]} rotation={[0, yaw, 0]}>
      {/* four splayed legs */}
      {[-5.2, 5.2].map((lx) =>
        [-5.2, 5.2].map((lz) => (
          <mesh
            key={`${lx}${lz}`}
            position={[lx, SEAT_H / 2, lz]}
            rotation={[lz > 0 ? -0.06 : 0.06, 0, lx > 0 ? -0.06 : 0.06]}
            castShadow
          >
            <cylinderGeometry args={[1.0, 1.5, SEAT_H, 8]} />
            <WoodMat tint="#7a5c38" rx={0.25} ry={0.9} />
          </mesh>
        )),
      )}
      {/* footrest stretchers */}
      {[
        [0, -6, 13, 0],
        [0, 6, 13, 0],
        [-6, 0, 13, Math.PI / 2],
        [6, 0, 13, Math.PI / 2],
      ].map(([sx, sz, sy, ry], i) => (
        <mesh key={i} position={[sx, sy, sz]} rotation={[Math.PI / 2, 0, ry]} castShadow>
          <cylinderGeometry args={[0.8, 0.8, 12, 6]} />
          <WoodMat tint="#6e5233" rx={0.2} ry={0.6} />
        </mesh>
      ))}
      {/* round seat + team cushion */}
      <mesh position={[0, SEAT_H + 1, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[8, 7.2, 2.4, 14]} />
        <WoodMat tint="#8a6a44" rx={0.5} ry={0.5} />
      </mesh>
      <mesh position={[0, SEAT_H + 2.8, 0]}>
        <cylinderGeometry args={[6.8, 7.1, 1.6, 14]} />
        <meshStandardMaterial color={COLORS[color]} roughness={0.92} metalness={0} />
      </mesh>
    </group>
  );
}

/** A stool at the table for every PLAYING colour, at its seat side. */
export function TableChairs() {
  const players = useGame((s) => s.game.players);
  const seats = useGame((s) => s.game.seats);
  return (
    <group>
      {players.map((p) => (
        <GameStool key={p} color={p} seat={seats[p]} />
      ))}
    </group>
  );
}
