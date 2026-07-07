// Photogrammetry + modelled assets supplied by the user (slimmed into
// /public/models/scan): the castle stone floor, the scanned stone wall strip,
// the outdoor stone ground and the arranged medieval furniture set. All are
// placed at true real-world scale (the furniture file was exported at 1/11.5
// size — one uniform factor restores metres while preserving every relative
// proportion). Nothing in here is invented geometry: the room's furniture IS
// the file's arrangement, cloned once per wall.
//
// The 10 m wall strip is longer than any wall and must stop exactly at the
// corners and the door — that's done with world-space CLIPPING PLANES (the
// renderer has localClippingEnabled), never by stretching the scan.
import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { FLOOR_Y } from './coords';
import { contactShadowTexture } from './textures';

const SCAN = '/models/scan/';
const M = 32; // world units per metre (the room's scale)


/** One-time material grade for interior scan assets: keep the baked photo
 *  colour (optionally multiplied down — the pale scans blow out under the
 *  daylight rig), kill fake metalness, optional whisper of self-light. */
function gradeInterior(root: THREE.Object3D, lift = 0.06, tint?: string) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.userData.scanGraded) continue;
      std.userData.scanGraded = true;
      std.metalness = 0;
      std.roughness = 0.95;
      std.envMapIntensity = 0.1;
      if (tint) std.color.set(tint);
      if (std.map && lift > 0) {
        std.emissiveMap = std.map;
        std.emissive = new THREE.Color('#ffffff');
        std.emissiveIntensity = lift;
      }
      std.needsUpdate = true;
    }
  });
}

/** A soft contact shadow under furniture so it sits into the stone floor. */
function ShadowBlob({ pos, w, d, opacity = 0.4 }: { pos: [number, number]; w: number; d: number; opacity?: number }) {
  const tex = useMemo(() => contactShadowTexture(), []);
  return (
    <mesh position={[pos[0], FLOOR_Y + 3.6, pos[1]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** The castle stone floor — the flattest 8×8 m window cropped from the scan,
 *  re-centred so its surface rides at y≈0, laid under the whole room. */
function CastleFloor() {
  const { scene } = useGLTF(SCAN + 'floor.glb');
  const obj = useMemo(() => {
    const root = scene.clone(true);
    // no self-light and a firm multiply down: the scan's pale grey cobbles
    // otherwise blow out to white under the room's daylight rig
    gradeInterior(root, 0, '#7d786e');
    return root;
  }, [scene]);
  return <primitive object={obj} position={[0, FLOOR_Y - 0.8, 0]} scale={M} />;
}

// Stone dado top: just under the window sills, so the scanned stone wraps the
// lower walls without touching a single opening.
const DADO_TOP = FLOOR_Y + 31;

/** One clipped instance of the scanned wall strip. `clip` are world-space
 *  planes (kept side = plane side the normal points to). */
function WallStrip({
  pos,
  ry,
  clip,
}: {
  pos: [number, number, number];
  ry: number;
  clip: THREE.Plane[];
}) {
  const { scene } = useGLTF(SCAN + 'wall.glb');
  const obj = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = mats.length === 1 ? mats[0].clone() : mats.map((m) => m.clone());
      const clones = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of clones) {
        const std = m as THREE.MeshStandardMaterial;
        std.metalness = 0;
        std.roughness = 0.95;
        std.envMapIntensity = 0.15;
        // multiply the pale scan down — like the floor, it blows out white
        // under the daylight rig if left at full brightness
        std.color.set('#8b8579');
        std.clippingPlanes = clip;
        std.clipShadows = true;
        std.needsUpdate = true;
      }
    });
    return root;
    // clip arrays are built once per instance below — stable references
  }, [scene, clip]);
  return <primitive object={obj} position={pos} rotation={[0, ry, 0]} scale={M} />;
}

const plane = (nx: number, ny: number, nz: number, c: number) =>
  new THREE.Plane(new THREE.Vector3(nx, ny, nz), c);

// Strip geometry facts (from the file, in metres): length ±5.03 on local z,
// height 0..2.34, relief face toward +x (−0.16..0.29). Positions below put the
// relief ~5 units proud of each wall's inner face.
// Raycast-verified: the scan's mean surface rides ~2 units behind its pivot,
// so the pivot goes 5 units INSIDE the room — every relief spot then clears
// the plaster and the dado reads as proud rubble stone.
const STRIP_BACK = -5;

/** Scanned stone cladding on all four walls, clipped to a dado band that stops
 *  under the window sills and short of the great door. */
function StoneCladding() {
  const clips = useMemo(() => {
    const belowSills = plane(0, -1, 0, DADO_TOP); // keep y ≤ dado top
    return {
      north: [belowSills, plane(1, 0, 0, 72), plane(-1, 0, 0, 72)],
      south: [belowSills, plane(1, 0, 0, 72), plane(-1, 0, 0, 72)],
      west: [belowSills, plane(0, 0, 1, 88), plane(0, 0, -1, 88)],
      east: [belowSills, plane(0, 0, 1, 88), plane(0, 0, -1, 22)], // stop at the door
    };
  }, []);
  return (
    <group>
      {/* ry flipped +π vs the naive facing: the scan's relief face looks down
          its local −x, verified by raycast (the strips were buried) */}
      <WallStrip pos={[0, FLOOR_Y, -88 - STRIP_BACK]} ry={Math.PI / 2} clip={clips.north} />
      <WallStrip pos={[0, FLOOR_Y, 88 + STRIP_BACK]} ry={-Math.PI / 2} clip={clips.south} />
      <WallStrip pos={[-72 - STRIP_BACK, FLOOR_Y, 0]} ry={Math.PI} clip={clips.west} />
      <WallStrip pos={[72 + STRIP_BACK, FLOOR_Y, -33]} ry={0} clip={clips.east} />
    </group>
  );
}

// The furniture file is a collection whose items were saved at wildly mixed
// unit scales (chairs plausible, barrels giant), so each piece is extracted
// individually — the FIRST contiguous run of meshes wearing its material is
// one object — and normalised to its true real-world size (longest dimension,
// robust whether the piece lies or stands). Every piece below IS geometry
// from the user's file; nothing is modelled here.
const FURN_PIECES = {
  chair: { mat: 'chair', dim: 1.05 },
  cupboard: { mat: 'table01', dim: 1.5 },
  bigTable: { mat: 'big_table', dim: 1.6 },
  smallTable: { mat: 'small_table', dim: 0.8 },
  drum: { mat: 'drum', dim: 0.6 },
  vase: { mat: 'vasai', dim: 0.45 },
  sword: { mat: 'sword', dim: 1.15 },
  books: { mat: 'book', dim: 0.3 },
  bottle: { mat: 'bottle', dim: 0.32 },
} as const;
type FurnKind = keyof typeof FURN_PIECES;

function FurnPiece({
  kind,
  pos,
  ry = 0,
  rz = 0,
  settle = false,
}: {
  kind: FurnKind;
  pos: [number, number, number];
  ry?: number;
  /** roll applied BEFORE normalisation — lays a tall piece down flat */
  rz?: number;
  /** drop each sub-object onto the base plane (the source arranged the
      bottles on shelves at several heights — settling seats them all on
      one surface without touching the geometry itself) */
  settle?: boolean;
}) {
  const { scene } = useGLTF(SCAN + 'furniture.glb');
  const obj = useMemo(() => {
    const spec = FURN_PIECES[kind];
    const root = scene.clone(true);
    root.updateMatrixWorld(true);
    // first contiguous run of meshes with this material = one object
    const picked: THREE.Mesh[] = [];
    let started = false;
    let done = false;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || done) return;
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
      if ((m?.name ?? '') === spec.mat) {
        picked.push(mesh);
        started = true;
      } else if (started) done = true;
    });
    const g = new THREE.Group();
    for (const mesh of picked) g.attach(mesh); // attach keeps world transforms
    if (settle) {
      // cluster the fragments by overlapping XZ footprint (one bottle = a few
      // stacked meshes), then drop every cluster to the common base plane
      const boxes = picked.map((m) => new THREE.Box3().setFromObject(m));
      const cluster = picked.map((_, i) => i);
      const find = (i: number): number => (cluster[i] === i ? i : (cluster[i] = find(cluster[i])));
      const near = (a: THREE.Box3, b: THREE.Box3) =>
        a.min.x < b.max.x && b.min.x < a.max.x && a.min.z < b.max.z && b.min.z < a.max.z;
      for (let i = 0; i < picked.length; i++)
        for (let j = i + 1; j < picked.length; j++)
          if (near(boxes[i], boxes[j])) cluster[find(i)] = find(j);
      const groundY = Math.min(...boxes.map((b) => b.min.y));
      const clusterMin = new Map<number, number>();
      for (let i = 0; i < picked.length; i++) {
        const r = find(i);
        clusterMin.set(r, Math.min(clusterMin.get(r) ?? Infinity, boxes[i].min.y));
      }
      for (let i = 0; i < picked.length; i++)
        picked[i].position.y -= (clusterMin.get(find(i)) ?? groundY) - groundY;
    }
    gradeInterior(g, 0.08);
    g.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh) mm.castShadow = true;
    });
    // normalise: longest dimension → the piece's real-world size
    g.rotation.z = rz; // roll first so the bbox (and floor offset) match the final pose
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g);
    const size = new THREE.Vector3();
    bb.getSize(size);
    const s = (spec.dim * M) / Math.max(size.x, size.y, size.z, 1e-6);
    const c = new THREE.Vector3();
    bb.getCenter(c);
    const wrap = new THREE.Group();
    wrap.add(g);
    g.scale.setScalar(s);
    g.position.set(-c.x * s, -bb.min.y * s, -c.z * s);
    return wrap;
  }, [scene, kind, rz, settle]);
  return <primitive object={obj} position={pos} rotation={[0, ry, 0]} />;
}

/** Everything the four supplied files contribute to the ROOM. */
export function ScanEnvironment() {
  return (
    <group>
      <CastleFloor />
      <StoneCladding />

      {/* ---- north wall: the great table with chairs + tableware, and the
              drum — all pieces from the user's furniture file (the file's
              cupboard is skipped: its parts are scattered in the source) ---- */}
      <FurnPiece kind="bigTable" pos={[8, FLOOR_Y + 0.6, -70]} />
      <FurnPiece kind="chair" pos={[-16, FLOOR_Y + 0.6, -64]} ry={0.5} />
      <FurnPiece kind="chair" pos={[32, FLOOR_Y + 0.6, -64]} ry={-0.6} />
      {/* tabletop rides at FLOOR_Y + 32.8 (measured from the placed table) */}
      <FurnPiece kind="books" pos={[0, FLOOR_Y + 32.8, -72]} ry={0.4} />
      <FurnPiece kind="bottle" pos={[16, FLOOR_Y + 32.8, -70]} settle />
      <FurnPiece kind="drum" pos={[54, FLOOR_Y + 0.6, -74]} />
      <FurnPiece kind="chair" pos={[-48, FLOOR_Y + 0.6, -72]} ry={0.9} />
      <ShadowBlob pos={[-48, -72]} w={30} d={30} />
      <ShadowBlob pos={[8, -68]} w={64} d={40} />
      <ShadowBlob pos={[54, -74]} w={28} d={28} />

      {/* ---- south wall: second table with chairs, vase, the small table
              with a bottle, and the sword laid across the great table ---- */}
      <FurnPiece kind="bigTable" pos={[-8, FLOOR_Y + 0.6, 70]} ry={Math.PI} />
      <FurnPiece kind="chair" pos={[10, FLOOR_Y + 0.6, 62]} ry={Math.PI - 0.4} />
      <FurnPiece kind="chair" pos={[-26, FLOOR_Y + 0.6, 64]} ry={Math.PI + 0.35} />
      <FurnPiece kind="vase" pos={[-12, FLOOR_Y + 32.8, 72]} />
      {/* the sword lies flat across the table (rolled 90° — it stands
          point-down in the source) */}
      <FurnPiece kind="sword" pos={[-8, FLOOR_Y + 32.8, 74]} ry={0.3} rz={Math.PI / 2} />
      <FurnPiece kind="smallTable" pos={[42, FLOOR_Y + 0.6, 72]} ry={Math.PI} />
      {/* the small table's top is lower: FLOOR_Y + 26.2 */}
      <FurnPiece kind="bottle" pos={[42, FLOOR_Y + 26.2, 72]} settle />
      <ShadowBlob pos={[-8, 68]} w={64} d={40} />
      <ShadowBlob pos={[42, 72]} w={30} d={26} />
    </group>
  );
}

/** The outdoor stone-ground scan, laid through the exterior dioramas (called
 *  from Exterior.tsx inside each diorama group, at the diorama's own scale). */
export function ScanGround({ pos, ry = 0, s = 6 }: { pos: [number, number, number]; ry?: number; s?: number }) {
  const { scene } = useGLTF(SCAN + 'ground.glb');
  const obj = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.userData.scanGraded) continue;
        std.userData.scanGraded = true;
        std.metalness = 0;
        std.roughness = 1;
        std.fog = false;
        if (std.map) {
          std.emissiveMap = std.map;
          std.emissive = new THREE.Color('#cfd3cc');
          std.emissiveIntensity = 0.5; // flat daylight, matching the town grade
        }
        std.needsUpdate = true;
      }
    });
    return root;
  }, [scene]);
  return <primitive object={obj} position={pos} rotation={[0, ry, 0]} scale={s} />;
}

useGLTF.preload(SCAN + 'floor.glb');
useGLTF.preload(SCAN + 'wall.glb');
useGLTF.preload(SCAN + 'furniture.glb');
useGLTF.preload(SCAN + 'ground.glb');
