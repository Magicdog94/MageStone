import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CuboidCollider, Physics, RigidBody, type RapierRigidBody } from '@react-three/rapier';
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
  const seat = useGame((s) => s.game.seats[s.game.current] ?? 0);

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
      // of real time, read the faces as they lie.
      const timedOut =
        throwAt.current > 0 && performance.now() - throwAt.current > 8000;
      if ((liveFrames.current > 20 && settleFrames.current > 10) || timedOut) {
        if (timedOut) console.warn('MageStone: dice settle timed out — forcing a read');
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

function CombatDice() {
  const rolling = useGame((s) => s.rolling);
  const showCombatRoll = useGame((s) => s.showCombatRoll);

  const [run, setRun] = useState<CombatRun | null>(null);
  const bodies = useRef<(RapierRigidBody | null)[]>([]);
  const thrown = useRef(false);
  const thrownAt = useRef(0);
  const settled = useRef(false);
  const liveFrames = useRef(0);
  const calmFrames = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);

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
      window.clearTimeout(hideTimer.current);
      showCombatRoll(null); // hide any prior result until THESE dice settle
      // Each side's dice land on that side's OWN tray (seats captured now,
      // so a turn change during the linger can't relocate them).
      const atkSeat = s.game.seats[c.attackerOwner] ?? 0;
      const defSeat = s.game.seats[c.defenderOwner] ?? 0;
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
    // Wall-clock safety net (frame counts stretch on slow machines).
    const timedOut = thrownAt.current > 0 && performance.now() - thrownAt.current > 5000;
    if ((liveFrames.current > 20 && calmFrames.current > 10) || timedOut) {
      settled.current = true;
      // Lay each die flat in a row showing the ENGINE's value (the same
      // value-face-up snap the turn dice perform after reading).
      bodies.current.slice(0, run.spec.length).forEach((b, i) => {
        if (!b) return;
        const d = run.spec[i];
        const normal =
          d.faces === 6
            ? NORMALS[FACE_VALUES.indexOf(d.value)]
            : polyDef(d.faces as 12 | 20).faces[d.value - 1].normal;
        const q = new THREE.Quaternion().setFromUnitVectors(normal, UP);
        q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, rand(0, Math.PI * 2)));
        const [x, z] = trayToWorld(d.seat, (d.slot - (d.slots - 1) / 2) * LANE, 0);
        const rest = d.faces === 6 ? H : d.faces === 12 ? 0.42 : 0.47; // face-to-centre
        b.setTranslation({ x, y: TABLE_SURF + rest, z }, true);
        b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
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
          {d.faces === 6 ? (
            <DieMesh kind={d.kind} />
          ) : (
            <PolyDieMesh faces={d.faces as 12 | 20} kind={d.kind} />
          )}
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
