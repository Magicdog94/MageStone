// Fantasy-prop set dressing for the chamber interior — Quaternius Fantasy
// Props MegaKit models (slimmed to baseColor-only GLTFs, sharing the trim
// atlases already served from /models/exterior). Everything here is
// decoration: placed against the walls and in the corners, at the room's real
// scale (1 m ≈ 32 units), well outside the board, the camera orbit and every
// existing furnishing. No gameplay, no new lights (the two door torches use
// emissive flames + a glow sprite instead of real point lights).
import { useMemo } from 'react';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { Billboard, useGLTF } from '@react-three/drei';
import { FLOOR_Y } from './coords';
import { flameGlowTexture } from './textures';

const KIT = '/models/exterior/';
const M = 32; // world units per metre (matches Decor.tsx)

/** Load a prop and give its (shared) materials a candlelit-interior finish. */
function useProp(name: string): THREE.Group {
  const { scene } = useGLTF(KIT + name + '.gltf');
  return useMemo(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.userData.propFixed) continue;
        std.userData.propFixed = true;
        const metal = /metal/i.test(std.name);
        std.metalness = metal ? 0.5 : 0;
        std.roughness = metal ? 0.45 : 0.85;
        std.envMapIntensity = metal ? 0.7 : 0.3;
        // subtle lift so the props stay readable under candlelight
        std.emissive = new THREE.Color('#ffffff');
        std.emissiveIntensity = 0.07;
        if (std.map) std.emissiveMap = std.map;
        std.needsUpdate = true;
      }
    });
    return scene;
  }, [scene]);
}

/** One placed clone of a kit prop (clones share the fixed materials). */
function Prop({
  name,
  pos,
  ry = 0,
  rx = 0,
  s = M,
}: {
  name: string;
  pos: [number, number, number];
  ry?: number;
  rx?: number;
  s?: number;
}) {
  const src = useProp(name);
  // SkeletonUtils.clone, NOT clone(true): some props (e.g. the chest) ship an
  // armature, and a plain clone leaves the skin bound to the ORIGINAL bones —
  // rendering the mesh at the world origin instead of where it was placed.
  const obj = useMemo(() => SkeletonUtils.clone(src) as THREE.Group, [src]);
  return <primitive object={obj} position={pos} rotation={[rx, ry, 0]} scale={s} />;
}

/** A lit wall torch: the kit's iron bracket plus an emissive flame and a warm
 *  glow sprite — no real light, so the lighting budget is untouched. */
function WallTorch({ pos, ry }: { pos: [number, number, number]; ry: number }) {
  const glow = useMemo(() => flameGlowTexture(), []);
  return (
    <group position={pos} rotation={[0, ry, 0]}>
      <Prop name="Torch_Metal" pos={[0, 0, 0]} s={24} />
      {/* flame above the basket (the basket sits ~0.37 m up, 0.39 m out) */}
      <group position={[0, 10, 8.5]}>
        <mesh scale={[1, 1.7, 1]}>
          <sphereGeometry args={[1.5, 8, 8]} />
          <meshStandardMaterial color="#ffd989" emissive="#ff9a3a" emissiveIntensity={3.4} />
        </mesh>
        <Billboard position={[0, 1.4, 0]}>
          <mesh renderOrder={20}>
            <planeGeometry args={[13, 13]} />
            <meshBasicMaterial map={glow} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        </Billboard>
      </group>
    </group>
  );
}

/**
 * The dressed corners of the chamber:
 *  - a library nook on the west wall (bookcase, shelved books, a lectern with
 *    an open tome)
 *  - a treasure corner beside it (banded chest, chalice, spilt coins, satchel)
 *  - an alchemy wall shelf with potions above the chest
 *  - a cauldron by the forge
 *  - an armoury rack under the east-wall shelves (sword + wooden shield)
 *  - apples in the north-east barrel corner
 *  - books, scrolls and a mug on the workbench
 *  - torches flanking the great door
 */
export function FantasyProps() {
  return (
    <group>
      {/* ---- arcane library (west wall, between the banner zone and the
              crates): a tall bookcase stocked with books, potions and a
              chalice, and a lectern with an open tome before it ---- */}
      <Prop name="Bookcase_2" pos={[-65, FLOOR_Y, 44]} ry={Math.PI / 2} />
      <Prop name="BookGroup_Medium_1" pos={[-65, FLOOR_Y + 19.5, 46]} ry={Math.PI / 2} />
      <Prop name="BookGroup_Small_1" pos={[-65, FLOOR_Y + 19.5, 33]} ry={Math.PI / 2} />
      <Prop name="BookGroup_Medium_2" pos={[-65, FLOOR_Y + 45.5, 43]} ry={Math.PI / 2} />
      <Prop name="Chalice" pos={[-65, FLOOR_Y + 45.5, 55]} />
      <Prop name="Book_Stack_1" pos={[-65, FLOOR_Y + 71.5, 48]} ry={Math.PI / 2 + 0.3} />
      <Prop name="Potion_2" pos={[-65, FLOOR_Y + 71.5, 34]} />
      <Prop name="Potion_1" pos={[-65, FLOOR_Y + 71.5, 29]} />
      <Prop name="SmallBottles_1" pos={[-65, FLOOR_Y + 19.5, 52]} ry={Math.PI / 2} />

      {/* ---- cauldron in the north-west corner ---- */}
      <Prop name="Cauldron" pos={[-44, FLOOR_Y, -62]} ry={0.3} />

      {/* ---- armoury rack under the east-wall shelves ---- */}
      <Prop name="WeaponStand" pos={[56, FLOOR_Y, -44]} ry={-Math.PI / 2} />
      <Prop name="Sword_Bronze" pos={[56, FLOOR_Y + 7, -50]} ry={-Math.PI / 2} rx={-0.2} />
      <Prop name="Shield_Wooden" pos={[53, FLOOR_Y + 10, -30]} ry={-Math.PI / 2 - 0.5} rx={0.25} />

      {/* ---- wall torch in the north-east corner ---- */}
      <WallTorch pos={[56, FLOOR_Y + 52, -85.5]} ry={0} />
    </group>
  );
}

for (const n of [
  'Bookcase_2',
  'BookGroup_Medium_1',
  'BookGroup_Medium_2',
  'BookGroup_Small_1',
  'Book_Stack_1',
  'Chalice',
  'Potion_1',
  'Potion_2',
  'SmallBottles_1',
  'Cauldron',
  'WeaponStand',
  'Sword_Bronze',
  'Shield_Wooden',
  'Torch_Metal',
]) {
  useGLTF.preload(KIT + n + '.gltf');
}
