// The world OUTSIDE the chamber windows: a real 3D castle-town diorama built
// from the Medieval Village / Fantasy Props MegaKit models (slimmed to
// baseColor-only GLTFs in /public/models/exterior), so the view through each
// window has true perspective and parallax instead of a painted backdrop.
//
// Believability toolkit:
//  - FORCED PERSPECTIVE: the diorama sits just beyond the walls but is built
//    at a reduced scale (S_TOWN units per exterior-metre vs the room's 32), so
//    the town reads as 25–40 m away while staying inside the scene.
//  - COLOUR GRADE: the kit's toon-bright palette is multiplied down to muted,
//    weathered tones (GRADE below), and every material is part self-lit so the
//    outside always reads as soft overcast daylight, independent of the warm
//    candlelit interior. Exterior materials ignore the interior fog.
//  - AERIAL DEPTH: translucent haze scrims hang between the town, the curtain
//    wall and the painted farmland backdrop, so distance lightens and softens
//    exactly like the reference art.
//
// Both dioramas are the SAME castle complex: the north windows overlook the
// outer courtyard and town roofs toward the curtain wall; the south window
// sees the complex continue — the keep tower, the same wall running away, the
// same countryside and sky. Nothing here touches gameplay.
import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF, useTexture } from '@react-three/drei';
import { exteriorBackdropTexture, exteriorGroundTexture } from './textures';

const EXT = '/models/exterior/';

// Exterior daylight: flat self-illumination so the diorama never goes black
// under the interior lighting rig.
const DAY_FILL = 0.5;
const HAZE = '#ccd7dc';

// Muted grade per kit material name — kills the kit's saturated toon palette.
const GRADE: Record<string, string> = {
  MI_RoundTiles: '#9c7d6a', // bright red roofs → weathered terracotta
  MI_Plaster: '#cfc6b2', // warm limewash
  MI_WoodTrim: '#7c6a52', // grey-brown oak timbers
  MI_WoodTrim_Wear: '#71624c',
  MI_RockTrim: '#aaa28e',
  MI_UnevenBrick: '#a49a86',
  MI_Brick: '#997f6a',
  MI_MetalOrnaments: '#4c4f52',
  MI_WindowGlass: '#2d3a42',
  MI_Trim_Furniture: '#77664e',
  MI_Trim_Metal: '#565a5e',
  MI_Trim_Cloth: '#847b66',
  MI_Banner: '#847b66',
};

/** Grade one material in place: muted diffuse + daylight self-fill, no fog. */
function gradeMaterial(mat: THREE.Material) {
  const std = mat as THREE.MeshStandardMaterial;
  if (std.userData.graded) return;
  std.userData.graded = true;
  const tint = GRADE[std.name] ?? '#98917f';
  if (std.color) std.color.set(tint);
  if (std.emissive) {
    std.emissive.set(tint);
    std.emissiveIntensity = DAY_FILL;
    if (std.map) std.emissiveMap = std.map;
  }
  std.metalness = 0;
  std.roughness = 0.95;
  std.envMapIntensity = 0.08;
  std.fog = false;
  std.needsUpdate = true;
}

/** Load a kit model and grade its (shared) materials once. */
function useKit(name: string): THREE.Group {
  const { scene } = useGLTF(EXT + name + '.gltf');
  return useMemo(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(gradeMaterial);
      }
    });
    return scene;
  }, [scene]);
}

/** One placed clone of a kit model (clones share the graded materials). */
function Piece({
  kit,
  pos,
  ry = 0,
  s = 1,
}: {
  kit: string;
  pos: [number, number, number];
  ry?: number;
  s?: number;
}) {
  const src = useKit(kit);
  const obj = useMemo(() => src.clone(true), [src]);
  return <primitive object={obj} position={pos} rotation={[0, ry, 0]} scale={s} />;
}

/** Exterior standard material: kit texture + the same daylight grading. */
function ExtMat({ url, tint, rx = 1, ry = 1 }: { url: string; tint: string; rx?: number; ry?: number }) {
  const base = useTexture(EXT + url) as THREE.Texture;
  const map = useMemo(() => {
    const t = base.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  }, [base, rx, ry]);
  return (
    <meshStandardMaterial
      map={map}
      emissiveMap={map}
      emissive={tint}
      emissiveIntensity={DAY_FILL}
      color={tint}
      roughness={0.95}
      metalness={0}
      envMapIntensity={0.08}
      fog={false}
    />
  );
}

// ---- assembled buildings (kit metres, ground at y=0) -------------------------

/** Timber-framed house, gable end facing the viewer. */
function HouseGable({ pos, ry = 0, s = 1 }: { pos: [number, number, number]; ry?: number; s?: number }) {
  return (
    <group position={pos} rotation={[0, ry, 0]} scale={s}>
      <Piece kit="Wall_Plaster_WoodGrid" pos={[-1, 0, 0]} />
      <Piece kit="Wall_Plaster_WoodGrid" pos={[1, 0, 0]} />
      <Piece kit="Wall_Plaster_Straight" pos={[-2, 0, -1.2]} ry={Math.PI / 2} />
      <Piece kit="Wall_Plaster_Straight" pos={[2, 0, -1.2]} ry={-Math.PI / 2} />
      <Piece kit="Roof_Front_Brick4" pos={[0, 3.05, 0.1]} />
      <Piece kit="Roof_RoundTiles_4x4" pos={[0, 3.0, -1.6]} s={0.92} />
      <Piece kit="Prop_Chimney2" pos={[1.1, 5.2, -2.2]} s={0.8} />
    </group>
  );
}

/** Long house seen side-on — ridge parallel to the wall, dormer + chimney. */
function HouseSide({ pos, ry = 0, s = 1 }: { pos: [number, number, number]; ry?: number; s?: number }) {
  return (
    <group position={pos} rotation={[0, ry, 0]} scale={s}>
      {[-2, 0, 2].map((x) => (
        <Piece key={x} kit="Wall_Plaster_WoodGrid" pos={[x, 0, 0]} />
      ))}
      <Piece kit="Roof_RoundTiles_4x6" pos={[0, 3.0, -1.4]} ry={Math.PI / 2} s={0.95} />
      <Piece kit="Roof_Dormer_RoundTile" pos={[-1.4, 3.4, 0.4]} ry={Math.PI} s={0.8} />
      <Piece kit="Prop_Chimney" pos={[2.4, 5.0, -1.4]} s={0.85} />
    </group>
  );
}

/** Small plain cottage. */
function HouseSmall({ pos, ry = 0, s = 1 }: { pos: [number, number, number]; ry?: number; s?: number }) {
  return (
    <group position={pos} rotation={[0, ry, 0]} scale={s}>
      <Piece kit="Wall_Plaster_Straight" pos={[-1, 0, 0]} />
      <Piece kit="Wall_Plaster_WoodGrid" pos={[1, 0, 0]} />
      <Piece kit="Roof_RoundTiles_4x4" pos={[0, 2.9, -1.2]} s={0.85} />
      <Piece kit="Prop_Chimney2" pos={[-0.9, 4.4, -1.6]} s={0.7} />
    </group>
  );
}

/** Round stone tower: brick-textured shaft + the kit's conical tiled roof. */
function RoundTower({ pos, s = 1, shaftM = 6.5 }: { pos: [number, number, number]; s?: number; shaftM?: number }) {
  return (
    <group position={pos} scale={s}>
      <mesh position={[0, shaftM / 2, 0]}>
        <cylinderGeometry args={[2.35, 2.7, shaftM, 14]} />
        <ExtMat url="T_UnevenBrick_BaseColor.jpg" tint="#a49a86" rx={4} ry={2.4} />
      </mesh>
      {/* window slits */}
      {[0.7, 0.45].map((h, i) => (
        <mesh key={i} position={[i === 0 ? 0.6 : -0.8, shaftM * h, 2.42]}>
          <planeGeometry args={[0.34, 1.1]} />
          <meshBasicMaterial color="#241f18" fog={false} />
        </mesh>
      ))}
      <Piece kit="Roof_Tower_RoundTiles" pos={[0, shaftM + 0.4, 0]} s={0.92} />
    </group>
  );
}

/** Battlemented curtain wall segment with a walk — built in world units. */
function CurtainWall({
  pos,
  len,
  h = 26,
  ry = 0,
}: {
  pos: [number, number, number];
  len: number;
  h?: number;
  ry?: number;
}) {
  const merlons = useMemo(() => {
    const out: number[] = [];
    for (let x = -len / 2 + 4; x < len / 2 - 2; x += 8.5) out.push(x);
    return out;
  }, [len]);
  return (
    <group position={pos} rotation={[0, ry, 0]}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[len, h, 7]} />
        <ExtMat url="T_UnevenBrick_BaseColor.jpg" tint="#a79d89" rx={len / 30} ry={h / 30} />
      </mesh>
      {merlons.map((x) => (
        <mesh key={x} position={[x, h + 2.2, 0]}>
          <boxGeometry args={[4.6, 4.4, 7.4]} />
          <ExtMat url="T_UnevenBrick_BaseColor.jpg" tint="#a29881" rx={0.5} ry={0.4} />
        </mesh>
      ))}
    </group>
  );
}

// ---- the two dioramas --------------------------------------------------------

const S_TOWN = 6; // forced-perspective scale (units per exterior-metre)

/** Haze scrim — a translucent veil that lightens everything behind it. */
function Scrim({ pos, w, h, opacity }: { pos: [number, number, number]; w: number; h: number; opacity: number }) {
  return (
    <mesh position={pos} renderOrder={2}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial color={HAZE} transparent opacity={opacity} depthWrite={false} fog={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function GroundPlane({ pos, w, d }: { pos: [number, number, number]; w: number; d: number }) {
  const tex = useMemo(() => {
    const t = exteriorGroundTexture().clone();
    t.repeat.set(w / 90, d / 90);
    t.needsUpdate = true;
    return t;
  }, [w, d]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={pos}>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial
        map={tex}
        emissiveMap={tex}
        emissive="#8f9377"
        emissiveIntensity={DAY_FILL}
        color="#8f9377"
        roughness={1}
        metalness={0}
        fog={false}
      />
    </mesh>
  );
}

function Backdrop({ pos, ry = 0, uvOffset = 0 }: { pos: [number, number, number]; ry?: number; uvOffset?: number }) {
  const tex = useMemo(() => {
    const t = exteriorBackdropTexture().clone();
    t.offset.set(uvOffset, 0);
    t.needsUpdate = true;
    return t;
  }, [uvOffset]);
  return (
    <mesh position={pos} rotation={[0, ry, 0]}>
      <planeGeometry args={[780, 260]} />
      <meshBasicMaterial map={tex} fog={false} />
    </mesh>
  );
}

// Exterior ground level. The windows sit high in the wall, so with the
// courtyard here the rooftops ride across the middle of the view and the
// curtain wall + farmland band sits above them, under the sky in the arch.
const GROUND_Y = -26;

/** North side: the outer courtyard and town roofs toward the curtain wall.
 *  The LEFT window mostly sees the rooftop row and courtyard carts; the RIGHT
 *  window mostly sees the round tower and the taller chapel gable — the same
 *  place from two nearby openings, sharing the wall, light and countryside. */
function NorthDiorama() {
  return (
    <group position={[0, GROUND_Y, 0]}>
      <GroundPlane pos={[0, 0, -250]} w={720} d={320} />
      {/* town band (forced perspective) */}
      <group scale={S_TOWN}>
        {/* left-window scenery: rooftop row + courtyard clutter (the left
            window's sight corridor runs x ≈ −16..−8 here) */}
        <HouseSide pos={[-13.5, 0, -27.5]} ry={0.06} />
        <HouseGable pos={[-9.5, 0, -29]} ry={-0.08} />
        <Piece kit="Prop_Wagon" pos={[-11.8, 0, -25]} ry={0.8} />
        <Piece kit="Barrel" pos={[-10.6, 0, -24.6]} />
        <Piece kit="Barrel" pos={[-10.2, 0, -25.3]} s={0.9} />
        {/* shared anchor — catches the edge of both views as the camera moves */}
        <HouseSmall pos={[-7.8, 0, -26.5]} ry={0.14} />
        {/* right-window scenery (corridor x ≈ +8..+16): tower, chapel, stall */}
        <RoundTower pos={[9.6, 0, -29]} />
        <HouseGable pos={[15.2, 0, -31]} ry={0.34} s={1.18} />
        <Piece kit="Stall_Cart_Empty" pos={[8.6, 0, -25.2]} ry={-0.5} />
      </group>
      {/* curtain wall with flanking towers + far scrims + painted distance */}
      <CurtainWall pos={[-6, 0, -206]} len={520} />
      <group scale={4.6}>
        <RoundTower pos={[-27, 0, -44.4]} shaftM={8.5} />
        <RoundTower pos={[31, 0, -44.2]} shaftM={7.5} />
      </group>
      {/* fog: a near bank in front of the town plus thicker distance scrims */}
      <Scrim pos={[0, 24, -138]} w={560} h={110} opacity={0.32} />
      <Scrim pos={[0, 30, -192]} w={580} h={130} opacity={0.41} />
      <Scrim pos={[0, 40, -278]} w={680} h={170} opacity={0.68} />
      <Backdrop pos={[0, 60, -352]} />
    </group>
  );
}

/** South side: the SAME complex continuing — the keep tower close on the
 *  left, the same curtain wall running away east, more town roofs and the
 *  same hazy farmland beyond (shifted sector of the shared backdrop). */
function SouthDiorama() {
  return (
    <group position={[0, GROUND_Y, 0]}>
      <GroundPlane pos={[0, 0, 250]} w={720} d={320} />
      <group scale={S_TOWN}>
        {/* the keep: a heavier square stone tower, half-caught at the window's
            left edge so its masonry side reads without filling the view */}
        <group position={[-16.5, 0, 29]} rotation={[0, Math.PI + 0.15, 0]}>
          <mesh position={[0, 5.5, 0]}>
            <boxGeometry args={[7, 11, 7]} />
            <ExtMat url="T_UnevenBrick_BaseColor.jpg" tint="#a1977f" rx={2.4} ry={3.2} />
          </mesh>
          <Piece kit="Roof_RoundTiles_4x4" pos={[0, 10.9, 0]} s={1.12} />
          <Piece kit="Prop_Chimney" pos={[2, 13.8, 1.2]} s={0.9} />
        </group>
        {/* the rest of the south corridor (x ≈ −19..−9 through the window) */}
        <HouseGable pos={[-12, 0, 28]} ry={Math.PI - 0.2} />
        <HouseSide pos={[-18.5, 0, 30.5]} ry={Math.PI + 0.1} />
        <Piece kit="Barrel" pos={[-12.6, 0, 24.8]} />
        <Piece kit="Prop_Wagon" pos={[-10.5, 0, 25.6]} ry={Math.PI * 0.68} />
      </group>
      <CurtainWall pos={[-40, 0, 212]} len={460} ry={0.06} />
      <group scale={4.6}>
        <RoundTower pos={[-24, 0, 45.6]} shaftM={8} />
      </group>
      {/* fog: same banks as the north side, so both views share the weather */}
      <Scrim pos={[0, 24, 142]} w={560} h={110} opacity={0.32} />
      <Scrim pos={[0, 30, 198]} w={580} h={130} opacity={0.41} />
      <Scrim pos={[0, 40, 282]} w={680} h={170} opacity={0.68} />
      <Backdrop pos={[0, 60, 350]} ry={Math.PI} uvOffset={0.42} />
    </group>
  );
}

/** Everything visible through the chamber windows. */
export function ExteriorWorld() {
  return (
    <group>
      <NorthDiorama />
      <SouthDiorama />
    </group>
  );
}

for (const n of [
  'Wall_Plaster_WoodGrid',
  'Wall_Plaster_Straight',
  'Roof_Front_Brick4',
  'Roof_RoundTiles_4x4',
  'Roof_RoundTiles_4x6',
  'Roof_Dormer_RoundTile',
  'Roof_Tower_RoundTiles',
  'Prop_Chimney',
  'Prop_Chimney2',
  'Prop_Wagon',
  'Barrel',
  'Stall_Cart_Empty',
]) {
  useGLTF.preload(EXT + n + '.gltf');
}
