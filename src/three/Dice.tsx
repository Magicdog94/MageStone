import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CuboidCollider, Physics, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { RoundedBoxGeometry } from 'three-stdlib';
import { FACE_VALUES, diceFaceTextures, type DiceKind } from './textures';
import { TABLE_HALF } from './coords';
import { useGame } from '../store';

const DIE = 0.7; // edge length
const H = DIE / 2;
// Beveled die body — keeps BoxGeometry's 6 face groups (so the pip textures
// still map per-face) with rounding-aware UVs. Shared across every die.
const DIE_GEOMETRY = new RoundedBoxGeometry(DIE, DIE, DIE, 4, 0.08);
const TABLE_SURF = 0.02; // the wooden tabletop the dice land on (not the board)

// The dice are rolled OFF the game board, on the square table's wooden strip
// directly behind the CURRENT player's base — then regrouped in a row there.
// The strip runs from the board edge (±8) to the table edge (±TABLE_HALF).
const TRAY_RAD = (TABLE_HALF - 8) / 2 - 0.3; // half-depth of the roll area
const TRAY_CENTER = 8 + 0.3 + TRAY_RAD; // distance of its centre from origin
const TRAY_LAT = 3.1; // half-width along the table edge

/** Outward (dx,dz) per seat: 0=top(-z) 1=right(+x) 2=bottom(+z) 3=left(-x). */
const SEAT_OUT: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Local tray coords → world: `lat` runs along the table edge, `rad` outward
 *  from the tray centre (positive = toward the table edge). */
function trayToWorld(seat: number, lat: number, rad: number): [number, number] {
  const [dx, dz] = SEAT_OUT[seat] ?? SEAT_OUT[0];
  const cx = dx * TRAY_CENTER;
  const cz = dz * TRAY_CENTER;
  // lateral axis = outward rotated 90°
  const lx = -dz;
  const lz = dx;
  return [cx + lx * lat + dx * rad, cz + lz * lat + dz * rad];
}

// Local face normals in BoxGeometry material order [+x,-x,+y,-y,+z,-z].
const NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];
const UP = new THREE.Vector3(0, 1, 0);
// Resting row positions (x) for the settled dice — spaced so the 0.7 cubes
// never overlap and stay inside the tray.
const LANE = 1.05;

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

/** Which pip value is facing up for a given body rotation. */
function upValue(body: RapierRigidBody): number {
  const r = body.rotation();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  let best = -Infinity;
  let value = 1;
  const v = new THREE.Vector3();
  NORMALS.forEach((n, i) => {
    v.copy(n).applyQuaternion(q);
    if (v.y > best) {
      best = v.y;
      value = FACE_VALUES[i];
    }
  });
  return value;
}

function DieMesh({
  kind,
  visible = true,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  kind: DiceKind;
  visible?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}) {
  const mats = useMemo(
    () =>
      diceFaceTextures(kind).map(
        (map) =>
          new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.1 }),
      ),
    [kind],
  );
  return (
    <mesh
      castShadow
      geometry={DIE_GEOMETRY}
      material={mats}
      visible={visible}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    />
  );
}

// Fixed kind order matching the engine's roll (1 mage, 1 priest, 3 warrior).
const DIE_KINDS: DiceKind[] = ['mage', 'priest', 'warrior', 'warrior', 'warrior'];

function DiceBodies() {
  const rolling = useGame((s) => s.rolling);
  const rollNonce = useGame((s) => s.rollNonce);
  const phase = useGame((s) => s.game.turnPhase);
  const report = useGame((s) => s.reportDiceValues);
  const dice = useGame((s) => s.game.dice);
  const discard = useGame((s) => s.discard);
  const online = useGame((s) => s.online);
  const myColor = useGame((s) => s.myColor);
  const current = useGame((s) => s.game.current);

  // The tray sits behind the CURRENT roller's base, so it hops seat to seat.
  const seat = useGame((s) => s.game.seats[s.game.current] ?? 0);

  const bodies = useRef<(RapierRigidBody | null)[]>([]);
  const reported = useRef(false);
  const settleFrames = useRef(0);
  const liveFrames = useRef(0);
  const remoteSig = useRef('');

  // A remote player doesn't throw — they display the values the roller broadcast.
  const isRemoteViewer = online && current !== myColor;
  const show = rolling || phase === 'discard';

  // Throw fresh on each roll — onto the roller's strip of the table.
  useEffect(() => {
    if (!rolling) return;
    reported.current = false;
    settleFrames.current = 0;
    liveFrames.current = 0;
    bodies.current.forEach((b, i) => {
      if (!b) return;
      // Launch each die in its own lane (not a tight column) so they land spread
      // out and flat instead of piling on top of each other.
      const [x, z] = trayToWorld(
        seat,
        (i - 2) * 0.9 + rand(-0.15, 0.15),
        rand(-TRAY_RAD * 0.55, TRAY_RAD * 0.55),
      );
      b.setTranslation({ x, y: 2.8 + (i % 2) * 0.5, z }, true);
      const e = new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
      const q = new THREE.Quaternion().setFromEuler(e);
      b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      b.setLinvel({ x: rand(-1, 1), y: 1, z: rand(-1.2, 1.2) }, true);
      b.setAngvel({ x: rand(-13, 13), y: rand(-13, 13), z: rand(-13, 13) }, true);
    });
  }, [rollNonce, rolling, seat]);

  useFrame(() => {
    if (!rolling || reported.current) return;
    liveFrames.current++;
    let slow = true;
    for (const b of bodies.current) {
      if (!b) {
        slow = false;
        break;
      }
      const lv = b.linvel();
      const av = b.angvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > 0.18 || Math.hypot(av.x, av.y, av.z) > 0.25) {
        slow = false;
        break;
      }
    }
    settleFrames.current = slow ? settleFrames.current + 1 : 0;
    // Require a brief tumble before accepting a settle.
    if (liveFrames.current > 20 && settleFrames.current > 10) {
      reported.current = true;
      const values = bodies.current.map((b) => (b ? upValue(b) : 1));
      report(values);
      // Tidy the tray: lay every die flat in a row, its rolled value face-up, so
      // a die that settled perched on another never reads as floating. The
      // orientation is derived from the value just read, so it always matches.
      bodies.current.forEach((b, i) => {
        if (!b) return;
        const faceIdx = FACE_VALUES.indexOf(values[i]);
        const q = new THREE.Quaternion().setFromUnitVectors(NORMALS[faceIdx], UP);
        q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, rand(0, Math.PI * 2)));
        const [x, z] = trayToWorld(seat, (i - 2) * LANE, 0);
        b.setTranslation({ x, y: TABLE_SURF + H, z }, true);
        b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
    }
  });

  // Remote viewer: settle the dice to the broadcast values (no physics throw).
  useFrame(() => {
    if (!isRemoteViewer || !show) return;
    const sig = dice.map((d) => `${d?.value}.${d?.discarded}`).join(',');
    if (sig === remoteSig.current) return;
    if (!bodies.current.every((b) => b)) return;
    remoteSig.current = sig;
    bodies.current.forEach((b, i) => {
      if (!b) return;
      const v = dice[i]?.value ?? 1;
      const faceIdx = FACE_VALUES.indexOf(v);
      const q = new THREE.Quaternion().setFromUnitVectors(NORMALS[faceIdx], UP);
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, (i * 1.3) % (Math.PI * 2)));
      const [x, z] = trayToWorld(seat, (i - 2) * LANE, 0);
      b.setTranslation({ x, y: TABLE_SURF + H, z }, true);
      b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
  });

  // During the discard phase the player can click a die to discard it directly
  // (mirrors clicking the 2D tray). Only the current player may discard.
  const canDiscard = phase === 'discard' && !rolling && !isRemoteViewer;

  return (
    <group visible={show}>
      {DIE_KINDS.map((kind, i) => {
        const d = dice[i];
        const discarded = d?.discarded ?? false;
        const clickable = canDiscard && !!d && !discarded;
        return (
          <RigidBody
            // Stable index key — dice ids change every roll, and remounting would
            // drop the Rapier body refs before the throw effect runs.
            key={i}
            ref={(r) => {
              bodies.current[i] = r;
            }}
            colliders="cuboid"
            restitution={0.3}
            friction={0.9}
            angularDamping={0.55}
            linearDamping={0.3}
            position={[trayToWorld(seat, i * 1.2 - 2.4, 0)[0], TABLE_SURF + H, trayToWorld(seat, i * 1.2 - 2.4, 0)[1]]}
          >
            <DieMesh
              kind={kind}
              visible={!discarded}
              onClick={(e) => {
                if (!clickable) return;
                e.stopPropagation();
                discard(d!.id);
              }}
              onPointerOver={() => {
                if (clickable) document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'auto';
              }}
            />
          </RigidBody>
        );
      })}
    </group>
  );
}

/** Isolated physics world: the dice, a floor spanning the whole square table,
 *  and invisible containment walls around the CURRENT roller's strip (keyed by
 *  seat so they hop with the turn). Left running (idle bodies auto-sleep) so a
 *  throw always steps cleanly. */
export function DiceLayer() {
  const seat = useGame((s) => s.game.seats[s.game.current] ?? 0);
  const [dx, dz] = SEAT_OUT[seat] ?? SEAT_OUT[0];
  // Rotate the wall frame so local +z points out of the roller's table edge
  // (the walls are symmetric, so lateral mirroring doesn't matter).
  const yaw = Math.atan2(dx, dz);
  return (
    <Physics gravity={[0, -22, 0]}>
      {/* floor: the whole wooden tabletop */}
      <CuboidCollider args={[TABLE_HALF, 0.15, TABLE_HALF]} position={[0, TABLE_SURF - 0.15, 0]} />
      {/* containment walls around the active roll strip */}
      <group key={seat} rotation={[0, yaw, 0]}>
        <CuboidCollider args={[TRAY_LAT, 3, 0.2]} position={[0, TABLE_SURF + 3, TRAY_CENTER - TRAY_RAD]} />
        <CuboidCollider args={[TRAY_LAT, 3, 0.2]} position={[0, TABLE_SURF + 3, TRAY_CENTER + TRAY_RAD]} />
        <CuboidCollider args={[0.2, 3, TRAY_RAD]} position={[-TRAY_LAT, TABLE_SURF + 3, TRAY_CENTER]} />
        <CuboidCollider args={[0.2, 3, TRAY_RAD]} position={[TRAY_LAT, TABLE_SURF + 3, TRAY_CENTER]} />
      </group>
      <DiceBodies />
    </Physics>
  );
}
