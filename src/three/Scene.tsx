import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Board } from './Board';
import { DiceLayer } from './Dice';
import { BoardTokens, ClashEffect, DeathAnimations, Units } from './Pieces';
import { arenaCircleTexture, duelNightTexture, groundBumpTexture, stoneFloorTexture } from './textures';
import { FLOOR_Y } from './coords';
import { useGame } from '../store';

/**
 * Duel-night backdrop — the box-cover scene painted onto an equirectangular
 * texture and set as the scene background (a skydome): emerald storm sky,
 * arcane sigil, mountain + forest silhouettes, and the two rival castles
 * (blue-lit and red-lit). The studio Environment still drives the gold
 * reflections; this only paints the world.
 */
function DuelBackdrop() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const tex = duelNightTexture();
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const prev = scene.background;
    // Three.js scene background is an imperative API; assigning it is the side
    // effect this hook exists for.
    // eslint-disable-next-line react-hooks/immutability
    scene.background = tex;
    return () => {
      if (scene.background === tex) scene.background = prev;
    };
  }, [scene]);
  return null;
}

/** Procedural studio environment — drives metallic gold reflections, no HDRI.
 *  Warm gilt key with emerald sheen, plus faint blue/red formers echoing the
 *  duelling mages of the cover. */
function StudioEnv() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#07120c']} />
      <Lightformer intensity={2.6} position={[0, 6, 2]} scale={[12, 12, 1]} color="#ffe6b8" />
      <Lightformer intensity={1.3} position={[-6, 3, 4]} scale={[6, 8, 1]} color="#bfe8d0" />
      <Lightformer intensity={1.2} position={[6, 3, -4]} scale={[6, 8, 1]} color="#ffcf8a" />
      <Lightformer intensity={0.8} position={[-8, 2, -2]} scale={[5, 7, 1]} color="#4a86c8" />
      <Lightformer intensity={0.7} position={[8, 2, 2]} scale={[5, 7, 1]} color="#c85a42" />
    </Environment>
  );
}

/**
 * The arena the table stands in: a flagstone plaza with a grand gold summoning
 * circle inlaid around the stand, a ring of rune-capped obelisks fading into
 * the mist, and slow-drifting gold motes — so the board reads as the centre-
 * piece of a larger duelling ground rather than a floating tabletop.
 */
function ArenaEnvironment() {
  const floorMap = useMemo(() => {
    const t = stoneFloorTexture();
    t.repeat.set(20, 20);
    return t;
  }, []);
  const floorBump = useMemo(() => {
    // Clone: the board tiles share this texture at repeat 1.
    const t = groundBumpTexture().clone();
    t.repeat.set(20, 20);
    t.needsUpdate = true;
    return t;
  }, []);
  const circle = useMemo(() => arenaCircleTexture(), []);

  // Obelisk ring (deterministic layout — no per-render randomness).
  const obelisks = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const r = 30 + (i % 2) * 5;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: a };
      }),
    [],
  );

  // Gold motes drifting around the table (seeded LCG — pure & stable per render).
  const motePositions = useMemo(() => {
    let seed = 987654321;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const n = 180;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = 6 + rand() * 22;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = FLOOR_Y + 1.5 + rand() * 8;
      arr[i * 3 + 2] = Math.sin(a) * r;
    }
    return arr;
  }, []);
  const motes = useRef<THREE.Points>(null);
  useFrame((_, dt) => {
    if (motes.current) motes.current.rotation.y += dt * 0.014;
  });

  return (
    <group>
      {/* flagstone plaza, fading into the fog */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <circleGeometry args={[85, 72]} />
        <meshStandardMaterial
          map={floorMap}
          bumpMap={floorBump}
          bumpScale={0.05}
          color="#cfd8cf"
          roughness={0.94}
          metalness={0}
          envMapIntensity={0.15}
        />
      </mesh>
      {/* gold summoning circle inlaid around the stand */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.02, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshBasicMaterial map={circle} transparent opacity={0.85} depthWrite={false} />
      </mesh>
      {/* rune obelisks ringing the arena */}
      {obelisks.map((o, i) => (
        <group key={i} position={[o.x, FLOOR_Y, o.z]} rotation={[0, o.yaw, 0]}>
          <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[1.6, 1.9, 0.6, 4]} />
            <meshStandardMaterial color="#131b14" roughness={0.92} />
          </mesh>
          <mesh position={[0, 3.9, 0]} castShadow>
            <cylinderGeometry args={[0.75, 1.25, 7.2, 4]} />
            <meshStandardMaterial color="#0f1a13" roughness={0.9} />
          </mesh>
          <mesh position={[0, 8.05, 0]}>
            <coneGeometry args={[0.62, 1.1, 4]} />
            <meshStandardMaterial
              color="#151d16"
              emissive="#caa85e"
              emissiveIntensity={0.55}
              roughness={0.6}
            />
          </mesh>
        </group>
      ))}
      {/* slow-drifting gold motes */}
      <points ref={motes}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[motePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#ffd98a"
          size={0.09}
          sizeAttenuation
          transparent
          opacity={0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

/**
 * WASD panning. Translates the camera and the OrbitControls target together
 * along the view's ground directions, so the orbit distance/angle (and thus
 * rotate + zoom) are unchanged — only the look-at point glides across the board.
 * W/S = toward/away along the view; A/D = strafe; target is clamped to the board.
 */
const PAN_KEYS = new Set(['w', 'a', 's', 'd']);
type OrbitLike = THREE.EventDispatcher & { target: THREE.Vector3; update: () => void };
function WasdPan({ speed = 10, bound = 11 }: { speed?: number; bound?: number }) {
  const keys = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return !!el && /^(input|textarea|select)$/i.test(el.tagName);
    };
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (PAN_KEYS.has(k) && !typing()) keys.current[k] = true;
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (PAN_KEYS.has(k)) keys.current[k] = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  useFrame((state, dt) => {
    const controls = state.controls as OrbitLike | null;
    if (!controls) return;
    const k = keys.current;
    const x = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    const z = (k.w ? 1 : 0) - (k.s ? 1 : 0);
    if (x === 0 && z === 0) return;

    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const move = new THREE.Vector3();
    const camera = state.camera;
    camera.getWorldDirection(fwd); // view direction, flattened to the ground
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) return;
    fwd.normalize();
    right.setFromMatrixColumn(camera.matrixWorld, 0); // camera's right axis
    right.y = 0;
    right.normalize();

    move.copy(fwd).multiplyScalar(z).addScaledVector(right, x);
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(speed * dt);

    const t = controls.target;
    const nx = THREE.MathUtils.clamp(t.x + move.x, -bound, bound);
    const nz = THREE.MathUtils.clamp(t.z + move.z, -bound, bound);
    const dx = nx - t.x;
    const dz = nz - t.z;
    if (dx === 0 && dz === 0) return;
    t.x = nx;
    t.z = nz;
    camera.position.x += dx;
    camera.position.z += dz;
    controls.update();
  });

  return null;
}

export function Scene() {
  const clearSelection = useGame((s) => s.selectUnit);
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [0, 20, 21], fov: 38 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onPointerMissed={() => clearSelection(null)}
    >
      <fog attach="fog" args={['#04100a', 34, 90]} />

      <DuelBackdrop />
      <StudioEnv />
      <ArenaEnvironment />
      <hemisphereLight args={['#8fb8a0', '#0a1410', 0.5]} />
      <ambientLight intensity={0.12} color={'#cfe0d0'} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={2.3}
        color={'#fff1d8'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      {/* the duelling mages' light: blue rim from the left, red from the right */}
      <directionalLight position={[-14, 7, -8]} intensity={0.5} color={'#6fb6e8'} />
      <directionalLight position={[14, 6, -8]} intensity={0.45} color={'#e8785a'} />

      <Suspense fallback={null}>
        <Board />
      </Suspense>
      <BoardTokens />
      <Suspense fallback={null}>
        <Units />
        <DeathAnimations />
      </Suspense>
      <ClashEffect />
      <Suspense fallback={null}>
        <DiceLayer />
      </Suspense>

      <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={24} blur={2.4} far={6} />

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={10}
        maxDistance={42}
        maxPolarAngle={Math.PI / 2.15}
        target={[0, 0, 0]}
      />
      <WasdPan />
    </Canvas>
  );
}
