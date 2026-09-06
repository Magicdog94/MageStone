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

// Win chances taken straight from the engine's `combatOdds` (rules.ts). A TIE IS
// RE-ROLLED, so neither side is favoured and each cell is the decisive-outcome
// chance P(win | not draw), then Math.round(win × 100) — identical to the %
// badge shown in-game (Pieces.tsx). Note the diagonal: every even matchup is
// exactly 50%. Rows = the attacker's roll; columns = the defender's die (d6, or
// a defending Mage's power die).
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
            <span className="htp-win-title">MageStone Victory</span>
            Return your Mage to your own base holding 6 Activated MageStones — the moment it steps
            onto your base with six, you win instantly. Picking up a sixth already-Activated stone
            out on the board is <em>not</em> enough on its own: you still have to get home.
          </li>
          <li>
            <span className="htp-win-title">Priest Ritual Victory</span>
            Move your Priest onto the central Nexus and declare a ritual. If your Priest survives and still holds
            the Nexus for a full round, you win.
          </li>
          <li>
            <span className="htp-win-title">Conquest Victory</span>
            Be the last player standing. A fallen Mage or Priest normally respawns on its home
            square — if something stands there, it appears on the closest free square of the base
            instead. But while an <em>enemy</em> stands on any base square (a <em>siege</em>) they
            wait in a queue and only return once the base is clear again. A besieged player who
            runs out of units on the board is <em>eliminated</em>: they take no more turns and
            never respawn.
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
        <p className="htp-p">Each player commands 8 units:</p>
        <ul className="htp-list">
          <li>6 Warriors</li>
          <li>1 Priest</li>
          <li>1 Mage</li>
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
          The central area of the board contains the MageStone zone and the Nexus. The board is
          seeded with <span className="htp-em">4 MageStones per player</span> (8 in a 2-player
          game, 16 with four players), placed in the MageStone zone — never on the Nexus. Nobody
          owns them: any Mage may collect any stone.
        </p>
        <p className="htp-p">
          MageStone is played by <span className="htp-em">2 or 4 players</span> — there is no
          3-player game.
        </p>
        <p className="htp-p">
          The shared Gravestone bank starts at <span className="htp-em">4 Gravestones per player</span>{' '}
          (8 in a 2-player game, 16 with four players) and is never refilled.
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
        <p className="htp-p">
          There is <span className="htp-em">one shared set of five dice</span>. Whoever starts the
          round rolls them, and they serve everybody for that whole round — you then take turns{' '}
          <span className="htp-em">activating</span>, one die at a time, back and forth.
        </p>
        <ol className="htp-ol">
          <li>
            The player going first rolls <span className="htp-em">5 dice for the table</span>:
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
          <li>
            <span className="htp-em">Nothing is discarded.</span> All five stay on the table and
            visible to everyone — but each player may only ever spend{' '}
            <span className="htp-em">3 of the 5</span> in a round. Whatever you don’t use is simply
            ignored when the round ends.
          </li>
          <li>
            The dice are <span className="htp-em">shared, not divided</span>. You and your opponent
            may take the <span className="htp-em">same</span> die, or completely different ones —
            a die another player has already used is still yours to take. The only limits are your
            own three, and that you can’t take the same die twice yourself.
          </li>
          <li>
            Take one <span className="htp-em">activation</span>, then pass to your opponent:
            <ul className="htp-list htp-list--sub">
              <li>Choose 1 unused die.</li>
              <li>Move its matching unit up to the die’s value — orthogonal (never diagonal), through empty squares; the path may turn.</li>
              <li>
                Immediately resolve that unit’s action: attack (Warrior: Single, Double, Triple;
                Mage), collect or activate a MageStone, resurrect a Warrior, or start a Nexus
                Ritual.
              </li>
              <li>Play passes to the other player.</li>
            </ul>
          </li>
          <li>
            You alternate like that until both players have spent their 3 dice. Then the round ends
            and everyone rolls again — with the{' '}
            <span className="htp-em">starting player alternating</span> each round.
          </li>
        </ol>
        <h4 className="htp-sub">Spending the same colour together</h4>
        <p className="htp-p">
          The one exception to strict alternation: you may spend{' '}
          <span className="htp-em">2 or 3 unused dice of the same colour</span> in a single
          activation. All of their units move and resolve together — so two or three Warriors can
          march in and make a coordinated attack as one activation — and play only passes once the
          whole bundle is done.
        </p>
        <div className="htp-note">
          <strong>Important:</strong> the Mage die moves only your Mage and the Priest die only your
          Priest, so there is exactly one of each. The three Warrior dice are shared by all your
          Warriors — one die per Warrior. Spend three dice on Warriors and your Mage and Priest sit
          out the round entirely.
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
          <li>4 or more stones: rolls 1d20</li>
        </ul>
        <p className="htp-p">
          A defeated Mage drops all Unactivated stones plus exactly 1 Activated stone where it fell
          — and that dropped stone <span className="htp-em">stays Activated</span>. It keeps the
          rest and respawns at your base, unless an enemy is holding the base (see Conquest).
          Activated stones can also be SPENT on sorcery — see{' '}
          <span className="htp-em">Mage Powers</span>.
        </p>

        <h4 className="htp-sub htp-sub--p">Priest</h4>
        <p className="htp-p">Your support unit — it cannot attack.</p>
        <ul className="htp-list">
          <li>Resurrects Warriors from Gravestones and performs the Nexus Ritual.</li>
          <li>
            A Priest that wins its defence never kills its attacker — it simply repels the attack.
            Neither unit moves; a Priest that survives does not retreat.
          </li>
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
          Attacker and defender each roll their die — highest wins. Neither side has any
          advantage: a <span className="htp-em">tie is re-rolled</span> until the result is
          decisive, so an even fight is exactly 50:50. The loser is defeated, with one exception —
          a Priest that wins its defence only repels the attack, and neither unit moves.
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
            <strong>d12 / d20</strong> — a Mage with 2–3 / 4+ activated stones
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
          Your Mage collects a stone by landing on it. A stone taken from the board starts{' '}
          <span className="htp-em">Unactivated</span> (carried, silver): it adds no combat power and
          counts for nothing. Carry it back to your own base and{' '}
          <span className="htp-em">Activate</span> it (gold) — Activated stones drive the Mage’s
          power die and count toward MageStone Victory.
        </p>
        <h4 className="htp-sub">Activation is permanent</h4>
        <p className="htp-p">
          Once a stone has been Activated it can <span className="htp-em">never</span> become
          Unactivated again — not by being dropped, not when its Mage dies, not when it is spent on
          Bolt or Nova, and not when an enemy takes it. Any Mage that picks up an already-Activated
          stone counts it <span className="htp-em">immediately</span>, with no trip home required.
          As a game goes on, more and more of the stones lying on the board are live ammunition for
          whoever reaches them first.
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
            Bolt is <span className="htp-em">indefensible</span> — no defence roll is made, by a
            Mage or by anything else. Whatever it hits is defeated outright.
          </li>
          <li>
            The stone is not destroyed: it leaves your Mage and lands on the square that was hit,{' '}
            <span className="htp-em">still Activated</span>, ready for any Mage to claim.
          </li>
        </ul>
        <h4 className="htp-sub htp-sub--m">Nova — 4 Activated stones</h4>
        <ul className="htp-list">
          <li>
            Destroys every <span className="htp-em">enemy</span> unit in the 8 squares surrounding
            the Mage — diagonals included. No defence rolls are made, and friendly units are
            unharmed.
          </li>
          <li>
            The 4 spent stones are placed on the four <span className="htp-em">diagonal</span>{' '}
            squares around the Mage, all still Activated — and claimable by your opponents too.
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
          <li>
            The bank starts at 4 Gravestones per player — 8 in a 2-player game, 16 in a 4-player
            game — and is <span className="htp-em">never replenished</span>.
          </li>
          <li>A defeated Warrior takes one Gravestone out of the bank and leaves it on its square.</li>
          <li>
            Resurrecting removes that Gravestone from the game entirely. It does{' '}
            <span className="htp-em">not</span> return to the bank, so the bank only ever counts
            down: 16 → 15 → 14 → … → 0.
          </li>
          <li>
            When the bank reaches zero a defeated Warrior leaves nothing behind and can never be
            brought back. Armies decay, and killing becomes permanent.
          </li>
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
          The Nexus is the 2×2 heart of the board. A Priest standing on it may declare the{' '}
          <span className="htp-em">Rite of the Nexus</span>, and declaring it is that Priest’s
          action. To begin it — and to keep it — <span className="htp-em">all four Nexus squares</span>{' '}
          must be free of enemies; friendly units are welcome on the other three, and screening
          them is the usual way to hold one. While a Rite is running the Nexus glows in that
          player’s colour.
        </p>
        <p className="htp-p">
          Every other player then gets a complete turn. If the Rite is still standing when play
          returns to you, you win immediately. Because the starting player rotates each round, an
          opponent who activates before you next round gets one last chance to break it — a single
          enemy stepping anywhere into the circle is enough. It also breaks if the Priest is killed
          or leaves the Nexus.
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
        <li>The player going first rolls 5 shared dice — 3 Warrior (red), 1 Mage (blue), 1 Priest (green).</li>
        <li>Nothing is discarded; you may spend 3 of your 5 this round.</li>
        <li>Take turns activating: 1 die → move that unit → resolve its action → pass.</li>
        <li>Or spend 2–3 same-colour dice together as one activation.</li>
        <li>Fight, collect stones, activate stones, resurrect Warriors, or attempt the Nexus Ritual.</li>
        <li>When both players are done, the round ends and the starting player alternates.</li>
        <li>Win by MageStone Victory, Priest Ritual Victory, or Conquest Victory.</li>
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
