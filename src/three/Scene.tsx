import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Board } from './Board';
import { DiceLayer } from './Dice';
import { ClashEffect, DeathAnimations, Gravestones, Stones, Units } from './Pieces';
import { useGame } from '../store';

/**
 * Skybox — the source art is a 4×3 horizontal-cross cubemap (up / left-front-
 * right-back / down). three dropped its cross loader, so slice the six faces
 * into a CubeTexture and set it as the scene background. The studio Environment
 * still drives reflections; this only paints the sky behind the board.
 */
function Skybox() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const img = new Image();
    let tex: THREE.CubeTexture | null = null;
    img.onload = () => {
      const f = img.width / 4; // 4 faces wide → face edge in px
      const cut = (col: number, row: number) => {
        const c = document.createElement('canvas');
        c.width = c.height = f;
        c.getContext('2d')!.drawImage(img, col * f, row * f, f, f, 0, 0, f, f);
        return c;
      };
      // CubeTexture order [+x, -x, +y, -y, +z, -z] from the cross cells:
      //   .  U  .  .        +y = (1,0)
      //   L  F  R  B    -x=(0,1) +z=(1,1) +x=(2,1) -z=(3,1)
      //   .  D  .  .        -y = (1,2)
      tex = new THREE.CubeTexture([cut(2, 1), cut(0, 1), cut(1, 0), cut(1, 2), cut(1, 1), cut(3, 1)]);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      scene.background = tex;
    };
    img.src = '/sky-cubemap.png';
    return () => {
      if (scene.background === tex) scene.background = null;
      tex?.dispose();
    };
  }, [scene]);
  return null;
}

/** Procedural studio environment — drives metallic gold reflections, no HDRI. */
function StudioEnv() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#05070a']} />
      <Lightformer intensity={3} position={[0, 6, 2]} scale={[12, 12, 1]} color="#fff3d6" />
      <Lightformer intensity={1.6} position={[-6, 3, 4]} scale={[6, 8, 1]} color="#9fb6e0" />
      <Lightformer intensity={1.4} position={[6, 3, -4]} scale={[6, 8, 1]} color="#ffd9a0" />
      <Lightformer intensity={0.8} position={[0, 2, -8]} scale={[14, 6, 1]} color="#3a4a66" />
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
      <fog attach="fog" args={['#0a0d12', 30, 70]} />

      <Skybox />
      <StudioEnv />
      <hemisphereLight args={['#aeb8cc', '#161410', 0.35]} />
      <ambientLight intensity={0.12} />
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
      <directionalLight position={[-12, 9, -6]} intensity={0.5} color={'#6f8bd0'} />

      <Suspense fallback={null}>
        <Board />
      </Suspense>
      <Stones />
      <Gravestones />
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
