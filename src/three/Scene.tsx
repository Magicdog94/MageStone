import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Board } from './Board';
import { DiceLayer } from './Dice';
import { BoardTokens, ClashEffect, DeathAnimations, Units } from './Pieces';
import { arenaCircleTexture, hazyFogTexture, tudorFloorTexture } from './textures';
import { SmithyRoom, TeamBanners } from './Decor';
import { FantasyProps } from './Props';

// The castle-town outside the windows is the heaviest scenery and pure garnish —
// code-split it so the BOARD is playable before the town even starts loading.
const ExteriorWorld = lazy(() =>
  import('./Exterior').then((m) => ({ default: m.ExteriorWorld })),
);
import { panState } from './pan';
import { FLOOR_Y } from './coords';
import { useGame } from '../store';
import type { ReactNode } from 'react';

/**
 * Camera-lock mode: the camera never moves between turns — instead the whole
 * BOARD (tiles, pieces, tokens) glides through quarter-turns so the acting
 * human player's home edge always faces the camera. `viewOffset` (store) is
 * maintained per turn; bots never move it. The room stays put, which reads as
 * "the table is turned toward you" — exactly hot-seat table manners.
 */
function BoardSpin({ children }: { children: ReactNode }) {
  const offset = useGame((s) => s.viewOffset);
  const target = -offset * (Math.PI / 2);
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const gr = g.current;
    if (!gr) return;
    // shortest-path ease toward the target quarter-turn
    let d = target - gr.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 0.0005) {
      gr.rotation.y = target;
      return;
    }
    gr.rotation.y += d * Math.min(1, dt * 3.2);
  });
  return <group ref={g}>{children}</group>;
}

/** Snaps the camera back to its start pose when the camera-lock is switched on. */
function CamReset() {
  const nonce = useGame((s) => s.camResetNonce);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3; update?: () => void } | null;
  useEffect(() => {
    if (!nonce) return;
    camera.position.set(0, 20, 21);
    controls?.target?.set(0, 0, 0);
    controls?.update?.();
  }, [nonce, camera, controls]);
  return null;
}

/**
 * Fog backdrop — a cold, hazy night painted onto an equirectangular texture and
 * set as the scene background (a skydome): drifting fog banks, a smothered
 * moon-glow and darkness above. The studio Environment still drives the gold
 * reflections; this only paints the murk.
 */
function FogBackdrop() {
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  // TEMP DEV RIG: headless-preview helpers (camera teleport + canvas capture).
  // Dev-only; remove before shipping visual work built on top of them.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__r3f = get;
    w.__cam = (px: number, py: number, pz: number, tx = 0, ty = 0, tz = 0) => {
      const st = get();
      const controls = st.controls as unknown as {
        target: THREE.Vector3;
        update: () => void;
        minDistance: number;
        maxDistance: number;
        minPolarAngle: number;
        maxPolarAngle: number;
      } | null;
      st.camera.position.set(px, py, pz);
      if (controls) {
        controls.minDistance = 1;
        controls.maxDistance = 600;
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = Math.PI;
        controls.target.set(tx, ty, tz);
        controls.update();
      } else st.camera.lookAt(tx, ty, tz);
    };
    w.__shot = (maxW = 640, quality = 0.72, frames = 3) => {
      const st = get();
      // Hidden headless windows never fire rAF, so useFrame callbacks (unit
      // placement, glides) starve — pump the loop manually before capturing.
      const adv = (st as unknown as { advance?: (t: number) => void }).advance;
      for (let i = 0; i < frames; i++) {
        if (typeof adv === 'function') adv(performance.now() + i * 16.7);
        else st.gl.render(st.scene, st.camera);
      }
      st.gl.render(st.scene, st.camera); // fresh frame in the drawing buffer
      const src = st.gl.domElement;
      const scale = Math.min(1, maxW / src.width);
      const c = document.createElement('canvas');
      c.width = Math.round(src.width * scale);
      c.height = Math.round(src.height * scale);
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', quality);
    };
  }, [get]);
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
 * The arena the table stands in: a floor of dark old oak — WIDE boards, laid
 * wall to wall — with the grand gold summoning circle inlaid around the
 * stand, and slow-drifting gold motes.
 */
function ArenaEnvironment() {
  const floorMap = useMemo(() => {
    const t = tudorFloorTexture();
    // 3 repeats over 200 units → boards ~11 units (~35 cm) wide: WIDE panels
    t.repeat.set(3, 3);
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
      {/* dark oak plank floor — square so it runs wall-to-wall under the room */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial
          map={floorMap}
          color="#75654f"
          roughness={0.82}
          metalness={0}
          envMapIntensity={0.3}
        />
      </mesh>
      {/* gold summoning circle inlaid around the stand — 3× its old size so
          the ring detail shows on the floor beyond the tabletop's shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y + 0.02, 0]}>
        <planeGeometry args={[90, 90]} />
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
  const lowGfx = useGame((s) => s.settings.lowGfx);
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ position: [0, 20, 21], fov: 38 }}
      gl={{
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.16,
        // DEV only: lets the headless-preview __shot helper read the canvas
        preserveDrawingBuffer: import.meta.env.DEV,
      }}
      onPointerMissed={() => clearSelection(null)}
    >
      {/* light interior haze — smoke off the forge, not outdoor fog */}
      <fog attach="fog" args={['#241f17', 110, 380]} />

      <FogBackdrop />
      <StudioEnv />
      <ArenaEnvironment />
      <Suspense fallback={null}>
        <SmithyRoom />
        <TeamBanners />
        {/* Low graphics: skip the exterior town + prop dressing entirely */}
        {!lowGfx && <FantasyProps />}
      </Suspense>
      {!lowGfx && (
        <Suspense fallback={null}>
          <ExteriorWorld />
        </Suspense>
      )}
      {/* daylight fill — the open windows pour real sun into the chamber, so
          the ambient floor is lifted well above the old candlelit murk */}
      {/* ground term lifted so DOWN-facing surfaces (the beamed ceiling when
          the player tilts up) read as warm wood instead of a black void */}
      <hemisphereLight args={['#b8ac97', '#4a3b2c', 0.62]} />
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
      {/* (no spotlight over the table — its pool read as a light stain on the
          tabletop; the ambient + window daylight carry the board instead) */}

      {/* cell-space content spins together under the camera lock; the DICE
          layer stays in world space (its tray math remaps to the visual seat) */}
      <BoardSpin>
        <Suspense fallback={null}>
          <Board />
        </Suspense>
        <BoardTokens />
        <Suspense fallback={null}>
          <Units />
          <DeathAnimations />
        </Suspense>
        <ClashEffect />
      </BoardSpin>
      <Suspense fallback={null}>
        <DiceLayer />
      </Suspense>
      <CamReset />

      <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={24} blur={2.4} far={6} />

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={10}
        maxDistance={32}
        minPolarAngle={0.35}
        /* dips ~22° below the table plane, so tilting up reveals the beamed
           ceiling and the chandelier without the camera entering the table */
        maxPolarAngle={Math.PI * 0.62}
        target={[0, 0, 0]}
      />
      <WasdPan />
    </Canvas>
  );
}
