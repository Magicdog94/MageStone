// Top-down grid diagrams used as visual aids in the "How to Play" guide. They're
// drawn to match the real game (16×16 octagon board, central MageStone zone, 2×2
// Nexus, kind-coloured pieces) so they never go stale. No photo assets.
import type { ReactNode } from 'react';
import { exists, inCentralZone, inNexus, edgeRotation, N } from '../game/board';
import { COLORS } from '../three/coords';

// Palette (matched to the board + dice/kind colours).
const LAT = 'rgba(201, 166, 90, 0.45)';
const T1 = '#164029';
const T2 = '#0f2c1d';
const ZONE = '#1b4a34';
const NEX = '#c9a24a';
const GOLD = '#eccb78';
const WAR = '#cf4a3f'; // warrior (red die)
const MAG = '#3f7fd0'; // mage (blue die)
const PRI = '#3aa55f'; // priest (green die)
const ENEMY = '#9b6dd0'; // an opposing unit, for combat diagrams
const GEM = '#5fe0a8';

type XY = [number, number];

function Disc({ cx, cy, r, color, label }: { cx: number; cy: number; r: number; color: string; label: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} stroke="rgba(0,0,0,0.55)" strokeWidth="1.1" />
      <ellipse cx={cx} cy={cy - r * 0.32} rx={r * 0.62} ry={r * 0.4} fill="rgba(255,255,255,0.16)" />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="dg-label">
        {label}
      </text>
    </g>
  );
}

function Gem({ cx, cy, r = 5 }: { cx: number; cy: number; r?: number }) {
  return (
    <polygon
      points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
      fill={GEM}
      stroke="#1c6b4c"
      strokeWidth="1"
    />
  );
}

function Arrow({ from, to, color = GOLD, w = 2.6 }: { from: XY; to: XY; color?: string; w?: number }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const h = 8;
  const a1 = ang + Math.PI * 0.82;
  const a2 = ang - Math.PI * 0.82;
  return (
    <g stroke={color} fill={color}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={w} strokeLinecap="round" />
      <polygon
        points={`${x2},${y2} ${x2 + h * Math.cos(a1)},${y2 + h * Math.sin(a1)} ${x2 + h * Math.cos(a2)},${y2 + h * Math.sin(a2)}`}
        stroke="none"
      />
    </g>
  );
}

/** A plain n-col × n-row checker grid; `ox/oy` origin, `cell` size. */
function checker(cols: number, rows: number, ox: number, oy: number, cell: number, baseRow?: number): ReactNode[] {
  const out: ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(
        <rect
          key={`${r}-${c}`}
          x={ox + c * cell}
          y={oy + r * cell}
          width={cell}
          height={cell}
          fill={r === baseRow ? 'rgba(192, 57, 43, 0.32)' : (r + c) % 2 ? T2 : T1}
          stroke={LAT}
          strokeWidth="1"
        />,
      );
    }
  }
  return out;
}

const mid = (ox: number, oy: number, cell: number, r: number, c: number): XY => [
  ox + c * cell + cell / 2,
  oy + r * cell + cell / 2,
];

function Figure({ label, caption, height, children }: { label: string; caption: string; height: number; children: ReactNode }) {
  return (
    <figure className="dg">
      <svg viewBox={`0 0 300 ${height}`} role="img" aria-label={label}>
        {children}
      </svg>
      <figcaption className="dg-cap">{caption}</figcaption>
    </figure>
  );
}

/** The whole board, top-down: four coloured bases, the central zone and Nexus. */
export function BoardOverview() {
  const cell = 9;
  const ox = 78;
  const oy = 8;
  const edge = [COLORS.red, COLORS.blue, COLORS.green, COLORS.yellow]; // rotations 0,1,2,3
  const rects: ReactNode[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!exists(r, c)) continue;
      let f: string;
      if (inNexus(r, c)) f = NEX;
      else if (inCentralZone(r, c)) f = ZONE;
      else {
        const rot = edgeRotation(r, c);
        f = rot != null ? edge[rot] : (r + c) % 2 ? T2 : T1;
      }
      rects.push(
        <rect key={`${r}-${c}`} x={ox + c * cell} y={oy + r * cell} width={cell} height={cell} fill={f} stroke={LAT} strokeWidth="0.7" />,
      );
    }
  }
  const gems: XY[] = [[5, 7], [7, 10], [10, 8], [8, 5]];
  return (
    <Figure
      label="Top-down view of the MageStone board"
      caption="Four coloured bases ring the octagon board; the tinted centre is the MageStone zone, with the gilded 2×2 Nexus at its heart."
      height={oy + N * cell + 8}
    >
      {rects}
      {gems.map(([r, c], i) => (
        <Gem key={i} cx={ox + c * cell + cell / 2} cy={oy + r * cell + cell / 2} r={4} />
      ))}
    </Figure>
  );
}

/** One home row with the starting formation. */
export function SetupDiagram() {
  const cols = 8;
  const rows = 3;
  const cell = 30;
  const ox = 30;
  const oy = 8;
  const form = ['W', 'W', 'W', 'P', 'M', 'W', 'W', 'W'];
  const color: Record<string, string> = { W: WAR, P: PRI, M: MAG };
  return (
    <Figure
      label="Starting formation on the home row"
      caption="Your home row, left to right: Warrior · Warrior · Warrior · Priest · Mage · Warrior · Warrior · Warrior."
      height={oy + rows * cell + 8}
    >
      {checker(cols, rows, ox, oy, cell, 0)}
      {form.map((k, i) => (
        <Disc key={i} cx={ox + i * cell + cell / 2} cy={oy + cell / 2} r={11} color={color[k]} label={k} />
      ))}
    </Figure>
  );
}

/** A bending orthogonal move up to the die's value. */
export function MoveDiagram() {
  const n = 6;
  const cell = 30;
  const ox = 60;
  const oy = 8;
  const path: XY[] = [[5, 2], [5, 3], [4, 3], [3, 3]];
  const C = (r: number, c: number) => mid(ox, oy, cell, r, c);
  return (
    <Figure
      label="Orthogonal movement path"
      caption="Spend a die to move its unit up to that many squares — orthogonally, turning corners if you like, but never diagonally."
      height={oy + n * cell + 8}
    >
      {checker(n, n, ox, oy, cell)}
      {path.map(([r, c], i) => (
        <rect key={i} x={ox + c * cell + 4} y={oy + r * cell + 4} width={cell - 8} height={cell - 8} rx={3} fill="rgba(86, 224, 168, 0.35)" />
      ))}
      <Arrow from={C(5, 1)} to={C(3, 3)} color="#7ef0c0" />
      <Disc cx={C(5, 1)[0]} cy={C(5, 1)[1]} r={12} color={WAR} label="W" />
    </Figure>
  );
}

/** Two Warriors coordinating on one adjacent enemy. */
export function CombatDiagram() {
  const cols = 5;
  const rows = 3;
  const cell = 34;
  const ox = (300 - cols * cell) / 2;
  const oy = 8;
  const C = (r: number, c: number) => mid(ox, oy, cell, r, c);
  return (
    <Figure
      label="Attacking an adjacent enemy"
      caption="Strike an orthogonally adjacent enemy. Two or three Warriors can attack together, summing their dice against the defender."
      height={oy + rows * cell + 8}
    >
      {checker(cols, rows, ox, oy, cell)}
      <Arrow from={[C(1, 1)[0] + 12, C(1, 1)[1]]} to={[C(1, 2)[0] - 14, C(1, 2)[1]]} color="#ff5a4d" w={3} />
      <Arrow from={[C(1, 3)[0] - 12, C(1, 3)[1]]} to={[C(1, 2)[0] + 14, C(1, 2)[1]]} color="#ff5a4d" w={3} />
      <Disc cx={C(1, 1)[0]} cy={C(1, 1)[1]} r={13} color={WAR} label="W" />
      <Disc cx={C(1, 3)[0]} cy={C(1, 3)[1]} r={13} color={WAR} label="W" />
      <Disc cx={C(1, 2)[0]} cy={C(1, 2)[1]} r={13} color={ENEMY} label="E" />
    </Figure>
  );
}

/** The Mage collecting a stone, then returning to base to activate. */
export function StoneDiagram() {
  const cols = 6;
  const rows = 4;
  const cell = 30;
  const ox = 60;
  const oy = 8;
  const C = (r: number, c: number) => mid(ox, oy, cell, r, c);
  return (
    <Figure
      label="Collecting and activating a MageStone"
      caption="Land the Mage on a MageStone to collect it, then return to your own base to activate it — powering up its attack die (d6 → d12 → d20)."
      height={oy + rows * cell + 8}
    >
      {checker(cols, rows, ox, oy, cell, 3)}
      <Gem cx={C(0, 2)[0]} cy={C(0, 2)[1]} r={7} />
      <Arrow from={[C(0, 2)[0], C(0, 2)[1] + 14]} to={[C(3, 2)[0], C(3, 2)[1] - 14]} />
      <Disc cx={C(0, 2)[0]} cy={C(0, 2)[1]} r={12} color={MAG} label="M" />
      <Disc cx={C(3, 2)[0]} cy={C(3, 2)[1]} r={12} color={MAG} label="M" />
    </Figure>
  );
}

/** A Priest holding the central 2×2 Nexus. */
export function NexusDiagram() {
  const n = 6;
  const cell = 30;
  const ox = 60;
  const oy = 8;
  const nexus: XY[] = [[2, 2], [2, 3], [3, 2], [3, 3]];
  const C = (r: number, c: number) => mid(ox, oy, cell, r, c);
  const rects = checker(n, n, ox, oy, cell);
  const nexusTiles = nexus.map(([r, c], i) => (
    <rect key={`x-${i}`} x={ox + c * cell} y={oy + r * cell} width={cell} height={cell} fill={NEX} stroke={LAT} strokeWidth="1" />
  ));
  return (
    <Figure
      label="A Priest holding the Nexus"
      caption="Move your Priest onto the central Nexus and hold it for a full round to win by Ritual."
      height={oy + n * cell + 8}
    >
      {rects}
      {nexusTiles}
      <rect x={ox + 2 * cell - 4} y={oy + 2 * cell - 4} width={2 * cell + 8} height={2 * cell + 8} rx={6} fill="none" stroke={GOLD} strokeWidth="2" opacity="0.8" />
      <Disc cx={C(2, 2)[0]} cy={C(2, 2)[1]} r={12} color={PRI} label="P" />
    </Figure>
  );
}
