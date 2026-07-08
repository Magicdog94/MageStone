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
import { useGLTF } from '@react-three/drei';
import { FLOOR_Y } from './coords';
import { contactShadowTexture } from './textures';
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

/** The round pedestal side table extracted from the user's medieval
 *  furniture set (models/side-table.glb) — normalised to its real-world
 *  size (~0.8 m) and stood on the floor. */
function SideTable({ pos, ry = 0 }: { pos: [number, number, number]; ry?: number }) {
  const { scene } = useGLTF('/models/side-table.glb');
  const obj = useMemo(() => {
    const root = scene.clone(true);
    root.updateMatrixWorld(true);
    const g = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
    });
    for (const m of meshes) {
      g.attach(m); // keeps world transforms
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.userData.propFixed) continue;
        std.userData.propFixed = true;
        std.metalness = 0;
        std.roughness = 0.85;
        std.envMapIntensity = 0.3;
        std.emissive = new THREE.Color('#ffffff');
        std.emissiveIntensity = 0.07;
        if (std.map) std.emissiveMap = std.map;
        std.needsUpdate = true;
      }
    }
    // normalise: longest dimension → 0.8 m at room scale, base on the floor
    const bb = new THREE.Box3().setFromObject(g);
    const size = new THREE.Vector3();
    bb.getSize(size);
    const s = (0.8 * M) / Math.max(size.x, size.y, size.z, 1e-6);
    const c = new THREE.Vector3();
    bb.getCenter(c);
    const wrap = new THREE.Group();
    wrap.add(g);
    g.scale.setScalar(s);
    g.position.set(-c.x * s, -bb.min.y * s, -c.z * s);
    return wrap;
  }, [scene]);
  return <primitive object={obj} position={pos} rotation={[0, ry, 0]} />;
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
  // One bench under EVERY hung banner — and only there. Selected as a joined
  // string so the store subscription stays referentially stable.
  const benchSeats = useGame((s) =>
    s.game.players
      .map((c) => s.game.seats[c])
      .sort()
      .join(',')
  );
  return (
    <group>
      {/* ---- arcane library: the bookcase CENTRED on the west wall, stocked
              with books, potions and a chalice (2-player games only) ---- */}
      {!fourPlayers && (
        <>
          <group position={[-65, FLOOR_Y, 0]}>
            <Prop name="Bookcase_2" pos={[0, 0, 0]} ry={Math.PI / 2} />
            {/* shelf items ride ON the boards (raised clear of the shelf lips) */}
            <Prop name="BookGroup_Medium_1" pos={[0, 22.5, 2]} ry={Math.PI / 2} />
            <Prop name="BookGroup_Small_1" pos={[0, 22.5, -11]} ry={Math.PI / 2} />
            <Prop name="SmallBottles_1" pos={[0, 22.5, 8]} ry={Math.PI / 2} />
            <Prop name="BookGroup_Medium_2" pos={[0, 48.5, -1]} ry={Math.PI / 2} />
            <Prop name="Chalice" pos={[0, 48.5, 11]} />
            <Prop name="Book_Stack_1" pos={[0, 74.5, 4]} ry={Math.PI / 2 + 0.3} />
            <Prop name="Potion_2" pos={[0, 74.5, -10]} />
            <Prop name="Potion_1" pos={[0, 74.5, -15]} />
          </group>
          <ShadowBlob pos={[-64, 0]} w={34} d={58} />
        </>
      )}

      {/* ---- a bench under each hung banner — EXCEPT the east wall (seat 1):
              the great door lives there and a bench blocks it ---- */}
      {benchSeats
        .split(',')
        .filter((s) => s !== '1')
        .map((s) => {
        // seat → wall: 0 north, 1 east, 2 south, 3 west (matches Decor's SEAT_DIR)
        const seat = Number(s);
        const [dx, dz] = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ][seat] ?? [0, -1];
        const dist = dx !== 0 ? 64 : 80; // E/W walls sit closer than N/S
        const x = dx * dist;
        const z = dz * dist;
        return (
          <group key={seat}>
            <Prop name="Bench" pos={[x, FLOOR_Y, z]} ry={Math.atan2(-dx, -dz)} s={26} />
            <ShadowBlob pos={[x, z]} w={dx !== 0 ? 22 : 80} d={dx !== 0 ? 80 : 22} />
          </group>
        );
      })}

      {/* (the NE wall torch became a candle sconce — see Decor's Sconce row) */}

      {/* ---- the round side table against the east wall, north of the blue
              banner zone (clear of the door at z=52 and the banner at z±22) ---- */}
      <SideTable pos={[58, FLOOR_Y, -45]} ry={Math.PI} />
      <ShadowBlob pos={[58, -45]} w={30} d={30} />
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
]) {
  useGLTF.preload(KIT + n + '.gltf');
}
useGLTF.preload('/models/side-table.glb');
