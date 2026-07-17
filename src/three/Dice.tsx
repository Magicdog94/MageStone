import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  CuboidCollider,
  Physics,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier';
import { RoundedBoxGeometry } from 'three-stdlib';
import {
  FACE_VALUES,
  diceFaceTextures,
  dieBodyColor,
  dieNumberTexture,
  type DiceKind,
} from './textures';
import { TABLE_HALF } from './coords';
import { useGame } from '../store';
import type { PlayerColor } from '../game/types';

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

/** Index (into `normals`) of the LOCAL face pointing most upward under `q`. */
function upFaceIndex(q: THREE.Quaternion, normals: THREE.Vector3[]): number {
  let best = -Infinity;
  let idx = 0;
  const v = new THREE.Vector3();
  normals.forEach((n, i) => {
    v.copy(n).applyQuaternion(q);
    if (v.y > best) {
      best = v.y;
      idx = i;
    }
  });
  return idx;
}

/** Is the die lying flat (its up face within ~10° of level)? A "calm" die can
 *  still be leaning mid-topple — settling must wait for flat, or the frozen
 *  face won't be the face the tumble was heading for. */
function isFlat(body: RapierRigidBody, normals: THREE.Vector3[]): boolean {
  const r = body.rotation();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  const idx = upFaceIndex(q, normals);
  return normals[idx].clone().applyQuaternion(q).y >= 0.985;
}

/**
 * Straighten a landed die IN PLACE: rotate it by the minimal tilt that brings
 * its landed face exactly upright and drop it to rest height — it stays where
 * it landed and keeps the face it landed on (no teleport, no re-face). This is
 * what killed the old "settle → jump into a tidy row" flash.
 */
function settleInPlace(
  body: RapierRigidBody,
  normals: THREE.Vector3[],
  restY: number,
): void {
  const r = body.rotation();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  const idx = upFaceIndex(q, normals);
  const w = normals[idx].clone().applyQuaternion(q).normalize();
  q.premultiply(new THREE.Quaternion().setFromUnitVectors(w, UP));
  const t = body.translation();
  body.setTranslation({ x: t.x, y: restY, z: t.z }, true);
  body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
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

// ---- Polyhedral dice (d12 / d20) for combat throws -------------------------
// True solids: a dodecahedron / icosahedron whose faces carry gold numbers.
// Face i is worth i+1; reading and snapping both go through the face normals.

interface PolyFace {
  normal: THREE.Vector3;
  center: THREE.Vector3;
}
interface PolyDef {
  geo: THREE.BufferGeometry;
  faces: PolyFace[]; // faces[value - 1]
  labelSize: number;
}

const POLY_DEFS = new Map<number, PolyDef>();
function polyDef(faceCount: 12 | 20): PolyDef {
  const hit = POLY_DEFS.get(faceCount);
  if (hit) return hit;
  const geo =
    faceCount === 12 ? new THREE.DodecahedronGeometry(0.5) : new THREE.IcosahedronGeometry(0.55);
  // Group the triangle soup into flat faces by (rounded) normal direction.
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const groups = new Map<string, { normal: THREE.Vector3; sum: THREE.Vector3; n: number }>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize();
    const key = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`;
    let g = groups.get(key);
    if (!g) {
      g = { normal: n.clone(), sum: new THREE.Vector3(), n: 0 };
      groups.set(key, g);
    }
    g.sum.add(a).add(b).add(c);
    g.n += 3;
  }
  const faces: PolyFace[] = [...groups.values()].map((g) => ({
    normal: g.normal,
    center: g.sum.divideScalar(g.n),
  }));
  const def: PolyDef = { geo, faces, labelSize: faceCount === 12 ? 0.34 : 0.27 };
  POLY_DEFS.set(faceCount, def);
  return def;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);

function PolyDieMesh({ faces, kind }: { faces: 12 | 20; kind: DiceKind }) {
  const def = polyDef(faces);
  const bodyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: dieBodyColor(),
        roughness: 0.4,
        metalness: 0.15,
      }),
    [],
  );
  const labelGeo = useMemo(() => new THREE.PlaneGeometry(def.labelSize, def.labelSize), [def]);
  return (
    <group>
      <mesh castShadow geometry={def.geo} material={bodyMat} />
      {def.faces.map((f, i) => (
        <mesh
          key={i}
          geometry={labelGeo}
          position={f.center.clone().addScaledVector(f.normal, 0.008)}
          quaternion={new THREE.Quaternion().setFromUnitVectors(Z_AXIS, f.normal)}
        >
          <meshStandardMaterial
            map={dieNumberTexture(i + 1, kind)}
            transparent
            depthWrite={false}
            roughness={0.4}
            metalness={0.3}
          />
        </mesh>
      ))}
    </group>
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
  // Under the camera lock the board is rotated by viewOffset quarter-turns —
  // remap to the VISUAL seat so the dice still land in front of the roller.
  const seat = useGame((s) => ((s.game.seats[s.game.current] ?? 0) + s.viewOffset) % 4);

  const bodies = useRef<(RapierRigidBody | null)[]>([]);
  const reported = useRef(false);
  const settleFrames = useRef(0);
  const liveFrames = useRef(0);
  const throwAt = useRef(0);
  const remoteSig = useRef('');

  // A remote player doesn't throw — they display the values the roller broadcast.
  const isRemoteViewer = online && current !== myColor;
  const show = rolling || phase === 'discard';

  // Throw fresh on each roll — onto the roller's strip of the table. Guarded:
  // a crashed (poisoned) Rapier world throws on EVERY call — report the
  // engine's values instead and ask for a fresh physics world.
  useEffect(() => {
    if (!rolling) return;
    reported.current = false;
    settleFrames.current = 0;
    liveFrames.current = 0;
    throwAt.current = performance.now();
    try {
      bodies.current.forEach((b, i) => {
        if (!b) return;
        // Launch each die in its own lane (not a tight column) so they land spread
        // out and flat instead of piling on top of each other.
        const [x, z] = trayToWorld(
          seat,
          (i - 2) * 0.9 + rand(-0.15, 0.15),
          rand(-TRAY_RAD * 0.55, TRAY_RAD * 0.55),
        );
        b.setGravityScale(1, true); // un-park (hidden dice wait weightless below)
        b.setTranslation({ x, y: 2.8 + (i % 2) * 0.5, z }, true);
        const e = new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
        const q = new THREE.Quaternion().setFromEuler(e);
        b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        b.setLinvel({ x: rand(-1, 1), y: 1, z: rand(-1.2, 1.2) }, true);
        b.setAngvel({ x: rand(-13, 13), y: rand(-13, 13), z: rand(-13, 13) }, true);
      });
    } catch (err) {
      console.warn('MageStone: dice throw hit a dead physics world.', err);
      reported.current = true;
      report(useGame.getState().game.dice.map((d) => d.value));
      useGame.getState().bumpPhysicsEpoch();
    }
  }, [rollNonce, rolling, seat, report]);

  useFrame(() => {
    if (!rolling || reported.current) return;
    if (!throwAt.current) throwAt.current = performance.now(); // effect raced — clock from first frame
    liveFrames.current++;
    let slow = true;
    try {
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
      // Require a brief tumble before accepting a settle — but NEVER wedge the
      // game: a die perched mid-jitter (or a lost body) used to keep `rolling`
      // true forever, freezing bot games. WALL-CLOCK timeout (frame counts scale
      // with fps — a slow machine at 12fps would wait half a minute): after ~8s
      // of real time, read the faces as they lie. Also wait for every die to
      // lie FLAT — a calm die can still be leaning mid-topple, and reading it
      // early would freeze the wrong face up (long-wedged dice settle anyway).
      let allFlat = true;
      if (slow) {
        for (const b of bodies.current) {
          if (b && !isFlat(b, NORMALS)) {
            allFlat = false;
            break;
          }
        }
      }
      const timedOut =
        throwAt.current > 0 && performance.now() - throwAt.current > 8000;
      if ((liveFrames.current > 20 && settleFrames.current > 10 && (allFlat || settleFrames.current > 100)) || timedOut) {
        if (timedOut) console.warn('MageStone: dice settle timed out — forcing a read');
        reported.current = true;
        const values = bodies.current.map((b) => (b ? upValue(b) : 1));
        report(values);
        // The face each die LANDED on is the result (report() above makes it
        // the engine's truth), so the die never needs re-facing — it stays
        // exactly where it fell, just straightened upright in place. Only a
        // die perched ON another (floating once its prop moves) falls back to
        // its lane slot, keeping the same face up.
        bodies.current.forEach((b, i) => {
          if (!b) return;
          const perched = b.translation().y > TABLE_SURF + H + 0.25;
          if (perched) {
            const faceIdx = FACE_VALUES.indexOf(values[i]);
            const q = new THREE.Quaternion().setFromUnitVectors(NORMALS[faceIdx], UP);
            q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, rand(0, Math.PI * 2)));
            const [x, z] = trayToWorld(seat, (i - 2) * LANE, 0);
            b.setTranslation({ x, y: TABLE_SURF + H, z }, true);
            b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
            b.setLinvel({ x: 0, y: 0, z: 0 }, true);
            b.setAngvel({ x: 0, y: 0, z: 0 }, true);
          } else {
            settleInPlace(b, NORMALS, TABLE_SURF + H);
          }
        });
      }
    } catch (err) {
      // A Rapier panic poisons the whole world (every later call throws).
      // Accept the engine's rolled values and rebuild the physics world.
      console.warn('MageStone: physics failed during dice settle.', err);
      reported.current = true;
      report(useGame.getState().game.dice.map((d) => d.value));
      useGame.getState().bumpPhysicsEpoch();
    }
  });

  // Remote viewer: settle the dice to the broadcast values (no physics throw).
  useFrame(() => {
    if (!isRemoteViewer || !show) return;
    const sig = dice.map((d) => `${d?.value}.${d?.discarded}`).join(',');
    if (sig === remoteSig.current) return;
    if (!bodies.current.every((b) => b)) return;
    remoteSig.current = sig;
    try {
      bodies.current.forEach((b, i) => {
        if (!b) return;
        b.setGravityScale(1, true);
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
    } catch (err) {
      console.warn('MageStone: physics failed placing remote dice.', err);
      useGame.getState().bumpPhysicsEpoch();
    }
  });

  // Re-entering the tray WITHOUT a throw — an Undo stepped the phase back to
  // `discard` after the dice were already parked — lays the rolled dice back
  // out in their lanes, values face-up (the values are unchanged; only the
  // presentation returns).
  const prevShow = useRef(false);
  useEffect(() => {
    const was = prevShow.current;
    prevShow.current = show;
    if (!show || was || rolling || isRemoteViewer) return;
    try {
      bodies.current.forEach((b, i) => {
        if (!b) return;
        b.setGravityScale(1, true);
        const v = dice[i]?.value ?? 1;
        const faceIdx = FACE_VALUES.indexOf(v);
        const q = new THREE.Quaternion().setFromUnitVectors(NORMALS[faceIdx], UP);
        q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, (i * 1.1) % (Math.PI * 2)));
        const [x, z] = trayToWorld(seat, (i - 2) * LANE, 0);
        b.setTranslation({ x, y: TABLE_SURF + H, z }, true);
        b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
    } catch (err) {
      console.warn('MageStone: physics failed relaying dice after undo.', err);
      useGame.getState().bumpPhysicsEpoch();
    }
  }, [show, rolling, isRemoteViewer, dice, seat]);

  // Park hidden dice below the table (weightless) so their invisible bodies
  // never collide with the combat dice thrown onto the tray during act phase;
  // both throw paths restore gravity when they reposition the dice.
  useEffect(() => {
    if (show) return;
    try {
      bodies.current.forEach((b, i) => {
        if (!b) return;
        b.setGravityScale(0, true);
        b.setTranslation({ x: (i - 2) * 1.2, y: -2.5, z: 0 }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
    } catch (err) {
      console.warn('MageStone: physics failed parking dice.', err);
      useGame.getState().bumpPhysicsEpoch();
    }
  }, [show]);

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

// ---- Combat dice: real physical throws for every attack ---------------------
// When an attack resolves, the attacker's dice (n×d6, or the Mage's d12/d20)
// and the defender's die tumble onto the current player's tray for real, then
// settle showing the values the engine rolled (the same read-then-tidy snap the
// turn dice use — the throw is the presentation, the engine stays the referee).
// Every client throws its own cosmetic dice off the broadcast CombatResult, so
// online spectators see the same drama and the same final faces.

interface CombatDieSpec {
  faces: number;
  kind: DiceKind;
  value: number;
  /** Tray the die lands on — each side's dice roll on THEIR OWN edge. */
  seat: number;
  /** Position within its tray group (attacker dice line up together). */
  slot: number;
  slots: number;
}

// How long the settled result stays on the table (players who fight a lot can
// shorten it via Settings → Fast dice).
const combatLingerMs = () => (useGame.getState().settings.fastDice ? 1000 : 2400);

interface CombatRun {
  id: number;
  spec: CombatDieSpec[];
  /** Who rolled what — announced by the HUD only once the dice have settled. */
  roll: {
    attacker: PlayerColor;
    attackRoll: number;
    defender: PlayerColor;
    defenseRoll: number;
    outcome: 'win' | 'lose' | 'draw';
  };
}

let combatRunSeq = 0;

/** Geometry-local normals of a die's faces, by value-1 (cube via FACE_VALUES). */
function faceNormalsOf(faces: number): THREE.Vector3[] {
  if (faces === 6) return FACE_VALUES.map((_, v) => NORMALS[FACE_VALUES.indexOf(v + 1)]);
  return polyDef(faces as 12 | 20).faces.map((f) => f.normal);
}
const restHeight = (faces: number) => (faces === 6 ? H : faces === 12 ? 0.42 : 0.47);

function CombatDice() {
  const rolling = useGame((s) => s.rolling);
  const showCombatRoll = useGame((s) => s.showCombatRoll);
  const { world } = useRapier();

  const [run, setRun] = useState<CombatRun | null>(null);
  const bodies = useRef<(RapierRigidBody | null)[]>([]);
  /** Inner visual group per die — its "skin". Counter-rotated after the
   *  pre-simulation so the face that will PHYSICALLY land upward carries the
   *  engine's number: the die lands showing the right value first time. */
  const skins = useRef<(THREE.Group | null)[]>([]);
  /** Predicted landed face index per die (into faceNormalsOf), for the
   *  settle-time verification. */
  const predicted = useRef<number[]>([]);
  const thrown = useRef(false);
  const thrownAt = useRef(0);
  const settled = useRef(false);
  const liveFrames = useRef(0);
  const calmFrames = useRef(0);
  const lastPredictAt = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);

  /**
   * Look into the future: save every die's exact state, step the physics
   * world silently until the dice rest, read which face each will LAND on,
   * rewind — then dress each die's skin so that landing face carries the
   * engine's number. Called at the throw and again every few frames of the
   * tumble: physics replay isn't perfectly deterministic (contact caches),
   * but each re-prediction starts from the live state, so by the time a die
   * slows down the forecast is exact — it lands showing the right value
   * first time, and any skin swap happens mid-spin where it can't be seen.
   */
  const repredict = (active: (RapierRigidBody | null)[], spec: CombatDieSpec[]) => {
    try {
      const saved = active.map((b) => {
        if (!b) return null;
        const t = b.translation();
        const q = b.rotation();
        const lv = b.linvel();
        const av = b.angvel();
        return {
          t: { x: t.x, y: t.y, z: t.z },
          q: { x: q.x, y: q.y, z: q.z, w: q.w },
          lv: { x: lv.x, y: lv.y, z: lv.z },
          av: { x: av.x, y: av.y, z: av.z },
        };
      });
      // minimum horizon of a full sim-second: a die can be "calm" yet mid
      // slow-topple — run long enough for every topple to finish
      for (let step = 0, calm = 0; step < 900 && (calm < 8 || step < 60); step++) {
        world.step();
        let allCalm = true;
        for (const b of active) {
          if (!b) continue;
          const lv = b.linvel();
          const av = b.angvel();
          if (Math.hypot(lv.x, lv.y, lv.z) > 0.18 || Math.hypot(av.x, av.y, av.z) > 0.25) {
            allCalm = false;
            break;
          }
        }
        calm = allCalm ? calm + 1 : 0;
      }
      active.forEach((b, i) => {
        if (!b) return;
        const d = spec[i];
        const normals = faceNormalsOf(d.faces);
        const r = b.rotation();
        const landed = upFaceIndex(new THREE.Quaternion(r.x, r.y, r.z, r.w), normals);
        if (predicted.current[i] !== landed) {
          predicted.current[i] = landed;
          const skin = skins.current[i];
          if (skin) skin.quaternion.setFromUnitVectors(normals[d.value - 1], normals[landed]);
        }
      });
      saved.forEach((s, i) => {
        const b = active[i];
        if (!b || !s) return;
        b.setTranslation(s.t, true);
        b.setRotation(s.q, true);
        b.setLinvel(s.lv, true);
        b.setAngvel(s.av, true);
      });
    } catch (err) {
      console.warn('MageStone: dice pre-simulation skipped.', err);
    }
  };

  // Subscribe to the store: a NEW CombatResult (by identity) arms a fresh
  // throw on every client — actor and online spectators alike.
  useEffect(() => {
    const unsub = useGame.subscribe((s, prev) => {
      const c = s.game.lastCombat;
      if (!c || c === prev.game.lastCombat) return;
      thrown.current = false;
      settled.current = false;
      liveFrames.current = 0;
      calmFrames.current = 0;
      lastPredictAt.current = 0;
      window.clearTimeout(hideTimer.current);
      showCombatRoll(null); // hide any prior result until THESE dice settle
      // Each side's dice land on that side's OWN tray (seats captured now,
      // so a turn change during the linger can't relocate them).
      const atkSeat = ((s.game.seats[c.attackerOwner] ?? 0) + s.viewOffset) % 4;
      const defSeat = ((s.game.seats[c.defenderOwner] ?? 0) + s.viewOffset) % 4;
      setRun({
        id: ++combatRunSeq,
        roll: {
          attacker: c.attackerOwner,
          attackRoll: c.attackRoll,
          defender: c.defenderOwner,
          defenseRoll: c.defenseRoll,
          outcome: c.outcome,
        },
        spec: [
          ...c.attackDice.map((v, i) => ({
            faces: c.attackFaces,
            kind: c.attackerKind as DiceKind,
            value: v,
            seat: atkSeat,
            slot: i,
            slots: c.attackDice.length,
          })),
          {
            faces: c.defenseFaces,
            kind: c.defenderKind as DiceKind,
            value: c.defenseRoll,
            seat: defSeat,
            slot: 0,
            slots: 1,
          },
        ],
      });
    });
    return () => {
      unsub();
      window.clearTimeout(hideTimer.current);
    };
  }, [showCombatRoll]);

  useFrame(() => {
    if (!run || settled.current) return;
    try {
    // Throw on the first physics frame where every body is registered — this
    // never races React commit order or StrictMode double-mounts.
    if (!thrown.current) {
      const active = bodies.current.slice(0, run.spec.length);
      if (!active.every(Boolean)) return;
      active.forEach((b, i) => {
        if (!b) return;
        const d = run.spec[i];
        const [x, z] = trayToWorld(
          d.seat,
          (d.slot - (d.slots - 1) / 2) * 1.1 + rand(-0.12, 0.12),
          rand(-TRAY_RAD * 0.5, TRAY_RAD * 0.5),
        );
        b.setTranslation({ x, y: 3 + (i % 2) * 0.5, z }, true);
        const e = new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
        const q = new THREE.Quaternion().setFromEuler(e);
        b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        b.setLinvel({ x: rand(-1, 1), y: 1, z: rand(-1.2, 1.2) }, true);
        b.setAngvel({ x: rand(-14, 14), y: rand(-14, 14), z: rand(-14, 14) }, true);
      });
      predicted.current = [];
      repredict(active, run.spec);
      thrown.current = true;
      thrownAt.current = performance.now();
      return;
    }
    liveFrames.current++;
    let calm = true;
    for (const b of bodies.current.slice(0, run.spec.length)) {
      if (!b) return;
      const lv = b.linvel();
      const av = b.angvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > 0.18 || Math.hypot(av.x, av.y, av.z) > 0.25) {
        calm = false;
        break;
      }
    }
    calmFrames.current = calm ? calmFrames.current + 1 : 0;
    // Refresh the landing forecast while the dice still tumble — predictions
    // from the live state converge as the throw slows. Wall-clock cadence
    // (frame counts stretch on slow machines), tightening once the dice are
    // slow — the final flops decide the face, so the endgame gets covered
    // densely — plus one last confirm the instant everything goes calm.
    const active = bodies.current.slice(0, run.spec.length);
    let slow = true;
    for (const b of active) {
      if (!b) continue;
      const lv = b.linvel();
      const av = b.angvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > 1.6 || Math.hypot(av.x, av.y, av.z) > 3.5) {
        slow = false;
        break;
      }
    }
    const now = performance.now();
    if (!calm && now - lastPredictAt.current > (slow ? 45 : 150)) {
      lastPredictAt.current = now;
      repredict(active, run.spec);
    } else if (calm && calmFrames.current === 1) {
      repredict(active, run.spec);
    }
    // Settle only once every die lies FLAT — a calm die may still be leaning
    // mid-topple, and freezing it early would fix the wrong face up. A die
    // wedged leaning for a long while (against another die) settles anyway
    // and gets straightened. Wall-clock safety net regardless.
    let allFlat = true;
    if (calm) {
      for (let i = 0; i < run.spec.length; i++) {
        const b = bodies.current[i];
        if (!b) continue;
        if (!isFlat(b, faceNormalsOf(run.spec[i].faces))) {
          allFlat = false;
          break;
        }
      }
    }
    const timedOut = thrownAt.current > 0 && performance.now() - thrownAt.current > 6500;
    if ((liveFrames.current > 20 && calmFrames.current > 10 && (allFlat || calmFrames.current > 100)) || timedOut) {
      settled.current = true;
      // The pre-simulation already dressed each die so its landing face shows
      // the engine's value — the dice stay exactly where they fell, only
      // straightened upright. Verify the replay landed as predicted (physics
      // is fixed-step deterministic, but never bet the result on it): on a
      // divergence the skin is corrected in this same frame — no delay.
      bodies.current.slice(0, run.spec.length).forEach((b, i) => {
        if (!b) return;
        const d = run.spec[i];
        const normals = faceNormalsOf(d.faces);
        const rest = restHeight(d.faces);
        const r = b.rotation();
        const landed = upFaceIndex(new THREE.Quaternion(r.x, r.y, r.z, r.w), normals);
        if (landed !== predicted.current[i]) {
          const skin = skins.current[i];
          if (skin) skin.quaternion.setFromUnitVectors(normals[d.value - 1], normals[landed]);
          if (predicted.current[i] !== undefined) {
            const qq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
            const tilt = normals[landed].clone().applyQuaternion(qq).y;
            console.warn(
              `MageStone: combat die replay diverged — corrected at settle. tilt=${tilt.toFixed(3)}`,
            );
          }
        }
        if (b.translation().y > TABLE_SURF + rest + 0.25) {
          // perched on another die — lay it flat in its lane, same face up
          const q = new THREE.Quaternion().setFromUnitVectors(normals[landed], UP);
          q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, rand(0, Math.PI * 2)));
          const [x, z] = trayToWorld(d.seat, (d.slot - (d.slots - 1) / 2) * LANE, 0);
          b.setTranslation({ x, y: TABLE_SURF + rest, z }, true);
          b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
          b.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        } else {
          settleInPlace(b, normals, TABLE_SURF + rest);
        }
      });
      // The dice are now face-up on the table — NOW announce the numbers.
      showCombatRoll(run.roll);
      hideTimer.current = window.setTimeout(() => setRun(null), combatLingerMs());
    }
    } catch (err) {
      // Poisoned physics world: skip the cosmetic throw, announce, move on.
      console.warn('MageStone: physics failed during combat dice.', err);
      settled.current = true;
      showCombatRoll(run.roll);
      hideTimer.current = window.setTimeout(() => setRun(null), 800);
      useGame.getState().bumpPhysicsEpoch();
    }
  });

  // Clear the announcement whenever the dice leave the table (a new turn-roll
  // sweeps them, or the linger elapses).
  useEffect(() => {
    if (!run || rolling) showCombatRoll(null);
  }, [run, rolling, showCombatRoll]);

  // The next turn's roll sweeps lingering combat dice off the tray.
  if (!run || rolling) return null;
  return (
    <group>
      {run.spec.map((d, i) => (
        <RigidBody
          key={`${run.id}-${i}`}
          ref={(r) => {
            bodies.current[i] = r;
          }}
          colliders={d.faces === 6 ? 'cuboid' : 'hull'}
          restitution={0.3}
          friction={0.9}
          angularDamping={0.55}
          linearDamping={0.3}
          position={[0, -4 - i, 0]}
        >
          {/* the visual "skin" — counter-rotated by the pre-simulation so the
              face that will land upward carries the engine's number */}
          <group
            ref={(g) => {
              skins.current[i] = g;
            }}
          >
            {d.faces === 6 ? (
              <DieMesh kind={d.kind} />
            ) : (
              <PolyDieMesh faces={d.faces as 12 | 20} kind={d.kind} />
            )}
          </group>
        </RigidBody>
      ))}
    </group>
  );
}

/** Isolated physics world: the dice, a floor spanning the whole square table,
 *  and invisible containment walls around the CURRENT roller's strip (keyed by
 *  seat so they hop with the turn). Left running (idle bodies auto-sleep) so a
 *  throw always steps cleanly. */
export function DiceLayer() {
  // A Rapier WASM panic poisons the whole world (every later call throws
  // "recursive use of an object…" forever — dice freeze). The dice layers
  // detect it and bump this epoch, remounting a FRESH physics world.
  const physicsEpoch = useGame((s) => s.physicsEpoch);
  return (
    /* Fixed timestep: wall-clock (vary) steps tunnel fast dice through the
       thin floor collider whenever a frame hiccups — 1/60 keeps them honest. */
    <Physics key={physicsEpoch} gravity={[0, -22, 0]} timeStep={1 / 60}>
      {/* floor: the whole wooden tabletop */}
      <CuboidCollider args={[TABLE_HALF, 0.15, TABLE_HALF]} position={[0, TABLE_SURF - 0.15, 0]} />
      {/* containment walls around ALL FOUR roll strips — combat throws land
          each side's dice on that side's own tray, so every tray needs its
          fences up permanently (turn dice always use the current one). */}
      {[0, 1, 2, 3].map((s) => {
        const [dx, dz] = SEAT_OUT[s];
        const yaw = Math.atan2(dx, dz);
        return (
          <group key={s} rotation={[0, yaw, 0]}>
            <CuboidCollider args={[TRAY_LAT, 3, 0.2]} position={[0, TABLE_SURF + 3, TRAY_CENTER - TRAY_RAD]} />
            <CuboidCollider args={[TRAY_LAT, 3, 0.2]} position={[0, TABLE_SURF + 3, TRAY_CENTER + TRAY_RAD]} />
            <CuboidCollider args={[0.2, 3, TRAY_RAD]} position={[-TRAY_LAT, TABLE_SURF + 3, TRAY_CENTER]} />
            <CuboidCollider args={[0.2, 3, TRAY_RAD]} position={[TRAY_LAT, TABLE_SURF + 3, TRAY_CENTER]} />
          </group>
        );
      })}
      <DiceBodies />
      <CombatDice />
    </Physics>
  );
}
