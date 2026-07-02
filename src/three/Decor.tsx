// The room around the game: a blacksmith's workshop interior, built to real
// proportions with the board treated as a REAL CHESSBOARD (~0.5 m across).
// Scale: the board is 16 world units ≈ 0.5 m → 1 m ≈ 32 units. Everything in
// here — walls, forge, furniture, banners — is sized off that ruler. The table
// and the flagstone floor are untouched. Only the wall banners are game-aware
// (one per PLAYING colour, hung behind that colour's seat).
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { PlayerColor } from '../game/types';
import { COLORS, FLOOR_Y } from './coords';
import {
  bannerTexture,
  forgeEmbersTexture,
  plasterTexture,
  windowTexture,
  woodBumpTexture,
  type BannerSymbol,
} from './textures';
import { useGame } from '../store';

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
const CLAY = { color: '#96603e', roughness: 0.8, metalness: 0 } as const;
const GOLDTRIM = { color: '#cba65a', metalness: 0.85, roughness: 0.35 } as const;

// ---- small parts ---------------------------------------------------------------

function Pot({ x, z, y, r = 3, h = 6 }: { x: number; z: number; y: number; r?: number; h?: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[r * 0.75, r, h, 10]} />
        <meshStandardMaterial {...CLAY} />
      </mesh>
      <mesh position={[0, h / 2, 0]}>
        <torusGeometry args={[r * 0.62, r * 0.18, 8, 14]} />
        <meshStandardMaterial {...CLAY} />
      </mesh>
    </group>
  );
}

function Barrel({ x, z, lean = 0, yaw = 0 }: { x: number; z: number; lean?: number; yaw?: number }) {
  return (
    <group position={[x, FLOOR_Y + 14, z]} rotation={[lean, yaw, 0]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[12, 13.5, 28, 14]} />
        <meshStandardMaterial {...OAK} />
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

/** A standing wrought-iron candelabrum (~1.4 m) with three candles. */
function Candelabrum({ x, z, seed }: { x: number; z: number; seed: number }) {
  const H = 44;
  return (
    <group position={[x, FLOOR_Y, z]}>
      {/* tripod feet + stem */}
      {[0, 2.1, 4.2].map((a) => (
        <mesh key={a} position={[Math.cos(a) * 4, 1.2, Math.sin(a) * 4]} rotation={[0, -a, 0.5]} castShadow>
          <cylinderGeometry args={[0.9, 1.1, 9, 6]} />
          <meshStandardMaterial {...IRON} />
        </mesh>
      ))}
      <mesh position={[0, H / 2, 0]} castShadow>
        <cylinderGeometry args={[1.1, 1.4, H, 8]} />
        <meshStandardMaterial {...IRON} />
      </mesh>
      {/* drip pan + candles */}
      <mesh position={[0, H, 0]} castShadow>
        <cylinderGeometry args={[7, 5.5, 1.6, 10]} />
        <meshStandardMaterial {...IRON} />
      </mesh>
      {[0, 2.1, 4.2].map((a) => (
        <group key={a} position={[Math.cos(a) * 3.6, H + 3.4, Math.sin(a) * 3.6]}>
          <mesh castShadow>
            <cylinderGeometry args={[1.1, 1.2, 5.5, 8]} />
            <meshStandardMaterial color="#e8dcc2" roughness={0.6} />
          </mesh>
          <mesh position={[0, 3.6, 0]}>
            <sphereGeometry args={[1.1, 8, 8]} />
            <meshStandardMaterial color="#ffdc9a" emissive="#ffb045" emissiveIntensity={3} />
          </mesh>
        </group>
      ))}
      <FlickerLight base={3} seed={seed} position={[0, H + 7, 0]} color="#ffb066" distance={70} decay={1.8} />
    </group>
  );
}

/** Iron wall sconce with a single candle. */
function Sconce({ pos, yaw, seed }: { pos: [number, number, number]; yaw: number; seed: number }) {
  return (
    <group position={pos} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0, -1.5]}>
        <boxGeometry args={[2, 8, 1.5]} />
        <meshStandardMaterial {...IRON} />
      </mesh>
      <mesh position={[0, -2, 2]}>
        <cylinderGeometry args={[2.6, 1.6, 1.4, 8]} />
        <meshStandardMaterial {...IRON} />
      </mesh>
      <mesh position={[0, 1, 2]}>
        <cylinderGeometry args={[1, 1.1, 5, 8]} />
        <meshStandardMaterial color="#e8dcc2" roughness={0.6} />
      </mesh>
      <mesh position={[0, 4.4, 2]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshStandardMaterial color="#ffdc9a" emissive="#ffb045" emissiveIntensity={3} />
      </mesh>
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
  const embers = useMemo(() => forgeEmbersTexture(), []);
  const winTex = useMemo(() => windowTexture(), []);
  const woodBump = useMemo(() => {
    const t = woodBumpTexture().clone();
    t.repeat.set(6, 2);
    t.needsUpdate = true;
    return t;
  }, []);

  const wallMat = (
    <meshStandardMaterial map={plaster} color="#b9b0a2" roughness={0.95} metalness={0} />
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
      {[-72, -48, -24, 0, 24, 48, 72].map((bz) => (
        <mesh key={bz} position={[0, CEIL_Y - 3, bz]} castShadow>
          <boxGeometry args={[150, 8, 9]} />
          <meshStandardMaterial {...DARKOAK} bumpMap={woodBump} bumpScale={0.06} />
        </mesh>
      ))}
      <mesh position={[0, CEIL_Y - 9, 0]} castShadow>
        <boxGeometry args={[10, 9, 186]} />
        <meshStandardMaterial {...DARKOAK} bumpMap={woodBump} bumpScale={0.06} />
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
        <mesh position={[15, 34, 0]} castShadow>
          <boxGeometry args={[6, 5, 56]} />
          <meshStandardMaterial {...DARKOAK} />
        </mesh>
        {[-26, 26].map((jz) => (
          <mesh key={jz} position={[14.5, 16, jz]} castShadow>
            <boxGeometry args={[5, 32, 6]} />
            <meshStandardMaterial {...STONE} />
          </mesh>
        ))}
        <FlickerLight base={14} seed={0.7} position={[18, 12, 0]} color="#ff7a30" distance={150} decay={1.7} />
      </group>

      {/* ---- windows (north wall) + one on the south ---- */}
      {[-38, 38].map((wx) => (
        <mesh key={wx} position={[wx, FLOOR_Y + 52, -WALL_Z + 2.2]}>
          <planeGeometry args={[26, 40]} />
          <meshStandardMaterial map={winTex} transparent alphaTest={0.3} emissiveMap={winTex} emissive="#ffffff" emissiveIntensity={0.9} color="#8a8f88" />
        </mesh>
      ))}
      <mesh position={[-44, FLOOR_Y + 52, WALL_Z - 2.2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[26, 40]} />
        <meshStandardMaterial map={winTex} transparent alphaTest={0.3} emissiveMap={winTex} emissive="#ffffff" emissiveIntensity={0.9} color="#8a8f88" />
      </mesh>

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
          <meshStandardMaterial {...OAK} bumpMap={woodBump} bumpScale={0.05} />
        </mesh>
        <mesh position={[0, 18.5, 0]} castShadow>
          <boxGeometry args={[10, 5, 7]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[0, 22.5, 0]} castShadow>
          <boxGeometry args={[15, 3.5, 6]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[10, 22.5, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
          <coneGeometry args={[2.6, 9, 10]} />
          <meshStandardMaterial {...STEEL} />
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
        <mesh position={[0, 26, 0]} castShadow receiveShadow>
          <boxGeometry args={[56, 4, 20]} />
          <meshStandardMaterial {...OAK} bumpMap={woodBump} bumpScale={0.05} />
        </mesh>
        {[-24, 24].map((lx) =>
          [-7, 7].map((lz) => (
            <mesh key={`${lx}${lz}`} position={[lx, 12, lz]} castShadow>
              <boxGeometry args={[4, 24, 4]} />
              <meshStandardMaterial {...DARKOAK} />
            </mesh>
          )),
        )}
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
          <mesh key={sy} position={[0, sy, 0]} castShadow>
            <boxGeometry args={[10, 3, 44]} />
            <meshStandardMaterial {...OAK} />
          </mesh>
        ))}
        <Pot x={0} z={-14} y={44.5} r={3.4} h={7} />
        <Pot x={0} z={-2} y={44} r={4.2} h={6} />
        <Pot x={0} z={12} y={44.5} r={2.8} h={7.5} />
        <Pot x={0} z={-8} y={60} r={3.6} h={6.5} />
        <Pot x={0} z={6} y={60.5} r={3} h={7.5} />
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
        <group key={i} position={[cx, FLOOR_Y + s / 2 + (i === 2 ? 22 : 0), cz]} rotation={[0, ry, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[s, s, s]} />
            <meshStandardMaterial {...OAK} bumpMap={woodBump} bumpScale={0.04} />
          </mesh>
          <mesh>
            <boxGeometry args={[s * 1.04, s * 0.14, s * 1.04]} />
            <meshStandardMaterial {...DARKOAK} />
          </mesh>
        </group>
      ))}
      {/* ladder leaning on the east wall */}
      <group position={[58, FLOOR_Y, -14]} rotation={[0, 0, -0.24]}>
        {[-5, 5].map((lz) => (
          <mesh key={lz} position={[0, 39, lz]} castShadow>
            <cylinderGeometry args={[1.4, 1.6, 78, 8]} />
            <meshStandardMaterial {...OAK} />
          </mesh>
        ))}
        {Array.from({ length: 7 }, (_, k) => (
          <mesh key={k} position={[0, 10 + k * 10, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[1, 1, 10, 6]} />
            <meshStandardMaterial {...OAK} />
          </mesh>
        ))}
      </group>

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

/** Each colour's heraldry — distinct generic medieval symbols. */
const SYMBOLS: Record<PlayerColor, BannerSymbol> = {
  red: 'swords',
  blue: 'tower',
  green: 'tree',
  yellow: 'sun',
};

/** Seat index (quarter-turns from top) → outward direction on the floor. */
const SEAT_DIR: [number, number][] = [
  [0, -1], // 0 top edge (row 0 is -Z)
  [1, 0], // 1 right
  [0, 1], // 2 bottom
  [-1, 0], // 3 left
];

/** Draped cloth: folds deepen toward the free-hanging bottom edge. */
function drapedCloth(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(38, 62, 14, 18);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const hang = 1 - (y + 31) / 62; // 0 at the rod … 1 at the tails
    const folds = Math.sin((x / 38) * Math.PI * 3.2) * 1.9 + Math.sin((x / 38) * Math.PI * 7 + 1.2) * 0.7;
    pos.setZ(i, folds * hang + Math.sin(y * 0.24) * 0.5 * hang);
  }
  g.computeVertexNormals();
  return g;
}

function WallBanner({ color, seat }: { color: PlayerColor; seat: number }) {
  const tex = useMemo(() => bannerTexture(COLORS[color], SYMBOLS[color]), [color]);
  const cloth = useMemo(() => drapedCloth(), []);
  const [dx, dz] = SEAT_DIR[seat] ?? SEAT_DIR[0];
  const dist = (dx !== 0 ? WALL_X : WALL_Z) - 5; // just off the wall face
  const yaw = Math.atan2(-dx, -dz);
  return (
    <group position={[dx * dist, FLOOR_Y + 54, dz * dist]} rotation={[0, yaw, 0]}>
      {/* hanging rod + wall cords */}
      <mesh position={[0, 33, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.9, 0.9, 46, 8]} />
        <meshStandardMaterial {...DARKOAK} />
      </mesh>
      {[-21, 21].map((bx) => (
        <mesh key={bx} position={[bx, 35.5, -2]} rotation={[0.5, 0, 0]}>
          <cylinderGeometry args={[0.35, 0.35, 7, 6]} />
          <meshStandardMaterial color="#6e5a33" roughness={0.9} />
        </mesh>
      ))}
      {[-23, 23].map((bx) => (
        <mesh key={bx} position={[bx, 33, 0]}>
          <sphereGeometry args={[1.6, 8, 8]} />
          <meshStandardMaterial {...GOLDTRIM} />
        </mesh>
      ))}
      {/* the draped cloth */}
      <mesh geometry={cloth} position={[0, 1, 1.2]} rotation={[0.03, 0, 0]} castShadow>
        <meshStandardMaterial
          map={tex}
          transparent
          alphaTest={0.4}
          side={THREE.DoubleSide}
          roughness={0.9}
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
