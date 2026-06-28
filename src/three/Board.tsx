import { useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { allCells, cellKey, CUT, N } from '../game/board';
import type { Cell } from '../game/types';
import { BOARD, CELL, TILE_SURFACE, cellToWorld } from './coords';
import { groundBumpTexture, woodBumpTexture } from './textures';
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
const TABLE_H = GOLD_H * 4;
const TABLE_MARGIN = 0.5; // half-tile wood border around the board
const TABLE_TOP_Y = TILE_TOP - TILE_H; // 0.02 — board tiles rest on this surface

// The board art (public/map-texture.png) is the full painted board — ornate
// frame, gem slots, then the playfield. Only the inner playfield maps onto the
// 16×16 tiles; this inset is the fraction of the image to skip on each side so
// the painted playfield lines up with the coded grid (the frame/gems fall in the
// excluded margin, where the 3D gold lattice + tabletop + pieces take over).
// Tune this single number to slide the art in/out relative to the grid.
const MAP_INSET = 0.113;

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
        bumpScale={0.04}
        color="#5e4429"
        roughness={0.72}
        metalness={0}
        envMapIntensity={0.4}
      />
    </mesh>
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
  // Map cell c/row r into the inset playfield sub-rect [MAP_INSET, 1-MAP_INSET].
  const span = 1 - 2 * MAP_INSET;
  const u0 = MAP_INSET + (cell.c / N) * span;
  const u1 = MAP_INSET + ((cell.c + 1) / N) * span;
  const v0 = MAP_INSET + ((N - 1 - cell.r) / N) * span; // +z edge
  const v1 = MAP_INSET + ((N - cell.r) / N) * span; // -z edge
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

function Tile({
  cell,
  legal,
  target,
  map,
  bump,
}: {
  cell: Cell;
  legal: boolean;
  target: boolean;
  map: THREE.Texture;
  bump: THREE.Texture;
}) {
  const moveTo = useGame((s) => s.moveTo);
  // Every tile (including the 2×2 Nexus) samples its slice of the board art, so
  // the painted Nexus mandala shows through instead of a gold cap.
  const geom = useMemo(() => tileGeometry(cell), [cell]);
  const pos = cellToWorld(cell, 0);

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
          bumpScale={0.02}
          // Darken the map: it's pre-lit painted art, so multiply it down and
          // damp the environment IBL so the scene lights don't wash it out.
          color={legal ? BOARD.highlight : '#9c9c9c'}
          envMapIntensity={0.45}
          roughness={0.9}
          metalness={0}
          emissive={legal ? BOARD.highlight : '#000000'}
          emissiveIntensity={legal ? 0.4 : 0}
        />
      </mesh>

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
  const map = useTexture('/map-texture.png', (t) => {
    const tex = t as THREE.Texture;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
  });
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

  return (
    <group>
      <Tabletop />
      <GoldInlay />
      {cells.map((cell) => {
        const k = cellKey(cell);
        return (
          <Tile
            key={k}
            cell={cell}
            map={map}
            bump={bump}
            legal={legalKeys.has(k)}
            target={targetKeys.has(k)}
          />
        );
      })}
    </group>
  );
}
