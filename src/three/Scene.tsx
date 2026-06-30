import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Board } from './Board';
import { DiceLayer } from './Dice';
import { BoardTokens, ClashEffect, DeathAnimations, Units } from './Pieces';
import { castleHallTexture } from './textures';
import { useGame } from '../store';

/**
 * Castle-hall backdrop — a procedural torch-lit great hall painted onto an
 * equirectangular texture and set as the scene background (a skydome), so the
 * board reads as resting on a table inside a medieval castle. The studio
 * Environment still drives the gold reflections; this only paints the hall.
 */
function CastleBackdrop() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const tex = castleHallTexture();
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
 *  Warm torch-lit tones to match the castle hall. */
function StudioEnv() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#0a0805']} />
      <Lightformer intensity={3} position={[0, 6, 2]} scale={[12, 12, 1]} color="#ffe6b8" />
      <Lightformer intensity={1.8} position={[-6, 3, 4]} scale={[6, 8, 1]} color="#e8a04a" />
      <Lightformer intensity={1.5} position={[6, 3, -4]} scale={[6, 8, 1]} color="#ffcf8a" />
      <Lightformer intensity={0.7} position={[0, 2, -8]} scale={[14, 6, 1]} color="#5a3a1e" />
    </Environment>
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
      camera={{ position: [0, 16, 17], fov: 38 }}
      gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onPointerMissed={() => clearSelection(null)}
    >
      <fog attach="fog" args={['#0e0a07', 32, 74]} />

      <CastleBackdrop />
      <StudioEnv />
      <hemisphereLight args={['#c2a472', '#171009', 0.4]} />
      <ambientLight intensity={0.14} color={'#d8b98a'} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={2.4}
        color={'#fff1d8'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      {/* warm torch fill from the side */}
      <directionalLight position={[-12, 9, -6]} intensity={0.6} color={'#e0883a'} />

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
        maxDistance={34}
        maxPolarAngle={Math.PI / 2.15}
        target={[0, 0, 0]}
      />
      <WasdPan />
    </Canvas>
  );
}
