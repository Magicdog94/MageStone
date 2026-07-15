// "How to Play MageStone" — the full rules guide opened from the landing menu.
// It renders as a scrollable, page-like overlay: a gilded hero, an intro card,
// and one collapsible card per rules section (Objective, Setup, Turn Structure,
// Units, Combat, MageStones, Gravestones & Resurrection, The Nexus, Quick Play
// Summary). Sections are accordions — all open on desktop, collapsed-but-first
// on mobile — matched to the emerald + gold box-cover theme (no photo assets).
import { useEffect, useState, type ReactNode } from 'react';
import {
  BoardOverview,
  SetupDiagram,
  MoveDiagram,
  CombatDiagram,
  StoneDiagram,
  NexusDiagram,
} from './HowToDiagrams';

// ---- gold iconography -----------------------------------------------------

/** A 24×24 gold line-icon frame (colour comes from `currentColor`). */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function Icon({ name }: { name: string }) {
  switch (name) {
    case 'crown':
      return (
        <Glyph>
          <path d="M3 7l4 4 4.5-6 4.5 6 4-4-1.8 12H4.8L3 7z" />
          <path d="M4.8 20h14.4" />
        </Glyph>
      );
    case 'formation':
      return (
        <Glyph>
          <path d="M2 5h20" />
          <rect x="3.5" y="9" width="4" height="10" rx="1" />
          <rect x="10" y="9" width="4" height="10" rx="1" />
          <rect x="16.5" y="9" width="4" height="10" rx="1" />
        </Glyph>
      );
    case 'dice':
      return (
        <Glyph>
          <rect x="4" y="4" width="16" height="16" rx="3.5" />
          <circle cx="9" cy="9" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="15" cy="15" r="1.15" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case 'units':
      return (
        <Glyph>
          <circle cx="8" cy="8" r="2.4" />
          <path d="M3.5 19c0-3 2-4.8 4.5-4.8S12.5 16 12.5 19" />
          <circle cx="16.5" cy="9" r="2" />
          <path d="M13.5 19c0-2.4 1.5-4 3-4s3 1.6 3 4" />
        </Glyph>
      );
    case 'swords':
      return (
        <Glyph>
          <path d="M4 4l8.5 8.5" />
          <path d="M14 14l3 3-1.5 1.5-3-3" />
          <path d="M20 4l-8.5 8.5" />
          <path d="M10 14l-3 3 1.5 1.5 3-3" />
        </Glyph>
      );
    case 'gem':
      return (
        <Glyph>
          <path d="M6 4h12l3 5-9 11L3 9z" />
          <path d="M3 9h18" />
          <path d="M9 4l3 16 3-16" />
        </Glyph>
      );
    case 'grave':
      return (
        <Glyph>
          <path d="M6.5 21V10.5a5.5 5.5 0 0111 0V21z" />
          <path d="M12 8.5v5" />
          <path d="M9.5 11h5" />
          <path d="M4.5 21h15" />
        </Glyph>
      );
    case 'nexus':
      return (
        <Glyph>
          <path d="M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4z" />
          <circle cx="12" cy="12" r="2" />
        </Glyph>
      );
    case 'scroll':
      return (
        <Glyph>
          <path d="M7 4h9a2 2 0 012 2v10a3 3 0 01-3 3H8a3 3 0 01-3-3V6" />
          <path d="M8.5 8.5h6M8.5 12h6M8.5 15.5h3.5" />
        </Glyph>
      );
    default:
      return null;
  }
}

/** Chevron that flips when its section is open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`htp-chev${open ? ' open' : ''}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** A gilt fantasy divider — a rule with a centred diamond. */
function Divider() {
  return (
    <div className="htp-divider" aria-hidden="true">
      <span className="htp-divider-line" />
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" />
      </svg>
      <span className="htp-divider-line" />
    </div>
  );
}

// Win chances taken straight from the engine's `combatOdds` (rules.ts): draws are
// re-rolled, so each is the decisive-outcome chance P(win | not draw), then
// Math.round(win × 100) — identical to the % badge shown in-game (Pieces.tsx).
// Rows = the attacker's roll; columns = the defender's die (d6, or a defending
// Mage's power die). Regenerate with scratchpad/odds.mjs if the combat maths change.
const ODDS: { roll: string; vs: [number, number, number] }[] = [
  { roll: 'd6', vs: [50, 23, 13] },
  { roll: '2d6', vs: [90, 55, 32] },
  { roll: '3d6', vs: [99, 81, 50] },
  { roll: 'd12', vs: [77, 50, 29] },
  { roll: 'd20', vs: [87, 71, 50] },
];
const oddsBand = (v: number) => (v >= 67 ? 'hi' : v >= 34 ? 'mid' : 'lo');

export function OddsTable() {
  return (
    <div className="htp-table-wrap">
      <table className="htp-table">
        <thead>
          <tr>
            <td className="htp-th-corner" rowSpan={2}>
              Attacker ↓
            </td>
            <th colSpan={3} scope="colgroup">
              Defender rolls →
            </th>
          </tr>
          <tr>
            <th scope="col">d6</th>
            <th scope="col">d12</th>
            <th scope="col">d20</th>
          </tr>
        </thead>
        <tbody>
          {ODDS.map(({ roll, vs }) => (
            <tr key={roll}>
              <th scope="row">{roll}</th>
              {vs.map((v, i) => (
                <td key={i} className={`htp-odds htp-odds--${oddsBand(v)}`}>
                  {v}%
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- rules content --------------------------------------------------------

interface Section {
  id: string;
  title: string;
  icon: string;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'objective',
    title: 'Objective',
    icon: 'crown',
    body: (
      <>
        <p className="htp-p">There are three ways to win MageStone:</p>
        <ol className="htp-win">
          <li>
            <span className="htp-win-title">Mage Victory</span>
            Return your Mage to your base carrying 6 or more Activated MageStones — the moment it steps onto
            your base with at least 6, you win instantly.
          </li>
          <li>
            <span className="htp-win-title">Priest Ritual Victory</span>
            Move your Priest onto the central Nexus and declare a ritual. If your Priest survives and still holds
            the Nexus for a full round, you win.
          </li>
          <li>
            <span className="htp-win-title">Conquest Victory</span>
            Be the last player standing. Lay siege to enemy bases — a besieged base can’t respawn its Mage or
            Priest — and a besieged player who runs out of units on the board is <em>eliminated</em>: they take no
            more turns and never respawn.
          </li>
        </ol>
        <BoardOverview />
      </>
    ),
  },
  {
    id: 'setup',
    title: 'Setup',
    icon: 'formation',
    body: (
      <>
        <p className="htp-p">Each player starts with:</p>
        <ul className="htp-list">
          <li>6 Warriors</li>
          <li>1 Priest</li>
          <li>1 Mage</li>
          <li>4 MageStones</li>
          <li>3 Gravestones (added to the shared bank)</li>
        </ul>
        <p className="htp-p">Each player sets up their units on their own base row in this order:</p>
        <div className="htp-formation">
          <span className="htp-tag htp-tag--w">Warrior</span>
          <span className="htp-tag htp-tag--w">Warrior</span>
          <span className="htp-tag htp-tag--w">Warrior</span>
          <span className="htp-tag htp-tag--p">Priest</span>
          <span className="htp-tag htp-tag--m">Mage</span>
          <span className="htp-tag htp-tag--w">Warrior</span>
          <span className="htp-tag htp-tag--w">Warrior</span>
          <span className="htp-tag htp-tag--w">Warrior</span>
        </div>
        <p className="htp-p">
          The central area of the board contains the MageStone zone and the Nexus. MageStones are placed into the
          MageStone zone according to the player count.
        </p>
        <SetupDiagram />
      </>
    ),
  },
  {
    id: 'turn',
    title: 'Turn Structure',
    icon: 'dice',
    body: (
      <>
        <p className="htp-p">On your turn:</p>
        <ol className="htp-ol">
          <li>
            Roll 5 dice:
            <ul className="htp-list htp-list--sub htp-list--dice">
              <li>
                <span className="htp-die htp-die--w" />3 Warrior dice (Red)
              </li>
              <li>
                <span className="htp-die htp-die--m" />1 Mage die (Blue)
              </li>
              <li>
                <span className="htp-die htp-die--p" />1 Priest die (Green)
              </li>
            </ul>
          </li>
          <li>Discard exactly 2 dice.</li>
          <li>
            Move up to 3 units — one die per unit, up to the die’s value.
            <ul className="htp-list htp-list--sub">
              <li>Movement is orthogonal (never diagonal), through empty squares. The path may turn.</li>
              <li>A die only moves its matching unit type.</li>
            </ul>
          </li>
          <li>
            After moving, resolve actions:
            <ul className="htp-list htp-list--sub">
              <li>Attack (Warrior: Single, Double, Triple; Mage)</li>
              <li>Collect or Activate a MageStone (Mage)</li>
              <li>Resurrect a Warrior (Priest)</li>
              <li>Start a Nexus Ritual (Priest)</li>
            </ul>
          </li>
        </ol>
        <div className="htp-note">
          <strong>Important:</strong> Discard a unit’s die and that unit cannot move this turn.
        </div>
        <MoveDiagram />
      </>
    ),
  },
  {
    id: 'units',
    title: 'Units',
    icon: 'units',
    body: (
      <>
        <h4 className="htp-sub htp-sub--w">Warrior</h4>
        <p className="htp-p">Your main fighters.</p>
        <ul className="htp-list">
          <li>Attacks adjacent enemies with 1d6 — or coordinates with other Warriors (see Combat).</li>
          <li>Defeated Warriors leave a Gravestone.</li>
          <li>You can never have more than 6 live Warriors.</li>
        </ul>

        <h4 className="htp-sub htp-sub--m">Mage</h4>
        <p className="htp-p">
          Your victory carrier — it grows stronger with Activated MageStones:
        </p>
        <ul className="htp-list">
          <li>0–1 stones: rolls 1d6</li>
          <li>2–3 stones: rolls 1d12</li>
          <li>4–5 stones: rolls 1d20</li>
        </ul>
        <p className="htp-p">
          A defeated Mage drops all Unactivated stones plus 1 Activated stone where it fell, then
          respawns at your base — unless an enemy is holding the base (see Conquest). Activated
          stones can also be SPENT on sorcery — see <span className="htp-em">Mage Powers</span>.
        </p>

        <h4 className="htp-sub htp-sub--p">Priest</h4>
        <p className="htp-p">Your support unit — it cannot attack.</p>
        <ul className="htp-list">
          <li>Resurrects Warriors from Gravestones and performs the Nexus Ritual.</li>
          <li>A Priest that wins its defence only repels the attack — the attacker survives.</li>
          <li>If defeated, it respawns at your base (no Gravestone).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'combat',
    title: 'Combat',
    icon: 'swords',
    body: (
      <>
        <p className="htp-p">
          Attacker and defender each roll their die — highest wins. Ties are re-rolled, so combat
          never ends in a draw. The loser is defeated, with one exception: a Priest that wins its
          defence only repels the attack (the attacker survives).
        </p>

        <h4 className="htp-sub">Coordinated Warrior Attacks</h4>
        <p className="htp-p">
          Two or three Warriors adjacent to one target can strike together, rolling 2d6 or 3d6 and
          adding the dice. If the attack fails, only one Warrior falls.
        </p>

        <h4 className="htp-sub">Win Chance</h4>
        <p className="htp-p">
          Your roll (row) against the defender’s die (column) — the defender rolls d6 unless it’s a
          Mage using its power die. These are exactly the odds shown in-game.
        </p>
        <OddsTable />
        <ul className="htp-list htp-legend">
          <li>
            <strong>d6</strong> — one Warrior, or a Mage carrying 0–1 activated stones
          </li>
          <li>
            <strong>2d6 / 3d6</strong> — two / three coordinated Warriors
          </li>
          <li>
            <strong>d12 / d20</strong> — a Mage with 2–3 / 4–5 activated stones
          </li>
        </ul>
        <CombatDiagram />
      </>
    ),
  },
  {
    id: 'magestones',
    title: 'MageStones',
    icon: 'gem',
    body: (
      <>
        <p className="htp-p">
          Your Mage collects a stone by landing on it — the stone is then{' '}
          <span className="htp-em">Unactivated</span> (carried, silver). Back on your own base the
          Mage can <span className="htp-em">Activate</span> its stones (gold) — these power its
          attack die and count toward Mage Victory (6 Activated on your base wins instantly).
        </p>
        <StoneDiagram />
      </>
    ),
  },
  {
    id: 'powers',
    title: 'Mage Powers',
    icon: 'gem',
    body: (
      <>
        <p className="htp-p">
          Activated MageStones can be spent as sorcery. Spent stones stay ACTIVATED but leave the
          Mage and land back on the board for anyone to claim — and spending them lowers the
          Mage’s power die.
        </p>
        <h4 className="htp-sub htp-sub--m">Bolt — 1 Activated stone</h4>
        <ul className="htp-list">
          <li>
            A ranged strike on any enemy within range — range equals the mage die’s roll for that
            action (whether or not the Mage moved with it).
          </li>
          <li>
            Only an enemy <span className="htp-em">Mage</span> can repel it: both Mages roll their
            power dice, highest wins (ties re-roll). Every other unit is destroyed outright.
          </li>
          <li>The spent stone lands on the target’s square, still activated.</li>
        </ul>
        <h4 className="htp-sub htp-sub--m">Nova — 3 Activated stones</h4>
        <ul className="htp-list">
          <li>
            Destroys <span className="htp-em">every</span> unit within 1 square of the Mage —
            diagonals included, friend or foe. Nothing can repel it.
          </li>
          <li>
            The 3 spent stones scatter to random squares of the 3×3 blast area, still activated.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'graves',
    title: 'Gravestones & Resurrection',
    icon: 'grave',
    body: (
      <>
        <p className="htp-p">
          When a Warrior is defeated it leaves a Gravestone on its square. Gravestones are drawn from a shared
          bank, and a Priest can resurrect a Warrior from <span className="htp-em">any</span> Gravestone —
          regardless of whose Warrior fell there.
        </p>
        <h4 className="htp-sub">The Gravestone bank</h4>
        <ul className="htp-list">
          <li>The bank holds 3 Gravestones per player — 6 in a 2-player game, 12 in a 4-player game.</li>
          <li>Placing a Gravestone draws one from the bank; resurrecting a Warrior returns one to it.</li>
          <li>When the bank is empty, a defeated Warrior leaves no Gravestone — the bank caps how many can sit on the board at once.</li>
          <li>The bank shrinks by 3 for each player eliminated (down to 3 per remaining player).</li>
        </ul>
        <h4 className="htp-sub">Placement &amp; resurrection</h4>
        <ul className="htp-list">
          <li>Only one Gravestone can be resurrected per turn.</li>
          <li>You can never have more than 6 live Warriors.</li>
          <li>Gravestones can’t stack — one per square — and none can be placed on the Nexus.</li>
          <li>A Gravestone and a MageStone may share a square.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'nexus',
    title: 'The Nexus',
    icon: 'nexus',
    body: (
      <>
        <p className="htp-p">
          The Nexus is the 2×2 heart of the board. A Priest standing on it — with no enemies on
          its four squares — may declare a ritual. Hold the Nexus for one full round and you win.
          Killing the Priest, or any enemy stepping into the Nexus, breaks the ritual.
        </p>
        <NexusDiagram />
      </>
    ),
  },
  {
    id: 'summary',
    title: 'Quick Play Summary',
    icon: 'scroll',
    body: (
      <ol className="htp-ol">
        <li>Roll 5 dice — 3 Warrior (red), 1 Mage (blue), 1 Priest (green).</li>
        <li>Discard exactly 2 dice.</li>
        <li>Move up to 3 units using the remaining dice.</li>
        <li>Resolve actions after movement.</li>
        <li>Fight, collect stones, activate stones, resurrect Warriors, or attempt the Nexus Ritual.</li>
        <li>Win by Mage Victory, Priest Ritual Victory, or Conquest Victory.</li>
      </ol>
    ),
  },
];

// ---- page -----------------------------------------------------------------

export function Tutorial({ onClose }: { onClose: () => void }) {
  // Every section starts CLOSED — the book opens as a tidy contents view, and
  // the sticky contents bar jumps straight to (and opens) any chapter.
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map((s) => [s.id, false])),
  );
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const jumpTo = (id: string) => {
    setOpen((o) => ({ ...o, [id]: true }));
    // scroll after the section body has expanded; explicit math so the target
    // lands BELOW the sticky contents bar, not underneath it
    window.setTimeout(() => {
      const ov = document.querySelector('.htp-overlay');
      const el = document.getElementById(`htp-sec-${id}`);
      if (!ov || !el) return;
      const tocH = document.querySelector('.htp-toc')?.getBoundingClientRect().height ?? 0;
      const top = el.getBoundingClientRect().top - ov.getBoundingClientRect().top + ov.scrollTop;
      ov.scrollTo({ top: Math.max(0, top - tocH - 20), behavior: 'smooth' });
    }, 60);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="htp-overlay" onClick={onClose}>
      <div
        className="htp-panel"
        role="dialog"
        aria-modal="true"
        aria-label="MageStone Rule Book"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="htp-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <header className="htp-hero">
          <div className="htp-eyebrow">Fantasy Strategy · 2–4 Players</div>
          <h1 className="htp-hero-title">MageStone Rule Book</h1>
          <Divider />
        </header>

        {/* sticky contents — jump to (and open) any chapter from anywhere */}
        <nav className="htp-toc" aria-label="Contents">
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => jumpTo(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>

        <div className="htp-intro">
          <p className="htp-lead">
            Command Warriors, protect your Mage, control the Nexus, and claim the MageStones.
          </p>
        </div>

        <div className="htp-sections">
          {SECTIONS.map((s) => {
            const isOpen = !!open[s.id];
            return (
              <section className={`htp-section${isOpen ? ' open' : ''}`} key={s.id} id={`htp-sec-${s.id}`}>
                <button
                  className="htp-section-head"
                  aria-expanded={isOpen}
                  aria-controls={`htp-body-${s.id}`}
                  onClick={() => toggle(s.id)}
                >
                  <span className="htp-section-icon">
                    <Icon name={s.icon} />
                  </span>
                  <span className="htp-section-title">{s.title}</span>
                  <Chevron open={isOpen} />
                </button>
                <div className="htp-section-body" id={`htp-body-${s.id}`} hidden={!isOpen}>
                  {s.body}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="htp-foot">
          <button className="primary lg" onClick={onClose}>
            Got it!
          </button>
        </footer>
      </div>
    </div>
  );
}
