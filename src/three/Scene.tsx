import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Board } from './Board';
import { DiceLayer } from './Dice';
import { BoardTokens, ClashEffect, DeathAnimations, Units } from './Pieces';
import { arenaCircleTexture, groundBumpTexture, hazyFogTexture, stoneFloorTexture } from './textures';
import { SmithyRoom, TeamBanners } from './Decor';
import { ExteriorWorld } from './Exterior';
import { FantasyProps } from './Props';
import { panState } from './pan';
import { FLOOR_Y } from './coords';
import { useGame } from '../store';

/**
 * Fog backdrop — a cold, hazy night painted onto an equirectangular texture and
 * set as the scene background (a skydome): drifting fog banks, a smothered
 * moon-glow and darkness above. The studio Environment still drives the gold
 * reflections; this only paints the murk.
 */
function FogBackdrop() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const tex = hazyFogTexture();
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
 *  Pale moonlit formers with a warm lantern glow low down, so gilt still
 *  glints through the murk. */
function StudioEnv() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#12140f']} />
      <Lightformer intensity={2.1} position={[0, 6, 2]} scale={[12, 12, 1]} color="#dde5da" />
      <Lightformer intensity={1.2} position={[-6, 3, 4]} scale={[6, 8, 1]} color="#c2ccc0" />
      <Lightformer intensity={1.2} position={[6, 1, -4]} scale={[6, 5, 1]} color="#ffd494" />
      <Lightformer intensity={0.9} position={[-6, 1, -4]} scale={[6, 5, 1]} color="#ffc084" />
    </Environment>
  );
}

// The lanterns, team banners and medieval props now live in ./Decor.

/**
 * The arena the table stands in: a flagstone plaza with a grand gold summoning
 * circle inlaid around the stand, a ring of rune-capped obelisks fading into
 * the mist, and slow-drifting gold motes — so the board reads as the centre-
 * piece of a larger duelling ground rather than a floating tabletop.
 */
function ArenaEnvironment() {
  const floorMap = useMemo(() => {
    const t = stoneFloorTexture();
    t.repeat.set(12, 12); // large slabs — ~7-unit courses across the plaza
    return t;
  }, []);
  const floorBump = useMemo(() => {
    // Clone: the board tiles share this texture at repeat 1.
    const t = groundBumpTexture().clone();
    t.repeat.set(12, 12);
    t.needsUpdate = true;
    return t;
  }, []);
  const circle = useMemo(() => arenaCircleTexture(), []);

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
      arr[i * 3 + 1] = FLOOR_Y + 8 + rand() * 72; // dust throughout the room's height
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
      {/* flagstone floor — square so it runs wall-to-wall under the smithy */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial
          map={floorMap}
          bumpMap={floorBump}
          bumpScale={0.05}
          color="#d9d2c2"
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
    // Keyboard WASD and the mobile arrow pad (panState) both steer the pan.
    const k = keys.current;
    const x = (k.d || panState.d ? 1 : 0) - (k.a || panState.a ? 1 : 0);
    const z = (k.w || panState.w ? 1 : 0) - (k.s || panState.s ? 1 : 0);
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
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.16 }}
      onPointerMissed={() => clearSelection(null)}
    >
      {/* light interior haze — smoke off the forge, not outdoor fog */}
      <fog attach="fog" args={['#241f17', 110, 380]} />

      <FogBackdrop />
      <StudioEnv />
      <ArenaEnvironment />
      <Suspense fallback={null}>
        <SmithyRoom />
        <ExteriorWorld />
        <FantasyProps />
        <TeamBanners />
      </Suspense>
      {/* daylight fill — the open windows pour real sun into the chamber, so
          the ambient floor is lifted well above the old candlelit murk */}
      <hemisphereLight args={['#b8ac97', '#241b12', 0.62]} />
      <ambientLight intensity={0.24} color={'#e2d6c2'} />
      {/* cool daylight slanting in through the north windows (the candles
          carry the warmth; the windows carry the cool) */}
      <directionalLight
        position={[24, 60, -70]}
        intensity={2.2}
        color={'#dfe8ef'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      {/* softer bounce from the south window (no shadow — just fill) */}
      <directionalLight position={[-30, 40, 70]} intensity={0.55} color={'#d9e2e8'} />
      {/* a soft pool over the table keeps the board readable */}
      <spotLight position={[0, 34, 0]} angle={0.7} penumbra={1} intensity={2.5} color={'#ece5d2'} />

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
        maxDistance={32}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2.15}
        target={[0, 0, 0]}
      />
      <WasdPan />
    </Canvas>
  );
}
