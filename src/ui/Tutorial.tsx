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
            Move up to 3 units using the remaining dice.
            <ul className="htp-list htp-list--sub">
              <li>Each die can move one unit.</li>
              <li>Movement is orthogonal only.</li>
              <li>Units move up, down, left, or right.</li>
              <li>Units cannot move diagonally.</li>
            </ul>
          </li>
          <li>Complete all movement first.</li>
          <li>
            Then resolve actions:
            <ul className="htp-list htp-list--sub">
              <li>Attack (Warrior: Single, Double, Triple; Mage)</li>
              <li>Collect a MageStone (Mage)</li>
              <li>Activate a MageStone (Mage)</li>
              <li>Resurrect a Warrior (Priest)</li>
              <li>Start a Nexus Ritual (Priest)</li>
            </ul>
          </li>
        </ol>
        <div className="htp-note">
          <strong>Important:</strong> If you discard the Mage die, your Mage cannot move that turn.
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
        <p className="htp-p">Warriors are your main fighting units.</p>
        <ul className="htp-list">
          <li>Warriors attack using 1d6.</li>
          <li>Warriors can attack enemy units.</li>
          <li>Warriors can make coordinated attacks with other Warriors.</li>
          <li>If a Warrior is defeated, it becomes a Gravestone.</li>
          <li>You can never have more than 6 live Warriors.</li>
        </ul>

        <h4 className="htp-sub htp-sub--m">Mage</h4>
        <p className="htp-p">
          The Mage is your most important unit. It becomes stronger as it carries MageStones:
        </p>
        <ul className="htp-list">
          <li>0–1 MageStones: rolls 1d6</li>
          <li>2–3 MageStones: rolls 1d12</li>
          <li>4–5 MageStones: rolls 1d20</li>
        </ul>
        <p className="htp-p">If the Mage is defeated:</p>
        <ul className="htp-list">
          <li>It respawns at your base if possible.</li>
          <li>It drops all Unactivated MageStones.</li>
          <li>It also drops 1 Activated MageStone on the death square.</li>
          <li>If the enemy has locked your base, your Mage may be unable to respawn.</li>
        </ul>

        <h4 className="htp-sub htp-sub--p">Priest</h4>
        <p className="htp-p">The Priest is a defensive and ritual unit.</p>
        <ul className="htp-list">
          <li>The Priest cannot attack.</li>
          <li>When attacked, the Priest rolls defence only.</li>
          <li>If the Priest wins the defence roll, the attack is repelled — but the attacker is not defeated.</li>
          <li>If the Priest is defeated, it respawns instead of becoming a Gravestone.</li>
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
        <p className="htp-p">Combat is resolved by opposed dice rolls.</p>
        <ul className="htp-list">
          <li>The attacker rolls their attack die.</li>
          <li>The defender rolls their defence die.</li>
          <li>Highest roll wins.</li>
          <li>Ties are re-rolled until the result is decisive — combat never ends in a draw.</li>
        </ul>
        <p className="htp-p">
          <span className="htp-em">If the attacker wins:</span> the defender is defeated.
        </p>
        <p className="htp-p">
          <span className="htp-em">If the defender wins:</span> the attacker is defeated — unless the defender is a
          Priest. A Priest never kills the attacker; the attack is simply repelled and both units stay put.
        </p>

        <h4 className="htp-sub">Coordinated Warrior Attacks</h4>
        <p className="htp-p">Two or three Warriors can combine their attack against one target.</p>
        <ul className="htp-list">
          <li>2 Warriors attack together by rolling 2d6.</li>
          <li>3 Warriors attack together by rolling 3d6.</li>
          <li>Add the dice together.</li>
          <li>Compare the total against the defender’s roll.</li>
        </ul>
        <p className="htp-p">If a coordinated attack fails, only one attacking Warrior is defeated.</p>

        <h4 className="htp-sub">Win Chance</h4>
        <p className="htp-p">
          Your chance to win an attack — your roll (row) against the defender’s die (column). The defender rolls d6,
          unless it’s a Mage defending with its power die. Ties are re-rolled, so these are exactly the odds shown
          in-game.
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
        <p className="htp-p">MageStones are collected from the MageStone zone. There are two MageStone states:</p>
        <ol className="htp-win">
          <li>
            <span className="htp-win-title">Unactivated MageStones</span>
            Carried, but not yet ready for victory.
          </li>
          <li>
            <span className="htp-win-title">Activated MageStones</span>
            These count toward Mage Victory.
          </li>
        </ol>
        <p className="htp-p">
          To win by Mage Victory, your Mage must return to your base with 6 or more Activated MageStones — the
          win is instant the moment it arrives.
        </p>
        <StoneDiagram />
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
          The Nexus is the central power point of the board. A Priest can move onto the Nexus and declare a ritual.
        </p>
        <h4 className="htp-sub">To win by Priest Ritual Victory</h4>
        <ul className="htp-list">
          <li>Your Priest must stand on the Nexus.</li>
          <li>You declare the ritual.</li>
          <li>Your Priest must remain there for a full round.</li>
          <li>If the Priest survives and still controls the Nexus, you win.</li>
        </ul>
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

const isMobile = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;

export function Tutorial({ onClose }: { onClose: () => void }) {
  // All sections open on desktop; only the first open on mobile so the guide
  // doesn't start as one long scroll.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const mobile = isMobile();
    return Object.fromEntries(SECTIONS.map((s, i) => [s.id, mobile ? i === 0 : true]));
  });
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

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

        <div className="htp-intro">
          <p className="htp-lead">
            Command Warriors, protect your Mage, control the Nexus, and claim the MageStones.
          </p>
          <p className="htp-p">
            MageStone is a fantasy strategy board game for 2–4 players. Each player controls a small force of
            Warriors, one Mage, and one Priest. Your aim is to gather MageStones, control the Nexus, defeat enemy
            units, and win through one of three victory paths.
          </p>
        </div>

        <div className="htp-sections">
          {SECTIONS.map((s) => {
            const isOpen = !!open[s.id];
            return (
              <section className={`htp-section${isOpen ? ' open' : ''}`} key={s.id}>
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
