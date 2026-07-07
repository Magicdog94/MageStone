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
import { contactShadowTexture, flameGlowTexture } from './textures';
import { useGame } from '../store';

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

/** A soft contact shadow laid on the floor under a piece of furniture, so it
 *  sits INTO the room instead of floating on the flagstones. */
function ShadowBlob({ pos, w, d, opacity = 0.45 }: { pos: [number, number]; w: number; d: number; opacity?: number }) {
  const tex = useMemo(() => contactShadowTexture(), []);
  return (
    <mesh position={[pos[0], FLOOR_Y + 0.12, pos[1]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
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
  // In a 4-player game the yellow banner hangs CENTRED on the west wall, so
  // the library bookcase only appears in 2-player games (the wall is bare
  // of hangings there).
  const fourPlayers = useGame((s) => s.game.players.length === 4);
  return (
    <group>
      {/* ---- arcane library: the bookcase CENTRED on the west wall, stocked
              with books, potions and a chalice (2-player games only) ---- */}
      {!fourPlayers && (
        <>
          <group position={[-65, FLOOR_Y, 0]}>
            <Prop name="Bookcase_2" pos={[0, 0, 0]} ry={Math.PI / 2} />
            <Prop name="BookGroup_Medium_1" pos={[0, 19.5, 2]} ry={Math.PI / 2} />
            <Prop name="BookGroup_Small_1" pos={[0, 19.5, -11]} ry={Math.PI / 2} />
            <Prop name="SmallBottles_1" pos={[0, 19.5, 8]} ry={Math.PI / 2} />
            <Prop name="BookGroup_Medium_2" pos={[0, 45.5, -1]} ry={Math.PI / 2} />
            <Prop name="Chalice" pos={[0, 45.5, 11]} />
            <Prop name="Book_Stack_1" pos={[0, 71.5, 4]} ry={Math.PI / 2 + 0.3} />
            <Prop name="Potion_2" pos={[0, 71.5, -10]} />
            <Prop name="Potion_1" pos={[0, 71.5, -15]} />
          </group>
          <ShadowBlob pos={[-64, 0]} w={34} d={58} />
        </>
      )}

      {/* ---- stores corner (south-west): cauldron beside the crates ---- */}
      <Prop name="Cauldron" pos={[-56, FLOOR_Y, 38]} ry={0.3} />
      <ShadowBlob pos={[-56, 38]} w={40} d={40} />
      <ShadowBlob pos={[-40, 70]} w={60} d={44} opacity={0.4} />

      {/* ---- benches under the north + south banners — a hall, not a shed ---- */}
      <Prop name="Bench" pos={[0, FLOOR_Y, -80]} s={26} />
      <ShadowBlob pos={[0, -80]} w={80} d={22} />
      <Prop name="Bench" pos={[0, FLOOR_Y, 80]} ry={Math.PI} s={26} />
      <ShadowBlob pos={[0, 80]} w={80} d={22} />

      {/* ---- armoury rack under the east-wall shelves, by the door ---- */}
      <Prop name="WeaponStand" pos={[56, FLOOR_Y, -44]} ry={-Math.PI / 2} />
      <Prop name="Sword_Bronze" pos={[56, FLOOR_Y + 7, -50]} ry={-Math.PI / 2} rx={-0.2} />
      <Prop name="Shield_Wooden" pos={[53, FLOOR_Y + 10, -30]} ry={-Math.PI / 2 - 0.5} rx={0.25} />
      <ShadowBlob pos={[56, -44]} w={42} d={52} />

      {/* ---- wall torch in the north-east corner ---- */}
      <WallTorch pos={[56, FLOOR_Y + 52, -85.5]} ry={0} />
    </group>
  );
}

for (const n of [
  'Bench',
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
