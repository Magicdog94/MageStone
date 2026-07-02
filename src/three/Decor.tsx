// Arena set-dressing: team war banners, medieval floor lanterns and scattered
// props (armour, throne, hay, barrels, weapon rack, crates). Pure visuals — the
// banners are the only game-aware piece (one per PLAYING colour, at its seat).
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { PlayerColor } from '../game/types';
import { COLORS, FLOOR_Y } from './coords';
import { bannerTexture, woodBumpTexture, type BannerSymbol } from './textures';
import { useGame } from '../store';

// ---- Team banners ----------------------------------------------------------

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

function Banner({ color, seat }: { color: PlayerColor; seat: number }) {
  const tex = useMemo(() => bannerTexture(COLORS[color], SYMBOLS[color]), [color]);
  const [dx, dz] = SEAT_DIR[seat] ?? SEAT_DIR[0];
  const x = dx * 21;
  const z = dz * 21;
  const yaw = Math.atan2(-dx, -dz); // cloth faces the board
  const iron = { color: '#1c1f22', roughness: 0.6, metalness: 0.5 } as const;
  return (
    <group position={[x, FLOOR_Y, z]} rotation={[0, yaw, 0]}>
      {/* stone footing + pole */}
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.7, 0.5, 8]} />
        <meshStandardMaterial color="#20261f" roughness={0.9} />
      </mesh>
      <mesh position={[0, 4.6, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.15, 8.8, 10]} />
        <meshStandardMaterial {...iron} />
      </mesh>
      {/* crossbar with gold finials */}
      <mesh position={[0, 8.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 5.6, 8]} />
        <meshStandardMaterial {...iron} />
      </mesh>
      {[-2.85, 2.85].map((bx) => (
        <mesh key={bx} position={[bx, 8.55, 0]}>
          <sphereGeometry args={[0.14, 10, 10]} />
          <meshStandardMaterial color="#cba65a" metalness={0.85} roughness={0.35} />
        </mesh>
      ))}
      {/* pole cap */}
      <mesh position={[0, 9.15, 0]} castShadow>
        <coneGeometry args={[0.2, 0.55, 8]} />
        <meshStandardMaterial color="#cba65a" metalness={0.85} roughness={0.35} />
      </mesh>
      {/* the cloth (swallow-tailed texture; slight backward lean like real drape) */}
      <mesh position={[0, 5.05, 0.12]} rotation={[0.05, 0, 0]} castShadow>
        <planeGeometry args={[5.1, 7.1, 1, 8]} />
        <meshStandardMaterial
          map={tex}
          transparent
          alphaTest={0.4}
          side={THREE.DoubleSide}
          roughness={0.85}
          metalness={0}
        />
      </mesh>
    </group>
  );
}

/** One war banner behind every PLAYING colour's seat — none for absent teams. */
export function TeamBanners() {
  const players = useGame((s) => s.game.players);
  const seats = useGame((s) => s.game.seats);
  return (
    <group>
      {players.map((p) => (
        <Banner key={p} color={p} seat={seats[p]} />
      ))}
    </group>
  );
}

// ---- Medieval floor lanterns -------------------------------------------------

/** Tall iron cage lanterns on stone plinths — the arena's main light. */
export function Lanterns() {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const spots = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const r = 16.2 + (i % 2) * 1.6;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, phase: i * 1.7 };
      }),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    spots.forEach((s, i) => {
      const l = lights.current[i];
      if (l) l.intensity = 6.5 + 0.9 * Math.sin(t * 7 + s.phase) + 0.5 * Math.sin(t * 23 + s.phase * 2.3);
    });
  });
  const iron = { color: '#17191c', roughness: 0.65, metalness: 0.45 } as const;
  const bars = useMemo(() => Array.from({ length: 6 }, (_, k) => (k / 6) * Math.PI * 2), []);
  return (
    <group>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, FLOOR_Y, s.z]}>
          {/* stepped stone plinth */}
          <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.62, 0.78, 0.36, 8]} />
            <meshStandardMaterial color="#232a24" roughness={0.92} />
          </mesh>
          <mesh position={[0, 0.46, 0]} castShadow>
            <cylinderGeometry args={[0.44, 0.52, 0.22, 8]} />
            <meshStandardMaterial color="#1b211c" roughness={0.92} />
          </mesh>
          {/* iron pan the cage sits on */}
          <mesh position={[0, 0.62, 0]} castShadow>
            <cylinderGeometry args={[0.52, 0.44, 0.12, 10]} />
            <meshStandardMaterial {...iron} />
          </mesh>
          {/* amber glass core */}
          <mesh position={[0, 1.25, 0]}>
            <cylinderGeometry args={[0.34, 0.4, 1.15, 12]} />
            <meshStandardMaterial
              color="#54371a"
              emissive="#ffb066"
              emissiveIntensity={2.4}
              roughness={0.35}
              transparent
              opacity={0.94}
            />
          </mesh>
          {/* iron cage bars */}
          {bars.map((a) => (
            <mesh key={a} position={[Math.cos(a) * 0.45, 1.25, Math.sin(a) * 0.45]} castShadow>
              <cylinderGeometry args={[0.035, 0.035, 1.2, 6]} />
              <meshStandardMaterial {...iron} />
            </mesh>
          ))}
          {/* peaked iron roof + ring finial */}
          <mesh position={[0, 2.1, 0]} castShadow>
            <coneGeometry args={[0.62, 0.62, 8]} />
            <meshStandardMaterial {...iron} />
          </mesh>
          <mesh position={[0, 2.52, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.13, 0.035, 8, 16]} />
            <meshStandardMaterial {...iron} />
          </mesh>
          <pointLight
            ref={(el) => {
              lights.current[i] = el;
            }}
            position={[0, 1.3, 0]}
            color="#ffa562"
            intensity={6.5}
            distance={30}
            decay={1.6}
          />
        </group>
      ))}
    </group>
  );
}

// ---- Medieval props ----------------------------------------------------------

const WOOD = { color: '#4a3421', roughness: 0.85, metalness: 0 } as const;
const DARKWOOD = { color: '#332416', roughness: 0.88, metalness: 0 } as const;
const STEEL = { color: '#6a7078', roughness: 0.35, metalness: 0.85 } as const;
const STRAW = { color: '#a8894a', roughness: 1, metalness: 0 } as const;

function SuitOfArmour(props: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group {...props}>
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.3, 1.1]} />
        <meshStandardMaterial color="#242b25" roughness={0.9} />
      </mesh>
      {/* legs */}
      {[-0.18, 0.18].map((lx) => (
        <mesh key={lx} position={[lx, 0.75, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.11, 0.9, 8]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      ))}
      {/* cuirass */}
      <mesh position={[0, 1.55, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.38, 0.85, 10]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      {/* pauldrons */}
      {[-0.42, 0.42].map((px) => (
        <mesh key={px} position={[px, 1.92, 0]} castShadow>
          <sphereGeometry args={[0.19, 10, 10]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      ))}
      {/* helm with visor slit + crest */}
      <mesh position={[0, 2.3, 0]} castShadow>
        <sphereGeometry args={[0.24, 12, 12]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <mesh position={[0, 2.28, 0.21]}>
        <boxGeometry args={[0.3, 0.05, 0.08]} />
        <meshStandardMaterial color="#0a0c0e" roughness={0.6} />
      </mesh>
      <mesh position={[0, 2.62, 0]} castShadow>
        <coneGeometry args={[0.07, 0.35, 8]} />
        <meshStandardMaterial color="#cba65a" metalness={0.85} roughness={0.35} />
      </mesh>
      {/* halberd at its side */}
      <group position={[0.62, 0, 0]} rotation={[0, 0, -0.06]}>
        <mesh position={[0, 1.6, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.05, 3.0, 8]} />
          <meshStandardMaterial {...DARKWOOD} />
        </mesh>
        <mesh position={[0.12, 2.9, 0]} castShadow>
          <boxGeometry args={[0.34, 0.5, 0.05]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      </group>
    </group>
  );
}

function Throne(props: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group {...props}>
      {/* seat + legs */}
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.18, 1.0]} />
        <meshStandardMaterial {...DARKWOOD} />
      </mesh>
      {[-0.5, 0.5].map((lx) =>
        [-0.4, 0.4].map((lz) => (
          <mesh key={`${lx}${lz}`} position={[lx, 0.25, lz]} castShadow>
            <boxGeometry args={[0.14, 0.5, 0.14]} />
            <meshStandardMaterial {...DARKWOOD} />
          </mesh>
        )),
      )}
      {/* tall back with gold cap */}
      <mesh position={[0, 1.5, -0.45]} rotation={[-0.06, 0, 0]} castShadow>
        <boxGeometry args={[1.2, 1.9, 0.16]} />
        <meshStandardMaterial {...DARKWOOD} />
      </mesh>
      <mesh position={[0, 2.44, -0.51]} rotation={[-0.06, 0, 0]}>
        <boxGeometry args={[1.26, 0.12, 0.2]} />
        <meshStandardMaterial color="#cba65a" metalness={0.85} roughness={0.35} />
      </mesh>
      {/* armrests */}
      {[-0.6, 0.6].map((ax) => (
        <group key={ax}>
          <mesh position={[ax, 0.92, 0.05]} castShadow>
            <boxGeometry args={[0.14, 0.1, 0.85]} />
            <meshStandardMaterial {...DARKWOOD} />
          </mesh>
          <mesh position={[ax, 0.75, 0.4]}>
            <boxGeometry args={[0.12, 0.28, 0.12]} />
            <meshStandardMaterial {...DARKWOOD} />
          </mesh>
        </group>
      ))}
      {/* cushion */}
      <mesh position={[0, 0.7, 0.03]}>
        <boxGeometry args={[1.0, 0.14, 0.8]} />
        <meshStandardMaterial color="#6f1f1c" roughness={0.9} />
      </mesh>
    </group>
  );
}

function HayPile(props: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group {...props}>
      {[
        [-0.5, 0.42, 0],
        [0.55, 0.42, 0.15],
        [0.02, 1.2, 0.05],
      ].map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, i * 0.4, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[0.42, 0.42, 1.25, 12]} />
          <meshStandardMaterial {...STRAW} />
        </mesh>
      ))}
      {/* loose hay on the flagstones */}
      <mesh position={[0, 0.03, 0.6]} rotation={[-Math.PI / 2, 0, 0.5]}>
        <circleGeometry args={[1.1, 10]} />
        <meshStandardMaterial color="#8f7440" roughness={1} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

function Barrels(props: { position: [number, number, number]; rotation?: [number, number, number] }) {
  const bump = useMemo(() => {
    const t = woodBumpTexture().clone();
    t.needsUpdate = true;
    return t;
  }, []);
  const barrel = (x: number, z: number, h: number, lean = 0) => (
    <group key={`${x}${z}`} position={[x, h, z]} rotation={[0, 0, lean]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.4, 0.44, 1.0, 12]} />
        <meshStandardMaterial {...WOOD} bumpMap={bump} bumpScale={0.03} />
      </mesh>
      {[-0.3, 0.3].map((hy) => (
        <mesh key={hy} position={[0, hy, 0]}>
          <cylinderGeometry args={[0.455, 0.455, 0.07, 12]} />
          <meshStandardMaterial color="#22262a" roughness={0.6} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
  return (
    <group {...props}>
      {barrel(0, 0, 0.5)}
      {barrel(0.85, 0.25, 0.5)}
      {barrel(0.42, 0.1, 1.35, 0.04)}
    </group>
  );
}

function WeaponRack(props: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group {...props}>
      {/* frame: two posts + rail */}
      {[-0.9, 0.9].map((px) => (
        <mesh key={px} position={[px, 0.8, 0]} castShadow>
          <boxGeometry args={[0.14, 1.6, 0.14]} />
          <meshStandardMaterial {...DARKWOOD} />
        </mesh>
      ))}
      <mesh position={[0, 1.5, 0]} castShadow>
        <boxGeometry args={[2.0, 0.12, 0.12]} />
        <meshStandardMaterial {...DARKWOOD} />
      </mesh>
      {/* leaning spears */}
      {[-0.5, -0.1].map((sx, i) => (
        <group key={sx} position={[sx, 0, 0.15]} rotation={[0.16, 0, i === 0 ? 0.05 : -0.04]}>
          <mesh position={[0, 1.15, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.04, 2.3, 6]} />
            <meshStandardMaterial {...WOOD} />
          </mesh>
          <mesh position={[0, 2.42, 0]} castShadow>
            <coneGeometry args={[0.07, 0.34, 8]} />
            <meshStandardMaterial {...STEEL} />
          </mesh>
        </group>
      ))}
      {/* sword resting against the rail */}
      <group position={[0.42, 0, 0.14]} rotation={[0.15, 0, -0.08]}>
        <mesh position={[0, 0.85, 0]} castShadow>
          <boxGeometry args={[0.09, 1.5, 0.03]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[0, 1.62, 0]}>
          <boxGeometry args={[0.34, 0.07, 0.06]} />
          <meshStandardMaterial color="#cba65a" metalness={0.85} roughness={0.35} />
        </mesh>
      </group>
      {/* round shield leaning on the post */}
      <mesh position={[0.95, 0.55, 0.32]} rotation={[0.32, 0, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.07, 18]} />
        <meshStandardMaterial color="#5a2320" roughness={0.7} />
      </mesh>
      <mesh position={[0.95, 0.57, 0.49]} rotation={[0.32 + Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.11, 10, 10]} />
        <meshStandardMaterial color="#cba65a" metalness={0.85} roughness={0.35} />
      </mesh>
    </group>
  );
}

function Crates(props: { position: [number, number, number]; rotation?: [number, number, number] }) {
  const crate = (x: number, y: number, z: number, s: number, ry: number) => (
    <group key={`${x}${y}`} position={[x, y, z]} rotation={[0, ry, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[s, s, s]} />
        <meshStandardMaterial {...WOOD} />
      </mesh>
      {/* edge frames */}
      <mesh>
        <boxGeometry args={[s * 1.04, s * 0.16, s * 1.04]} />
        <meshStandardMaterial {...DARKWOOD} />
      </mesh>
    </group>
  );
  return (
    <group {...props}>
      {crate(0, 0.45, 0, 0.9, 0)}
      {crate(1.0, 0.38, 0.2, 0.76, 0.5)}
      {crate(0.3, 1.26, 0.05, 0.72, 0.25)}
    </group>
  );
}

/** Fixed arrangement of medieval props around the plaza (between the lantern
 *  ring and the banners, clear of the summoning circle). */
export function ArenaProps() {
  return (
    <group>
      <SuitOfArmour position={[13.5, FLOOR_Y, -13.5]} rotation={[0, (Math.PI * 3) / 4, 0]} />
      <SuitOfArmour position={[-13.5, FLOOR_Y, -13.5]} rotation={[0, -(Math.PI * 3) / 4, 0]} />
      <Throne position={[-19.5, FLOOR_Y, 6.5]} rotation={[0, Math.PI / 2.4, 0]} />
      <HayPile position={[18.5, FLOOR_Y, 9]} rotation={[0, -0.7, 0]} />
      <Barrels position={[9, FLOOR_Y, 19.5]} rotation={[0, 0.4, 0]} />
      <WeaponRack position={[-9.5, FLOOR_Y, 19]} rotation={[0, Math.PI + 0.5, 0]} />
      <Crates position={[20, FLOOR_Y, -7]} rotation={[0, 1.1, 0]} />
    </group>
  );
}
