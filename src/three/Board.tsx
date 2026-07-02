import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { allCells, cellKey, CUT, edgeRotation, inNexus, N } from '../game/board';
import type { Cell } from '../game/types';
import { besiegersOf, siegedPlayers } from '../game/rules';
import { BOARD, CELL, COLORS, FLOOR_Y, TILE_SURFACE, cellToWorld } from './coords';
import { emeraldBoardTexture, groundBumpTexture, woodBumpTexture } from './textures';
import { attackTargetIds, moveDestinations, useGame } from '../store';

// Elevation stack (low → high): recessed map tiles, then the raised gold
// trim lattice standing proud around each debossed tile pocket.
const TILE_TOP = TILE_SURFACE; // 0.18 — tiles sit recessed
const TILE_H = 0.16;
const GOLD_TOP = 0.235; // gold lattice raised ~0.055 above the tiles
const GOLD_H = 0.22;
const TILE_INSET = 0.94; // tile size within the cell → thin gold trim

// Wooden tabletop the board rests on: the board's cut-corner octagon silhouette
// offset outward by half a tile, bevelled, four × the gold-trim height (it grows
// downward), sitting flush under the board tiles.
const TABLE_H = GOLD_H * 5;
const TABLE_MARGIN = 1.5; // wide wooden table surface around the board
const TABLE_TOP_Y = TILE_TOP - TILE_H; // 0.02 — board tiles rest on this surface

// The board surface is a single procedural emerald-marble texture (no pictorial
// art) spanned full-bleed across the 16×16 grid: each tile samples its own slice
// so the marbling flows continuously under the raised gold lattice.

/** Board outline (cut-corner octagon) as a minimal corner-only vertex loop. */
function boardOutline(): [number, number][] {
  const off = N / 2; // 8 → board spans world [-8, 8]
  const inset = (R: number) => Math.max(0, CUT - Math.min(R, N - 1 - R));
  const xL = (R: number) => inset(R) - off;
  const xR = (R: number) => off - inset(R);
  const raw: [number, number][] = [];
  for (let R = 0; R < N; R++) raw.push([xR(R), R - off], [xR(R), R + 1 - off]);
  for (let R = N - 1; R >= 0; R--) raw.push([xL(R), R + 1 - off], [xL(R), R - off]);
  // Drop duplicate, then collinear, vertices → keep only the corner turns.
  const dedup = raw.filter((p, i) => {
    const q = raw[(i - 1 + raw.length) % raw.length];
    return p[0] !== q[0] || p[1] !== q[1];
  });
  return dedup.filter((p, i) => {
    const a = dedup[(i - 1 + dedup.length) % dedup.length];
    const b = dedup[(i + 1) % dedup.length];
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
}

/** Offset a rectilinear loop outward by `m` (squared corners). Each vertex joins
 *  one vertical and one horizontal edge; shift x by the vertical edge's outward
 *  normal and z by the horizontal edge's. */
function offsetOutline(pts: [number, number][], m: number): [number, number][] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const s = area > 0 ? 1 : -1; // orientation → outward-normal sign
  const n = pts.length;
  return pts.map((cur, i) => {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    let nx = cur[0];
    let nz = cur[1];
    for (const [a, b] of [
      [prev, cur],
      [cur, next],
    ] as const) {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      if (dx === 0) nx = cur[0] + s * Math.sign(dz) * m; // vertical edge → shift x
      else nz = cur[1] - s * Math.sign(dx) * m; // horizontal edge → shift z
    }
    return [nx, nz] as [number, number];
  });
}

function tabletopGeometry(): THREE.ExtrudeGeometry {
  const pts = offsetOutline(boardOutline(), TABLE_MARGIN);
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: TABLE_H,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  geo.rotateX(-Math.PI / 2); // lay the slab flat, thickness along Y
  geo.computeBoundingBox();
  return geo;
}

function Tabletop() {
  const wood = useTexture('/wood-texture.png', (t) => {
    const tex = t as THREE.Texture;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.1, 0.1); // larger planks (fewer repeats across the slab)
    tex.anisotropy = 8;
    tex.needsUpdate = true;
  });
  const bump = useMemo(() => {
    const t = woodBumpTexture();
    t.repeat.set(0.1, 0.1); // match the wood map's plank scale
    return t;
  }, []);
  const geom = useMemo(() => tabletopGeometry(), []);
  const topY = geom.boundingBox?.max.y ?? TABLE_H;
  return (
    <mesh geometry={geom} position={[0, TABLE_TOP_Y - topY, 0]} receiveShadow castShadow>
      <meshStandardMaterial
        map={wood}
        bumpMap={bump}
        bumpScale={0.06}
        color="#43301d"
        roughness={0.82}
        metalness={0}
        envMapIntensity={0.35}
      />
    </mesh>
  );
}

/**
 * The stand the table rises from — a gilt collar under the slab, a carved
 * octagonal column, and a two-step stone plinth standing on the plaza floor
 * (FLOOR_Y), so the table is grounded in the arena instead of floating.
 */
function TableStand() {
  const bump = useMemo(() => {
    const t = woodBumpTexture().clone();
    t.repeat.set(3, 1);
    t.needsUpdate = true;
    return t;
  }, []);
  const tableBottom = TABLE_TOP_Y - TABLE_H - 0.12; // slab underside incl. bevel
  const plinthTop = FLOOR_Y + 1.0;
  const colH = tableBottom - plinthTop;
  const colMid = plinthTop + colH / 2;
  const rot: [number, number, number] = [0, Math.PI / 8, 0]; // flats face the board edges
  return (
    <group>
      {/* gold collar joining the slab to the column */}
      <mesh position={[0, tableBottom - 0.11, 0]} rotation={rot} castShadow>
        <cylinderGeometry args={[6.1, 6.1, 0.26, 8]} />
        <meshStandardMaterial
          color={BOARD.gold}
          metalness={0.85}
          roughness={0.35}
          emissive="#5a3f12"
          emissiveIntensity={0.15}
        />
      </mesh>
      {/* carved octagonal wooden column */}
      <mesh position={[0, colMid, 0]} rotation={rot} castShadow receiveShadow>
        <cylinderGeometry args={[5.2, 5.9, colH, 8]} />
        <meshStandardMaterial color="#372718" bumpMap={bump} bumpScale={0.06} roughness={0.82} metalness={0} />
      </mesh>
      {/* gold band around the column's waist */}
      <mesh position={[0, colMid, 0]} rotation={rot}>
        <cylinderGeometry args={[5.72, 5.72, 0.2, 8]} />
        <meshStandardMaterial
          color={BOARD.gold}
          metalness={0.85}
          roughness={0.4}
          emissive="#5a3f12"
          emissiveIntensity={0.12}
        />
      </mesh>
      {/* two-step stone plinth on the plaza */}
      <mesh position={[0, FLOOR_Y + 0.75, 0]} rotation={rot} castShadow receiveShadow>
        <cylinderGeometry args={[6.5, 7.1, 0.5, 8]} />
        <meshStandardMaterial color="#1a231c" roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.25, 0]} rotation={rot} castShadow receiveShadow>
        <cylinderGeometry args={[7.6, 8.2, 0.5, 8]} />
        <meshStandardMaterial color="#161e18" roughness={0.94} metalness={0} />
      </mesh>
    </group>
  );
}

/**
 * One tile box whose UVs sample the slice of the shared board map that lies
 * under this cell — so the single texture spans the whole board continuously
 * (the gold trim grid sits on top of the thin inset seams). Column c → u
 * [c/N, (c+1)/N]; row r → v [(N-1-r)/N, (N-r)/N] (image top at row 0). The
 * generic [0,1]→sub-rect remap also keeps the thin pocket walls colour-matched.
 */
function tileGeometry(cell: Cell): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(CELL * TILE_INSET, TILE_H, CELL * TILE_INSET);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Full-bleed: each tile samples its own [c/N,(c+1)/N] × [(N-1-r)/N,(N-r)/N]
  // slice of the marble so the surface is continuous across the whole board.
  const u0 = cell.c / N;
  const u1 = (cell.c + 1) / N;
  const v0 = (N - 1 - cell.r) / N; // +z edge
  const v1 = (N - cell.r) / N; // -z edge
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
  return g;
}

// Shared materials ---------------------------------------------------------

function useGoldMaterial(emissive = 0.12) {
  // Clean uniform metallic gold — no texture map, so the trim reads as one
  // smooth gilt surface (the old gradient map repeated per tile, looking "cut").
  return useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: BOARD.gold,
        roughness: 0.3,
        metalness: 0.9,
        emissive: new THREE.Color('#5a3f12'),
        emissiveIntensity: emissive,
      }),
    [emissive],
  );
}

/** A pulsing wash over a base tile whose owner is under siege (an enemy is
 *  standing on the base, so its Mage/Priest can't respawn). The owner's team
 *  wash is suppressed underneath and this overlay runs near-opaque, so the base
 *  reads in the besieging team's EXACT colour. */
function SiegeGlow({ color }: { color: string }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.62 + 0.2 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.2));
  });
  return (
    <mesh position={[0, TILE_TOP + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[CELL * TILE_INSET, CELL * TILE_INSET]} />
      <meshBasicMaterial ref={mat} color={color} transparent opacity={0.72} depthWrite={false} />
    </mesh>
  );
}

function Tile({
  cell,
  legal,
  target,
  baseColor,
  nexus,
  siege,
  map,
  bump,
}: {
  cell: Cell;
  legal: boolean;
  target: boolean;
  /** Team colour for a home-base tile, or null for ordinary tiles. */
  baseColor: string | null;
  /** True for the central 2×2 Nexus tiles (gilded). */
  nexus: boolean;
  /** Besieging team's colour when this base tile's owner is under siege, else null. */
  siege: string | null;
  map: THREE.Texture;
  bump: THREE.Texture;
}) {
  const moveTo = useGame((s) => s.moveTo);
  // Every tile samples its slice of the emerald-marble surface; the 2×2 Nexus is
  // gilded by a warmer multiplier so the ritual zone still reads at the centre.
  const geom = useMemo(() => tileGeometry(cell), [cell]);
  const pos = cellToWorld(cell, 0);
  const baseTint = baseColor ?? (nexus ? BOARD.nexus : BOARD.stone);

  return (
    <group position={[pos[0], 0, pos[2]]}>
      <mesh
        geometry={geom}
        position={[0, TILE_TOP - TILE_H / 2, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          if (legal) moveTo(cell);
        }}
        onPointerOver={(e) => {
          if (!legal) return;
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          if (legal) document.body.style.cursor = 'auto';
        }}
      >
        <meshStandardMaterial
          map={map}
          bumpMap={bump}
          bumpScale={0.025}
          // The emerald-marble texture carries the colour; tiles multiply it with
          // a neutral stone tint (or team/nexus tint). Home bases tint toward their
          // team colour so ownership reads at a glance; the Nexus is gilded.
          color={legal ? BOARD.highlight : baseTint}
          envMapIntensity={0.5}
          roughness={0.82}
          metalness={nexus ? 0.25 : 0.05}
          emissive={
            legal ? BOARD.highlight : siege ? siege : baseColor ? baseColor : nexus ? BOARD.nexus : '#000000'
          }
          emissiveIntensity={legal ? 0.4 : siege ? 0.55 : baseColor ? 0.32 : nexus ? 0.16 : 0}
        />
      </mesh>

      {/* Translucent team wash sitting above the painted art, so the base square
          reads as that team's colour while the artwork still shows beneath.
          Hidden while under siege so the attacker's exact colour shows alone. */}
      {baseColor && !legal && !siege && (
        <mesh position={[0, TILE_TOP + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[CELL * TILE_INSET, CELL * TILE_INSET]} />
          <meshBasicMaterial color={baseColor} transparent opacity={0.42} />
        </mesh>
      )}

      {siege && !legal && <SiegeGlow color={siege} />}

      {legal && (
        <mesh position={[0, TILE_TOP + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.16, 0.3, 24]} />
          <meshBasicMaterial color={'#eafff6'} transparent opacity={0.85} />
        </mesh>
      )}
      {target && (
        <mesh position={[0, TILE_TOP + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 0.46, 28]} />
          <meshBasicMaterial color={BOARD.target} transparent opacity={0.95} />
        </mesh>
      )}
    </group>
  );
}

/** Raised gold lattice: one frame-ring per cell, standing proud around each
 *  recessed tile so the trim reads as an embossed grid. */
function GoldInlay() {
  const cells = useMemo(() => allCells(), []);
  const mat = useGoldMaterial(0.14);
  const ring = useMemo(() => {
    const outer = CELL / 2;
    const inner = (CELL * (TILE_INSET + 0.03)) / 2; // hole slightly > tile → clean reveal
    const s = new THREE.Shape();
    s.moveTo(-outer, -outer);
    s.lineTo(outer, -outer);
    s.lineTo(outer, outer);
    s.lineTo(-outer, outer);
    s.lineTo(-outer, -outer);
    const hole = new THREE.Path();
    hole.moveTo(-inner, -inner);
    hole.lineTo(inner, -inner);
    hole.lineTo(inner, inner);
    hole.lineTo(-inner, inner);
    hole.lineTo(-inner, -inner);
    s.holes.push(hole);
    return new THREE.ExtrudeGeometry(s, {
      depth: GOLD_H,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.02,
      bevelSegments: 1,
    });
  }, []);

  return (
    <group>
      {cells.map((cell) => {
        const pos = cellToWorld(cell, 0);
        return (
          <mesh
            key={cellKey(cell)}
            geometry={ring}
            material={mat}
            position={[pos[0], GOLD_TOP - GOLD_H, pos[2]]}
            rotation={[-Math.PI / 2, 0, 0]}
            castShadow
            receiveShadow
          />
        );
      })}
    </group>
  );
}

export function Board() {
  const cells = useMemo(() => allCells(), []);
  const map = useMemo(() => emeraldBoardTexture(), []);
  const bump = useMemo(() => groundBumpTexture(), []);
  const game = useGame((s) => s.game);
  const selUnit = useGame((s) => s.selectedUnitId);
  const selDie = useGame((s) => s.selectedDieId);

  const legalKeys = useMemo(
    () => new Set(moveDestinations(game, selUnit, selDie).map(cellKey)),
    [game, selUnit, selDie],
  );
  const targetKeys = useMemo(() => {
    const ids = attackTargetIds(game, selUnit);
    return new Set(game.units.filter((u) => ids.has(u.id)).map((u) => cellKey(u.cell)));
  }, [game, selUnit]);

  // Home-base tiles get their seated team's colour. Seats are decoupled from
  // colour, so look up which playing colour occupies each edge this game.
  const seatColor = useMemo(() => {
    const byRotation: Record<number, string> = {};
    for (const p of game.players) byRotation[game.seats[p]] = COLORS[p];
    return byRotation;
  }, [game.players, game.seats]);

  // Seats whose base is under siege → the dominant besieger's colour, so the
  // base glows in the colour of the team claiming it.
  const siegeGlowBySeat = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of siegedPlayers(game)) {
      const attacker = besiegersOf(game, p)[0];
      if (attacker) m.set(game.seats[p], COLORS[attacker]);
    }
    return m;
  }, [game]);

  return (
    <group>
      <Tabletop />
      <TableStand />
      <GoldInlay />
      {cells.map((cell) => {
        const k = cellKey(cell);
        const rot = edgeRotation(cell.r, cell.c);
        const baseColor = rot !== null ? seatColor[rot] ?? null : null;
        return (
          <Tile
            key={k}
            cell={cell}
            map={map}
            bump={bump}
            legal={legalKeys.has(k)}
            target={targetKeys.has(k)}
            baseColor={baseColor}
            nexus={inNexus(cell.r, cell.c)}
            siege={rot !== null ? siegeGlowBySeat.get(rot) ?? null : null}
          />
        );
      })}
    </group>
  );
}
