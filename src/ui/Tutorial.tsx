// Visual how-to-play, opened from the landing screen. Each step pairs a short
// explanation with an on-theme SVG diagram of the real game (board, pip dice,
// pieces) annotated with arrows + labels. No photographic assets — the diagrams
// are drawn to match the live game so they never go stale.
import { useEffect, useState } from 'react';

// Colours matched to the game (dice + teams).
const MAGE = '#3f7fd0';
const PRIEST = '#3aa55f';
const WARRIOR = '#cf4a3f';
const RED = '#c0392b';
const STONE = '#1d3b2c';
const NEXUS = '#caa85e';
const GOLD = '#eccb78';

// ---- shared SVG primitives ----------------------------------------------

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function PipDie({ x, y, s = 34, value, color }: { x: number; y: number; s?: number; value: number; color: string }) {
  const pad = s * 0.24;
  const stepv = (s - 2 * pad) / 2;
  return (
    <g>
      <rect x={x} y={y} width={s} height={s} rx={s * 0.16} fill={color} stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      {PIPS[value].map(([cx, cy], i) => (
        <circle key={i} cx={x + pad + cx * stepv} cy={y + pad + cy * stepv} r={s * 0.08} fill="#fff" />
      ))}
    </g>
  );
}

function Arrow({ from, to, color = GOLD, width = 2.4 }: { from: [number, number]; to: [number, number]; color?: string; width?: number }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const h = 8;
  const a1 = ang + Math.PI * 0.84;
  const a2 = ang - Math.PI * 0.84;
  return (
    <g stroke={color} fill={color}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={width} strokeLinecap="round" />
      <polygon
        points={`${x2},${y2} ${x2 + h * Math.cos(a1)},${y2 + h * Math.sin(a1)} ${x2 + h * Math.cos(a2)},${y2 + h * Math.sin(a2)}`}
        stroke="none"
      />
    </g>
  );
}

function Label({ x, y, anchor = 'start', children }: { x: number; y: number; anchor?: 'start' | 'middle' | 'end'; children: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="tut-svg-label">
      {children}
    </text>
  );
}

/** A simple board piece (robed pawn). */
function Pawn({ cx, cy, color, k = 1 }: { cx: number; cy: number; color: string; k?: number }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy + 6 * k} rx={6 * k} ry={2.6 * k} fill="rgba(0,0,0,0.35)" />
      <path
        d={`M${cx - 5 * k},${cy + 6 * k} C${cx - 5 * k},${cy - 2 * k} ${cx - 3 * k},${cy - 6 * k} ${cx},${cy - 6 * k} C${cx + 3 * k},${cy - 6 * k} ${cx + 5 * k},${cy - 2 * k} ${cx + 5 * k},${cy + 6 * k} Z`}
        fill={color}
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.6"
      />
      <circle cx={cx} cy={cy - 7 * k} r={3.1 * k} fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth="0.6" />
    </g>
  );
}

/** A MageStone gem. */
function Gem({ cx, cy, r = 4 }: { cx: number; cy: number; r?: number }) {
  return (
    <polygon
      points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
      fill="#7ef0c0"
      stroke="#1c6b4c"
      strokeWidth="0.8"
    />
  );
}

/** An 8×8 board excerpt with the gold lattice, optional team base row and the
 *  central 2×2 Nexus. `children` overlays pieces/stones/arrows. */
function MiniGrid({
  ox,
  oy,
  cell = 20,
  baseColor,
  children,
}: {
  ox: number;
  oy: number;
  cell?: number;
  baseColor?: string;
  children?: React.ReactNode;
}) {
  const tiles = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const nexus = r >= 3 && r <= 4 && c >= 3 && c <= 4;
      tiles.push(
        <rect
          key={`${r}-${c}`}
          x={ox + c * cell + 1}
          y={oy + r * cell + 1}
          width={cell - 2}
          height={cell - 2}
          rx={2}
          fill={nexus ? NEXUS : baseColor && r === 0 ? baseColor : STONE}
          stroke="rgba(203,166,90,0.5)"
          strokeWidth="1"
        />,
      );
    }
  }
  return (
    <g>
      {tiles}
      {children}
    </g>
  );
}
const center = (ox: number, oy: number, r: number, c: number, cell = 20): [number, number] => [
  ox + c * cell + cell / 2,
  oy + r * cell + cell / 2,
];

// ---- step artwork --------------------------------------------------------

const OX = 24;
const OY = 18;

function ArtOverview() {
  const c = (r: number, col: number) => center(OX, OY, r, col);
  return (
    <svg className="tut-art" viewBox="0 0 360 210" role="img" aria-label="Board overview">
      <MiniGrid ox={OX} oy={OY} baseColor={RED}>
        {/* a few units on the red base */}
        <Pawn cx={c(0, 2)[0]} cy={c(0, 2)[1]} color={WARRIOR} k={0.8} />
        <Pawn cx={c(0, 3)[0]} cy={c(0, 3)[1]} color={PRIEST} k={0.8} />
        <Pawn cx={c(0, 4)[0]} cy={c(0, 4)[1]} color={MAGE} k={0.8} />
        <Pawn cx={c(0, 5)[0]} cy={c(0, 5)[1]} color={WARRIOR} k={0.8} />
        {/* scattered MageStones */}
        <Gem cx={c(2, 2)[0]} cy={c(2, 2)[1]} />
        <Gem cx={c(2, 5)[0]} cy={c(2, 5)[1]} />
        <Gem cx={c(5, 2)[0]} cy={c(5, 2)[1]} />
        <Gem cx={c(5, 5)[0]} cy={c(5, 5)[1]} />
      </MiniGrid>
      <Arrow from={[300, 40]} to={[c(0, 5)[0] + 8, c(0, 5)[1]]} />
      <Label x={304} y={38}>Your base</Label>
      <Arrow from={[300, 110]} to={[c(4, 4)[0] + 10, c(4, 4)[1]]} />
      <Label x={304} y={108}>Nexus</Label>
      <Arrow from={[300, 165]} to={[c(5, 5)[0] + 8, c(5, 5)[1]]} />
      <Label x={304} y={163}>MageStones</Label>
    </svg>
  );
}

function ArtArmy() {
  const cell = 30;
  const ox = 24;
  const oy = 70;
  const form: [string, string][] = [
    [WARRIOR, 'W'], [WARRIOR, 'W'], [WARRIOR, 'W'], [PRIEST, 'P'], [MAGE, 'M'], [WARRIOR, 'W'], [WARRIOR, 'W'], [WARRIOR, 'W'],
  ];
  return (
    <svg className="tut-art" viewBox="0 0 360 210" role="img" aria-label="Starting formation">
      {form.map(([color], i) => (
        <g key={i}>
          <rect x={ox + i * cell + 1} y={oy + 1} width={cell - 2} height={cell - 2} rx={3} fill={RED} stroke="rgba(203,166,90,0.55)" />
          <Pawn cx={ox + i * cell + cell / 2} cy={oy + cell / 2 + 2} color={color} k={1} />
        </g>
      ))}
      <Arrow from={[ox + 3.5 * cell, oy - 16]} to={[ox + 3.5 * cell, oy - 2]} />
      <Label x={ox + 3.5 * cell} y={oy - 22} anchor="middle">Priest</Label>
      <Arrow from={[ox + 4.5 * cell, oy + cell + 22]} to={[ox + 4.5 * cell, oy + cell + 6]} />
      <Label x={ox + 4.5 * cell} y={oy + cell + 36} anchor="middle">Mage</Label>
      <Label x={ox} y={oy + cell + 60} anchor="start">6 Warriors · 1 Priest · 1 Mage — on your home edge</Label>
    </svg>
  );
}

function ArtRoll() {
  const dice: [number, string, string][] = [
    [4, MAGE, 'Mage'],
    [3, PRIEST, 'Priest'],
    [5, WARRIOR, 'Warrior'],
    [2, WARRIOR, 'Warrior'],
    [6, WARRIOR, 'Warrior'],
  ];
  return (
    <svg className="tut-art" viewBox="0 0 360 210" role="img" aria-label="Rolling dice">
      {dice.map(([v, col], i) => (
        <PipDie key={i} x={26 + i * 46} y={70} s={38} value={v} color={col} />
      ))}
      <Label x={26} y={60}>1 Mage</Label>
      <Label x={118} y={60}>1 Priest</Label>
      <Label x={210} y={60}>3 Warrior dice</Label>
      <rect x={232} y={140} width={96} height={30} rx={6} fill="url(#tutGold)" />
      <text x={280} y={160} textAnchor="middle" className="tut-svg-btn">ROLL DICE</text>
      <Arrow from={[200, 155]} to={[228, 155]} />
      <Label x={26} y={158}>A die only commands its matching unit.</Label>
    </svg>
  );
}

function ArtDiscard() {
  const dice: [number, string, boolean][] = [
    [4, MAGE, false],
    [3, PRIEST, true],
    [5, WARRIOR, false],
    [2, WARRIOR, true],
    [6, WARRIOR, false],
  ];
  return (
    <svg className="tut-art" viewBox="0 0 360 210" role="img" aria-label="Discarding dice">
      {dice.map(([v, col, drop], i) => (
        <g key={i} opacity={drop ? 0.5 : 1}>
          <PipDie x={26 + i * 46} y={78} s={38} value={v} color={col} />
          {drop && (
            <g stroke="#ff5a4d" strokeWidth="3" strokeLinecap="round">
              <line x1={28 + i * 46} y1={80} x2={62 + i * 46} y2={114} />
              <line x1={62 + i * 46} y1={80} x2={28 + i * 46} y2={114} />
            </g>
          )}
        </g>
      ))}
      <Label x={64} y={70}>discard 2</Label>
      <Label x={26} y={150}>Keep the 3 powers you want for this turn.</Label>
    </svg>
  );
}

function ArtMove() {
  const c = (r: number, col: number) => center(OX, OY, r, col);
  return (
    <svg className="tut-art" viewBox="0 0 360 210" role="img" aria-label="Moving a unit">
      <MiniGrid ox={OX} oy={OY}>
        <Pawn cx={c(6, 1)[0]} cy={c(6, 1)[1]} color={WARRIOR} k={0.85} />
        {/* highlighted path tiles */}
        {[[6, 2], [6, 3], [5, 3], [4, 3]].map(([r, col], i) => (
          <rect key={i} x={OX + col * 20 + 3} y={OY + r * 20 + 3} width={14} height={14} rx={2} fill="#56e0a8" opacity="0.5" />
        ))}
        <Arrow from={c(6, 1)} to={c(4, 3)} color="#7ef0c0" width={2.6} />
      </MiniGrid>
      <PipDie x={300} y={70} s={34} value={4} color={WARRIOR} />
      <Arrow from={[300, 110]} to={[c(4, 3)[0] + 8, c(4, 3)[1]]} />
      <Label x={26} y={196}>Orthogonal path (it may bend), up to the die value. Up to 3 units/turn.</Label>
    </svg>
  );
}

function ArtAttack() {
  const c = (r: number, col: number) => center(OX, OY, r, col);
  return (
    <svg className="tut-art" viewBox="0 0 360 210" role="img" aria-label="Attacking">
      <MiniGrid ox={OX} oy={OY}>
        <Pawn cx={c(3, 2)[0]} cy={c(3, 2)[1]} color={WARRIOR} k={0.85} />
        <Pawn cx={c(3, 3)[0]} cy={c(3, 3)[1]} color={MAGE} k={0.85} />
        <Arrow from={[c(3, 2)[0] + 6, c(3, 2)[1] - 8]} to={[c(3, 3)[0] - 6, c(3, 3)[1] - 8]} color="#ff5a4d" />
      </MiniGrid>
      <PipDie x={250} y={40} s={30} value={5} color={WARRIOR} />
      <PipDie x={292} y={40} s={30} value={2} color={MAGE} />
      <Label x={250} y={36}>attacker</Label>
      <Label x={292} y={36}>defender d6</Label>
      <rect x={262} y={96} width={64} height={26} rx={13} fill="rgba(8,12,10,0.9)" stroke="#7fe6a0" />
      <text x={294} y={113} textAnchor="middle" className="tut-svg-btn" fill="#7fe6a0">72%</text>
      <Label x={250} y={140}>Win odds shown</Label>
      <Label x={250} y={158}>before you commit.</Label>
      <Label x={26} y={196}>Higher total wins; the loser is removed. Ties are rerolled.</Label>
    </svg>
  );
}

function ArtStones() {
  const c = (r: number, col: number) => center(OX, OY, r, col, 18);
  return (
    <svg className="tut-art" viewBox="0 0 360 210" role="img" aria-label="MageStones">
      <MiniGrid ox={OX} oy={36} cell={18} baseColor={RED}>
        <Gem cx={c(3, 4)[0]} cy={36 - OY + c(3, 4)[1]} />
      </MiniGrid>
      {/* the line above mis-offsets; draw the mage explicitly on a stone + on base */}
      <Pawn cx={OX + 4 * 18 + 9} cy={36 + 3 * 18 + 9} color={MAGE} k={0.8} />
      <Pawn cx={OX + 4 * 18 + 9} cy={36 + 9} color={MAGE} k={0.8} />
      <Arrow from={[OX + 4 * 18 + 9, 36 + 3 * 18 + 2]} to={[OX + 4 * 18 + 9, 36 + 18 + 4]} color={GOLD} />
      <Label x={OX + 4 * 18 + 22} y={36 + 2 * 18}>collect →</Label>
      <Label x={OX + 4 * 18 + 22} y={36 + 12}>activate on base</Label>
      {/* power die progression */}
      <PipDie x={236} y={64} s={26} value={6} color={MAGE} />
      <text x={272} y={82} className="tut-svg-label">→ d12 → d20</text>
      <Label x={236} y={56}>Mage attack die</Label>
      <Label x={236} y={120}>0–1 stones → d6</Label>
      <Label x={236} y={138}>2–3 → d12</Label>
      <Label x={236} y={156}>4–5 → d20</Label>
      <Label x={24} y={200}>Land on a stone to collect; activate on your base to power up.</Label>
    </svg>
  );
}

function ArtNexus() {
  const c = (r: number, col: number) => center(OX, OY, r, col);
  return (
    <svg className="tut-art" viewBox="0 0 360 210" role="img" aria-label="The Nexus">
      <MiniGrid ox={OX} oy={OY}>
        <circle cx={c(3, 3)[0] + 10} cy={c(3, 3)[1] + 10} r={26} fill="none" stroke={GOLD} strokeWidth="2" opacity="0.7" />
        <Pawn cx={c(3, 3)[0]} cy={c(3, 3)[1]} color={PRIEST} k={0.85} />
      </MiniGrid>
      <Arrow from={[300, 60]} to={[c(3, 4)[0] + 14, c(3, 4)[1]]} />
      <Label x={300} y={50}>Priest holds</Label>
      <Label x={300} y={66}>the Nexus…</Label>
      <Label x={300} y={104}>survive a full</Label>
      <Label x={300} y={120}>round = ritual</Label>
      <Label x={300} y={136}>victory!</Label>
      <Label x={26} y={196}>Priests can also resurrect a fallen Warrior from a gravestone.</Label>
    </svg>
  );
}

function ArtVictory() {
  return (
    <svg className="tut-art" viewBox="0 0 360 210" role="img" aria-label="Win conditions">
      {/* MageStone */}
      <g>
        <Gem cx={70} cy={70} r={16} />
        <text x={70} y={120} textAnchor="middle" className="tut-svg-label">Power 6 stones</text>
        <text x={70} y={138} textAnchor="middle" className="tut-svg-label">(Mage on base)</text>
      </g>
      {/* Ritual */}
      <g>
        <rect x={154} y={54} width={32} height={32} rx={4} fill={NEXUS} />
        <Pawn cx={170} cy={70} color={PRIEST} k={0.8} />
        <text x={170} y={120} textAnchor="middle" className="tut-svg-label">Nexus ritual</text>
      </g>
      {/* Conquest */}
      <g>
        <Pawn cx={285} cy={70} color={WARRIOR} k={1.1} />
        <text x={285} y={120} textAnchor="middle" className="tut-svg-label">Last team</text>
        <text x={285} y={138} textAnchor="middle" className="tut-svg-label">standing</text>
      </g>
      <text x={180} y={186} textAnchor="middle" className="tut-svg-label">Any one of these wins the game.</text>
    </svg>
  );
}

interface Step {
  title: string;
  text: string;
  art: () => React.ReactElement;
}
const STEPS: Step[] = [
  { title: 'Welcome to MageStone', text: 'Magical chess with dice for 2–4 players. Command a Mage, a Priest and six Warriors across an octagon board. Seize the MageStones, hold the Nexus, and outwit your rivals.', art: ArtOverview },
  { title: 'Your army', text: 'Each team lines up on its home edge: three Warriors, a Priest, a Mage, then three more Warriors. Your base tiles glow in your team colour.', art: ArtArmy },
  { title: 'Roll the dice', text: 'Begin your turn by rolling five dice — one Mage (blue), one Priest (green) and three Warrior (red). A die can only command a unit of its matching type.', art: ArtRoll },
  { title: 'Discard two', text: 'Discard two dice, keeping three for the turn. Pick the powers that suit your plan — speed, an attack, or a ritual.', art: ArtDiscard },
  { title: 'Move your units', text: 'Spend a die to move its matching unit along an orthogonal route that may bend, up to the die’s value, through empty squares. You may move up to three units a turn.', art: ArtMove },
  { title: 'Attack', text: 'End a move next to an enemy to strike. Warriors can gang up (2–3 dice summed); a Mage rolls its power die. The defender rolls 1d6 — higher total wins and the loser is removed. Ties are rerolled, and your odds are shown before you commit.', art: ArtAttack },
  { title: 'MageStones', text: 'Move your Mage onto a MageStone to collect it, then return to your base to activate them. Each tier upgrades the Mage’s attack die: d6 → d12 → d20.', art: ArtStones },
  { title: 'The Nexus & the Priest', text: 'The gilded 2×2 Nexus at the centre is sacred. A Priest who holds a clear Nexus until play returns to you wins by ritual. Priests can also raise a fallen Warrior from a gravestone.', art: ArtNexus },
  { title: 'How to win', text: 'Three roads to victory: activate six MageStones with your Mage on its base, complete a Nexus ritual, or be the last team with units on the board.', art: ArtVictory },
];

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const last = STEPS.length - 1;
  const next = () => setI((v) => Math.min(last, v + 1));
  const prev = () => setI((v) => Math.max(0, v - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI((v) => Math.min(STEPS.length - 1, v + 1));
      else if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const step = STEPS[i];
  const Art = step.art;
  return (
    <div className="tut-overlay" onClick={onClose}>
      <div className="tut-panel" role="dialog" aria-modal="true" aria-label="How to play" onClick={(e) => e.stopPropagation()}>
        <svg width="0" height="0" aria-hidden="true">
          <defs>
            <linearGradient id="tutGold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#eccb78" />
              <stop offset="1" stopColor="#a9842f" />
            </linearGradient>
          </defs>
        </svg>
        <header className="tut-head">
          <span className="tut-step">{i + 1} / {STEPS.length}</span>
          <h2 className="tut-title">{step.title}</h2>
          <button className="tut-close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="tut-stage">
          <Art />
        </div>
        <p className="tut-text">{step.text}</p>
        <div className="tut-dots">
          {STEPS.map((_, d) => (
            <button
              key={d}
              className={`tut-dot${d === i ? ' on' : ''}`}
              aria-label={`Step ${d + 1}`}
              onClick={() => setI(d)}
            />
          ))}
        </div>
        <footer className="tut-foot">
          <button className="ghost" onClick={prev} disabled={i === 0}>
            ← Back
          </button>
          {i < last ? (
            <button className="primary" onClick={next}>
              Next →
            </button>
          ) : (
            <button className="primary" onClick={onClose}>
              Got it!
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
