import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { allCells, cellKey, edgeRotation, N } from '../game/board';
import type { Cell } from '../game/types';
import { besiegersOf, siegedPlayers } from '../game/rules';
import { BOARD, CELL, COLORS, FLOOR_Y, TABLE_HALF, TILE_SURFACE, cellToWorld } from './coords';
import { emeraldBoardTexture, groundBumpTexture, planksBumpTexture, woodBumpTexture } from './textures';
import { attackTargetIds, moveDestinations, useGame } from '../store';

// Elevation stack (low → high): recessed map tiles, then the raised gold
// trim lattice standing proud around each debossed tile pocket.
const TILE_TOP = TILE_SURFACE; // 0.18 — tiles sit recessed
const TILE_H = 0.16;
const GOLD_TOP = 0.235; // gold lattice raised ~0.055 above the tiles
const GOLD_H = 0.22;
const TILE_INSET = 0.94; // tile size within the cell → thin gold trim

// Wooden tabletop the board rests on: a SQUARE slab (TABLE_HALF half-width),
// bevelled, four × the gold-trim height (it grows downward), sitting flush
// under the board tiles — the strip around the board is where dice are rolled.
const TABLE_H = GOLD_H * 5;
const TABLE_TOP_Y = TILE_TOP - TILE_H; // 0.02 — board tiles rest on this surface

// The board surface is a single procedural emerald-marble texture (no pictorial
// art) spanned full-bleed across the 16×16 grid: each tile samples its own slice
// so the marbling flows continuously under the raised gold lattice.

function tabletopGeometry(): THREE.ExtrudeGeometry {
  const s = TABLE_HALF;
  const shape = new THREE.Shape();
  shape.moveTo(-s, -s);
  shape.lineTo(s, -s);
  shape.lineTo(s, s);
  shape.lineTo(-s, s);
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

// The table is ONE piece of furniture: every part — slab, collar, column,
// plinth — wears the same wood photo under the same single tint, so it reads
// as one continuous old oak table rather than an assembly of materials.
const TABLE_TINT = '#4a3624';

/** The shared table-wood photo, cloned per part so each sets its own repeat. */
function useTableWood(rx: number, ry: number): THREE.Texture {
  const base = useTexture('/wood-texture.png') as THREE.Texture;
  return useMemo(() => {
    const t = base.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }, [base, rx, ry]);
}

function Tabletop() {
  const wood = useTableWood(0.1, 0.1); // larger planks (fewer repeats across the slab)
  // Deep plank relief: heavy seams + grain ridges + scattered scratches so the
  // slab reads as built from thick worn boards rather than one smooth extrusion.
  const bump = useMemo(() => {
    const t = planksBumpTexture().clone();
    t.repeat.set(0.35, 0.35);
    t.needsUpdate = true;
    return t;
  }, []);
  const geom = useMemo(() => tabletopGeometry(), []);
  const topY = geom.boundingBox?.max.y ?? TABLE_H;
  return (
    <mesh geometry={geom} position={[0, TABLE_TOP_Y - topY, 0]} receiveShadow castShadow>
      <meshStandardMaterial
        map={wood}
        bumpMap={bump}
        bumpScale={0.14}
        color={TABLE_TINT}
        roughness={0.8}
        metalness={0}
        envMapIntensity={0.35}
      />
    </mesh>
  );
}

/**
 * The stand the table rises from — a turned-wood collar under the slab, a
 * carved octagonal column, and a two-step wooden foot standing on the plaza
 * floor (FLOOR_Y). All in the table's single wood so slab + stand read as one
 * heavy piece of furniture.
 */
function TableStand() {
  const wood = useTableWood(1.2, 0.5);
  const bump = useMemo(() => {
    const t = woodBumpTexture().clone();
    t.repeat.set(3, 1);
    t.needsUpdate = true;
    return t;
  }, []);
  const woodMat = (
    <meshStandardMaterial
      map={wood}
      bumpMap={bump}
      bumpScale={0.06}
      color={TABLE_TINT}
      roughness={0.82}
      metalness={0}
      envMapIntensity={0.2}
    />
  );
  const tableBottom = TABLE_TOP_Y - TABLE_H - 0.12; // slab underside incl. bevel
  const plinthTop = FLOOR_Y + 1.0;
  const colH = tableBottom - plinthTop;
  const colMid = plinthTop + colH / 2;
  const rot: [number, number, number] = [0, Math.PI / 8, 0]; // flats face the board edges
  return (
    <group>
      {/* turned collar joining the slab to the column */}
      <mesh position={[0, tableBottom - 0.11, 0]} rotation={rot} castShadow>
        <cylinderGeometry args={[6.1, 6.1, 0.26, 8]} />
        {woodMat}
      </mesh>
      {/* carved octagonal pedestal column (the tabletop stands 1.5 m proud) */}
      <mesh position={[0, colMid, 0]} rotation={rot} castShadow receiveShadow>
        <cylinderGeometry args={[5.0, 7.4, colH, 8]} />
        {woodMat}
      </mesh>
      {/* carved moulding around the column's waist */}
      <mesh position={[0, colMid, 0]} rotation={rot}>
        <cylinderGeometry args={[6.6, 6.6, 0.9, 8]} />
        {woodMat}
      </mesh>
      {/* two-step wooden foot on the floor */}
      <mesh position={[0, FLOOR_Y + 0.75, 0]} rotation={rot} castShadow receiveShadow>
        <cylinderGeometry args={[8.6, 9.4, 0.5, 8]} />
        {woodMat}
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.25, 0]} rotation={rot} castShadow receiveShadow>
        <cylinderGeometry args={[10.2, 11, 0.5, 8]} />
        {woodMat}
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
  siege,
  map,
  bump,
}: {
  cell: Cell;
  legal: boolean;
  target: boolean;
  /** Team colour for a home-base tile, or null for ordinary tiles. */
  baseColor: string | null;
  /** Besieging team's colour when this base tile's owner is under siege, else null. */
  siege: string | null;
  map: THREE.Texture;
  bump: THREE.Texture;
}) {
  const moveTo = useGame((s) => s.moveTo);
  // Every tile samples its slice of the emerald-marble surface — including the
  // 2×2 Nexus, which keeps its drawn gold emblem but no longer gets a warm tint,
  // so the marble flows unbroken across the centre.
  const geom = useMemo(() => tileGeometry(cell), [cell]);
  const pos = cellToWorld(cell, 0);
  const baseTint = baseColor ?? BOARD.stone;

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
          metalness={0.05}
          emissive={legal ? BOARD.highlight : siege ? siege : baseColor ? baseColor : '#000000'}
          emissiveIntensity={legal ? 0.4 : siege ? 0.55 : baseColor ? 0.32 : 0}
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
            siege={rot !== null ? siegeGlowBySeat.get(rot) ?? null : null}
          />
        );
      })}
    </group>
  );
}
