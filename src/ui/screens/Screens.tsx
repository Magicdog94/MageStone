// Pre-game entry flow: landing → sign in/up → lobby (create or join a game).
import { useEffect, useState, type FormEvent } from 'react';
import { eloTier, useNet, type LbRow } from '../../net/useNet';
import { useGame } from '../../store';
import { BOT_LABEL, BOT_LEVELS } from '../../game/bot';
import { COLORS } from '../../three/coords';
import { KNOWN_ISSUES, PATCH_NOTES, UPDATED, VERSION } from '../../version';
import { Tutorial } from '../Tutorial';
import { Modals } from '../Modals';
import { FeedbackModal } from '../FeedbackModal';
import { Modal } from '../controls';

/** A hooded mage casting toward the centre. Rendered as a glowing silhouette so
 *  it reads at any size; `flip` mirrors it for the opposing (right-hand) side. */
function Mage({ color, glow, flip }: { color: string; glow: string; flip?: boolean }) {
  return (
    <g transform={flip ? 'scale(-1,1)' : undefined}>
      {/* cloak + hood silhouette */}
      <path
        d="M0,0 C-16,2 -26,16 -26,36 C-30,40 -36,46 -40,70 C-52,120 -54,205 -66,278
           L66,278 C54,205 52,120 40,70 C36,46 30,40 26,36 C26,16 16,2 0,0 Z"
        fill="#0a1712"
        stroke={color}
        strokeWidth="2"
        strokeOpacity="0.7"
      />
      {/* rim light down the leading edge */}
      <path
        d="M0,2 C-14,4 -23,17 -23,36 C-27,42 -33,48 -37,72 C-48,122 -50,205 -61,276"
        fill="none"
        stroke={glow}
        strokeWidth="2.5"
        strokeOpacity="0.85"
        filter="url(#em-soft)"
      />
      {/* shadowed face within the hood + glowing eyes */}
      <ellipse cx="2" cy="26" rx="13" ry="16" fill="#04100b" />
      <circle cx="-2" cy="24" r="2.1" fill={glow} filter="url(#em-soft)" />
      <circle cx="6" cy="24" r="2.1" fill={glow} filter="url(#em-soft)" />
      {/* staff with a glowing orb, raised on the outer side */}
      <line x1="-30" y1="250" x2="-70" y2="20" stroke="#1c130a" strokeWidth="7" strokeLinecap="round" />
      <line x1="-30" y1="250" x2="-70" y2="20" stroke="#c9a24a" strokeWidth="2.4" strokeLinecap="round" strokeOpacity="0.8" />
      <circle cx="-71" cy="14" r="12" fill={glow} filter="url(#em-glow)" />
      <circle cx="-71" cy="14" r="5.5" fill="#ffffff" />
      {/* outstretched casting hand toward centre */}
      <path d="M22,96 C44,90 70,92 96,104 C72,104 50,108 30,116 Z" fill="#0a1712" stroke={color} strokeWidth="1.5" strokeOpacity="0.7" />
      <circle cx="98" cy="104" r="7" fill={glow} filter="url(#em-glow)" />
    </g>
  );
}

// The cover art at app/public/cover-art.(webp|png|jpg) is the entry backdrop;
// each source is tried in turn, and only if none load do we fall back to the SVG
// art (so the SVG never flashes underneath while the real image is loading).
// Bump COVER_VER whenever the cover image changes — the filename stays the same,
// so the version query is what stops browsers serving a stale cached copy.
const COVER_VER = 3;
const COVER_SRCS = ['/cover-art.webp', '/cover-art.png', '/cover-art.jpg'].map((s) => `${s}?v=${COVER_VER}`);
function EntryPhoto() {
  const [idx, setIdx] = useState(0);
  if (idx >= COVER_SRCS.length) return <EntryArt />;
  return (
    <div className="entry-photo-wrap" aria-hidden="true">
      <img className="entry-photo" src={COVER_SRCS[idx]} alt="" onError={() => setIdx((i) => i + 1)} />
    </div>
  );
}

/** Full-bleed dueling-mages backdrop for the entry screens: a torch-lit castle
 *  silhouette, two mages (blue vs red) and an arcane clash between their spells —
 *  recreating the box cover as live SVG art (fallback when no cover-art.png). */
function EntryArt() {
  const bolt = (from: [number, number]) =>
    `M${from[0]},${from[1]} C ${(from[0] + 600) / 2},${from[1] - 40} ${(from[0] + 600) / 2 + (from[0] < 600 ? 40 : -40)},250 600,300`;
  return (
    <svg className="entry-art" viewBox="0 0 1200 820" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="em-sky" cx="50%" cy="34%" r="75%">
          <stop offset="0%" stopColor="#1d4e37" />
          <stop offset="45%" stopColor="#0f2a1d" />
          <stop offset="100%" stopColor="#050b07" />
        </radialGradient>
        <radialGradient id="em-blue" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#dff0ff" />
          <stop offset="40%" stopColor="#4aa3ff" />
          <stop offset="100%" stopColor="rgba(74,163,255,0)" />
        </radialGradient>
        <radialGradient id="em-red" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe6df" />
          <stop offset="40%" stopColor="#ff5a4d" />
          <stop offset="100%" stopColor="rgba(255,90,77,0)" />
        </radialGradient>
        <radialGradient id="em-clash" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="30%" stopColor="#f6e4ab" />
          <stop offset="65%" stopColor="#b07fe6" />
          <stop offset="100%" stopColor="rgba(120,80,200,0)" />
        </radialGradient>
        <filter id="em-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <filter id="em-glow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <rect x="0" y="0" width="1200" height="820" fill="url(#em-sky)" />

      {/* arcane sigil ring behind the duel */}
      <circle cx="600" cy="300" r="210" fill="none" stroke="#c9a24a" strokeWidth="1.2" strokeOpacity="0.18" />
      <circle cx="600" cy="300" r="150" fill="none" stroke="#c9a24a" strokeWidth="1" strokeOpacity="0.12" />

      {/* distant castle silhouette along the base */}
      <path
        className="entry-castle"
        d="M0,820 L0,640 L60,640 L60,600 L150,600 L150,540 L175,510 L200,540 L200,600 L320,600 L320,560 L340,560 L340,540 L360,540 L360,560 L380,560 L380,640 L520,640 L520,470 L545,440 L570,470 L570,640 L720,640
           L720,560 L740,540 L760,560 L760,640 L860,640 L860,600 L880,600 L880,560 L905,530 L930,560 L930,600 L1020,600 L1020,640 L1080,640 L1080,600 L1140,600 L1140,640 L1200,640 L1200,820 Z"
        fill="#040a07"
      />

      {/* energy bolts converging on the clash */}
      <path d={bolt([129, 314])} fill="none" stroke="#4aa3ff" strokeWidth="9" strokeOpacity="0.5" filter="url(#em-glow)" />
      <path d={bolt([129, 314])} fill="none" stroke="#dff0ff" strokeWidth="2.6" className="entry-bolt" />
      <path d={bolt([1071, 314])} fill="none" stroke="#ff5a4d" strokeWidth="9" strokeOpacity="0.5" filter="url(#em-glow)" />
      <path d={bolt([1071, 314])} fill="none" stroke="#ffe6df" strokeWidth="2.6" className="entry-bolt" />

      {/* the mages */}
      <g transform="translate(200,470)">
        <Mage color="#2f6db0" glow="#7cc0ff" />
      </g>
      <g transform="translate(1000,470)">
        <Mage color="#b0392f" glow="#ff8a7a" flip />
      </g>

      {/* the clash burst */}
      <g className="entry-clash">
        <circle cx="600" cy="300" r="120" fill="url(#em-clash)" opacity="0.85" />
        <circle cx="600" cy="300" r="46" fill="#ffffff" filter="url(#em-glow)" />
      </g>
    </svg>
  );
}

/** Gilt compass-star emblem from the box cover: six leaf petals around a ringed
 *  four-point compass star. */
function StarEmblem() {
  const petals = [0, 60, 120, 180, 240, 300];
  return (
    <svg className="star-emblem" viewBox="-50 -50 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="emGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6e4ab" />
          <stop offset="0.5" stopColor="#cfa64e" />
          <stop offset="1" stopColor="#8a6a22" />
        </linearGradient>
      </defs>
      {petals.map((a) => (
        <path
          key={a}
          transform={`rotate(${a})`}
          d="M0 -44 C 7 -26, 7 -14, 0 -8 C -7 -14, -7 -26, 0 -44 Z"
          fill="url(#emGold)"
          stroke="#6e521a"
          strokeWidth="0.6"
        />
      ))}
      <circle r="13" fill="none" stroke="url(#emGold)" strokeWidth="2.6" />
      <path
        d="M0 -12 L2.6 -2.6 L12 0 L2.6 2.6 L0 12 L-2.6 2.6 L-12 0 L-2.6 -2.6 Z"
        fill="url(#emGold)"
      />
    </svg>
  );
}

/** The shared game modals, but only the Settings one is allowed to show on the
 *  entry screens (the default New Game modal is in-game only). */
function EntryModals() {
  const modal = useGame((s) => s.modal);
  return modal === 'settings' ? <Modals /> : null;
}

function Shell({ children, bare = false }: { children: React.ReactNode; bare?: boolean }) {
  const status = useNet((s) => s.status);
  const notice = useNet((s) => s.notice);
  const noticeEl = notice ? <div className="entry-notice">{notice}</div> : null;
  // The server status now lives inside the Settings panel; the sign-in / lobby
  // screens still show it inline, but the landing menu stays clean.
  const statusEl = <div className="entry-status">server: {status === 'online' ? 'connected' : status}</div>;
  return (
    <div className={`entry${bare ? ' entry--cover' : ''}`}>
      <EntryPhoto />
      <div className="entry-bg" />
      <EntryModals />
      {bare ? (
        // Cover mode (landing): the box-front art *is* the page — the title and
        // emblem come from the artwork, so we only float the controls onto it.
        <div className="entry-cover">
          <div className="entry-cover-controls">
            {children}
            {noticeEl}
          </div>
          {/* trust footer (Feedback etc.) on EVERY entry screen. It must live
              INSIDE this stacking context — as a sibling of .entry-cover (z:1)
              its z:4 would paint over the Rule Book overlay trapped in here. */}
          <LandingFooter />
        </div>
      ) : (
        <div className="entry-inner">
          <StarEmblem />
          <div className="entry-title">MageStone</div>
          {children}
          {noticeEl}
          {statusEl}
          <LandingFooter />
        </div>
      )}
    </div>
  );
}

/** Win/loss leaderboard, opened from the main-menu "Leaderboard" button. Public
 *  top-10; the signed-in user's own row is highlighted (and appended if they're
 *  outside the top). Results are recorded server-side for every finished online
 *  game — versus real players AND bots. */
/** Small coloured pill naming an ELO tier (Bronze → Grandmaster). */
function TierBadge({ elo }: { elo: number }) {
  const tier = eloTier(elo);
  return <span className={`tier-badge tier-${tier.toLowerCase()}`}>{tier}</span>;
}

function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const status = useNet((s) => s.status);
  const username = useNet((s) => s.username);
  const leaderboard = useNet((s) => s.leaderboard);
  const fetchLeaderboard = useNet((s) => s.fetchLeaderboard);
  const [tab, setTab] = useState<'stats' | 'elo'>('stats');
  // (Re)fetch on open and whenever the connection or login changes, so the
  // "you" row fills in once a saved session re-authenticates.
  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard, status, username]);

  const rows = leaderboard?.top ?? [];
  const eloRows = leaderboard?.eloTop ?? [];
  const me = leaderboard?.me ?? null;
  const meInTop = !!me && rows.some((r) => r.username === me.username);
  const meInElo = !!me && eloRows.some((r) => r.username === me.username);
  const pct = (r: LbRow) => (r.played ? Math.round((r.won / r.played) * 100) : 0);
  const players = leaderboard?.players ?? 0;
  const signups = leaderboard?.signups ?? 0;

  return (
    <Modal
      title="Leaderboard"
      onClose={onClose}
      footer={
        <button className="primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="segmented lb-tabs">
        <button className={`seg ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          Matches
        </button>
        <button className={`seg ${tab === 'elo' ? 'active' : ''}`} onClick={() => setTab('elo')}>
          ELO Rankings
        </button>
      </div>

      {tab === 'stats' ? (
        rows.length === 0 ? (
          <div className="lb-empty">
            {status === 'online'
              ? 'No games recorded yet — win an online match (or beat a bot) to get on the board.'
              : status === 'connecting'
                ? 'Connecting…'
                : 'Offline — cannot reach the server.'}
          </div>
        ) : (
          <table className="lb-table">
            <thead>
              <tr>
                <th className="lb-rank">#</th>
                <th className="lb-col-name">Player</th>
                <th title="Played">P</th>
                <th title="Won">W</th>
                <th title="Lost">L</th>
                <th title="Win rate">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.username} className={username && r.username === username ? 'lb-me' : ''}>
                  <td className="lb-rank">{i + 1}</td>
                  <td className="lb-col-name">{r.username}</td>
                  <td>{r.played}</td>
                  <td>{r.won}</td>
                  <td>{r.lost}</td>
                  <td>{pct(r)}%</td>
                </tr>
              ))}
              {me && !meInTop && (
                <tr className="lb-me lb-me-extra">
                  <td className="lb-rank">·</td>
                  <td className="lb-col-name">{me.username}</td>
                  <td>{me.played}</td>
                  <td>{me.won}</td>
                  <td>{me.lost}</td>
                  <td>{pct(me)}%</td>
                </tr>
              )}
            </tbody>
          </table>
        )
      ) : (
        <>
          {eloRows.length === 0 && me?.elo == null ? (
            <div className="lb-empty">
              {status === 'online'
                ? 'No ELO ratings yet — win a Ranked match to claim the first one. Ratings only move in Ranked play against a real opponent.'
                : status === 'connecting'
                  ? 'Connecting…'
                  : 'Offline — cannot reach the server.'}
            </div>
          ) : (
            <table className="lb-table lb-elo">
              <thead>
                <tr>
                  <th className="lb-rank">#</th>
                  <th className="lb-col-name">Player</th>
                  <th>Tier</th>
                  <th title="ELO rating">ELO</th>
                  <th title="Ranked won">W</th>
                  <th title="Ranked lost">L</th>
                </tr>
              </thead>
              <tbody>
                {eloRows.map((r, i) => (
                  <tr key={r.username} className={username && r.username === username ? 'lb-me' : ''}>
                    <td className="lb-rank">{i + 1}</td>
                    <td className="lb-col-name">{r.username}</td>
                    <td>
                      <TierBadge elo={r.elo} />
                    </td>
                    <td className="lb-elo-num">{r.elo}</td>
                    <td>{r.rankedWon}</td>
                    <td>{r.rankedLost}</td>
                  </tr>
                ))}
                {me && me.elo != null && !meInElo && (
                  <tr className="lb-me lb-me-extra">
                    <td className="lb-rank">·</td>
                    <td className="lb-col-name">{me.username}</td>
                    <td>
                      <TierBadge elo={me.elo} />
                    </td>
                    <td className="lb-elo-num">{me.elo}</td>
                    <td>{me.rankedWon ?? 0}</td>
                    <td>{me.rankedLost ?? 0}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {/* the ladder's five tiers, spanning the 1000–2400 rating range */}
          <div className="tier-legend">
            <span className="tier-badge tier-bronze">Bronze 1000–1299</span>
            <span className="tier-badge tier-silver">Silver 1300–1599</span>
            <span className="tier-badge tier-gold">Gold 1600–1899</span>
            <span className="tier-badge tier-master">Master 1900–2199</span>
            <span className="tier-badge tier-grandmaster">Grandmaster 2200–2400</span>
          </div>
          <div className="lb-note">
            ELO moves only in Ranked matches — real opponent vs real opponent. New players start at
            1200.
          </div>
        </>
      )}
      {leaderboard && tab === 'stats' && (
        <div className="lb-totals">
          {players} {players === 1 ? 'player has' : 'players have'} played · {signups} signed up
        </div>
      )}
    </Modal>
  );
}

function Landing() {
  const playLocal = useNet((s) => s.playLocal);
  const playTutorial = useNet((s) => s.playTutorial);
  const username = useNet((s) => s.username);
  const setScreen = useNet((s) => s.setScreen);
  const openSettings = useGame((s) => s.openModal);
  const [showTutorial, setShowTutorial] = useState(false);
  // ONE route into a match: "Play MageStone" expands the ways to play.
  const [playOpen, setPlayOpen] = useState(false);
  // Hotseat first nudges newcomers toward the guided tutorial.
  const [confirmHotseat, setConfirmHotseat] = useState(false);
  const playOnline = () => {
    // Signed in (or already playing as a guest) → straight to the lobby;
    // otherwise just ask for a name — no account needed in the alpha.
    if (username) setScreen('lobby');
    else setScreen('guest');
  };
  return (
    <Shell bare>
      <nav className="entry-menu">
        <button className="menu-item menu-primary" onClick={() => setPlayOpen((v) => !v)}>
          Play MageStone
        </button>
        {playOpen && (
          <div className="menu-sub">
            <button className="menu-item menu-subitem" onClick={playOnline}>Play Online</button>
            <button className="menu-item menu-subitem" onClick={() => setConfirmHotseat(true)}>
              Play Hotseat
            </button>
            <button className="menu-item menu-subitem" onClick={playTutorial}>
              Learn with Tutorial
            </button>
            <button className="menu-item menu-subitem" onClick={() => setShowTutorial(true)}>
              Rules
            </button>
          </div>
        )}
        <button className="menu-item" onClick={() => openSettings('settings')}>Settings</button>
      </nav>
      {confirmHotseat && (
        <Modal
          title="Before you play"
          onClose={() => setConfirmHotseat(false)}
          footer={
            <>
              <button
                className="primary"
                onClick={() => {
                  setConfirmHotseat(false);
                  playTutorial();
                }}
              >
                Play Tutorial
              </button>
              <button
                className="primary"
                onClick={() => {
                  setConfirmHotseat(false);
                  playLocal();
                }}
              >
                Continue to Game
              </button>
            </>
          }
        >
          <p className="hotseat-confirm">
            It is recommended to play the tutorial first, do you wish to continue?
          </p>
        </Modal>
      )}
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
    </Shell>
  );
}

/** Owner-only: every print-and-play signup email, straight from the database. */
function PnpList({ onClose }: { onClose: () => void }) {
  const rows = useNet((s) => s.pnpRows);
  const fetchPnpList = useNet((s) => s.fetchPnpList);
  useEffect(() => {
    fetchPnpList();
  }, [fetchPnpList]);
  return (
    <Modal
      title={`Print & Play signups${rows ? ` (${rows.length})` : ''}`}
      onClose={onClose}
      footer={
        <button className="primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {!rows ? (
        <div className="lb-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="lb-empty">No signups yet.</div>
      ) : (
        <div className="fb-list">
          {rows.map((r, i) => (
            <div className="fb-item" key={r.email ?? i}>
              <div className="fb-meta">{r.created ? new Date(r.created).toLocaleString() : '—'}</div>
              {r.email}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Trust signals + alpha housekeeping along the bottom of the front page. */
function LandingFooter() {
  const [modal, setModal] = useState<null | 'feedback' | 'issues' | 'patch' | 'privacy' | 'pnp' | 'pnpList'>(null);
  const pnpSignup = useNet((s) => s.pnpSignup);
  const pnpDone = useNet((s) => s.pnpDone);
  const username = useNet((s) => s.username);
  const guest = useNet((s) => s.guest);
  // The signup list is only readable signed in as the owner account.
  const isOwner = !guest && username?.toLowerCase() === 'magicdog94';
  const [email, setEmail] = useState('');
  const close = () => setModal(null);
  return (
    <>
      <footer className="entry-footer">
        <span className="entry-footer-line">
          MageStone — Early Alpha {VERSION} · updated {UPDATED} · © 2026 MageStone · desktop
          recommended
        </span>
        <span className="entry-footer-links">
          <button className="link-btn" onClick={() => setModal('feedback')}>Feedback</button>
          <button className="link-btn" onClick={() => setModal('issues')}>Known issues</button>
          <button className="link-btn" onClick={() => setModal('patch')}>Patch notes</button>
          <button className="link-btn" onClick={() => setModal('pnp')}>Print &amp; Play</button>
          <button className="link-btn" onClick={() => setModal('privacy')}>Privacy</button>
        </span>
      </footer>
      {modal === 'feedback' && <FeedbackModal onClose={close} />}
      {modal === 'issues' && (
        <Modal title="Known issues" onClose={close} footer={<button className="primary" onClick={close}>Done</button>}>
          <ul className="footer-list">
            {KNOWN_ISSUES.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </Modal>
      )}
      {modal === 'patch' && (
        <Modal title="Patch notes" onClose={close} footer={<button className="primary" onClick={close}>Done</button>}>
          <ul className="footer-list">
            {PATCH_NOTES.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </Modal>
      )}
      {modal === 'privacy' && (
        <Modal title="Privacy" onClose={close} footer={<button className="primary" onClick={close}>Done</button>}>
          <div className="footer-prose">
            <p>
              MageStone stores the minimum needed to run the alpha: account usernames with salted,
              hashed passwords; win/loss and ELO records; feedback you submit; and an email address
              only if you join the print-and-play list.
            </p>
            <p>
              No ads, no trackers, no analytics cookies — the only browser storage used is for your
              own preferences (layout, acknowledgements) and session token. To remove your data,
              send a note through the Feedback form.
            </p>
          </div>
        </Modal>
      )}
      {modal === 'pnpList' && <PnpList onClose={close} />}
      {modal === 'pnp' && (
        <Modal
          title="Print & Play"
          onClose={close}
          footer={
            <>
              {isOwner && (
                <button className="ghost" onClick={() => setModal('pnpList')}>
                  View signups
                </button>
              )}
              <button className="primary" onClick={close}>
                Done
              </button>
            </>
          }
        >
          {pnpDone ? (
            <p className="hotseat-confirm">You’re on the list — thank you! We’ll email when the print-and-play kit is ready.</p>
          ) : (
            <>
              <p className="footer-prose">
                Interested in the physical game? Join the print-and-play playtest list and be first
                to get the tabletop kit.
              </p>
              <form
                className="pnp-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.includes('@')) pnpSignup(email);
                }}
              >
                <label className="entry-field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
                <button className="primary" type="submit" disabled={!email.includes('@')}>
                  Join the list
                </button>
              </form>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function Auth() {
  const mode = useNet((s) => s.authMode);
  const signin = useNet((s) => s.signin);
  const signup = useNet((s) => s.signup);
  const setScreen = useNet((s) => s.setScreen);
  const error = useNet((s) => s.authError);
  const busy = useNet((s) => s.authBusy);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    (mode === 'signup' ? signup : signin)(username.trim(), password);
  };

  return (
    <Shell>
      <form className="entry-card" onSubmit={submit}>
        <div className="entry-card-title">{mode === 'signup' ? 'Create account' : 'Sign in'}</div>
        <label className="entry-field">
          <span>Username</span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            maxLength={20}
          />
        </label>
        <label className="entry-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </label>
        {error && <div className="entry-error">{error}</div>}
        <button className="primary lg" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <div className="entry-switch">
          {mode === 'signup' ? (
            <>
              Already have an account?{' '}
              <button type="button" className="link-btn" onClick={() => useNet.setState({ authMode: 'signin', authError: null })}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{' '}
              <button type="button" className="link-btn" onClick={() => useNet.setState({ authMode: 'signup', authError: null })}>
                Create an account
              </button>
            </>
          )}
        </div>
        <button type="button" className="link-btn back" onClick={() => setScreen('landing')}>
          ← Back
        </button>
      </form>
    </Shell>
  );
}

/** Ranked matchmaking — CLOSED for the open playtest. The card stays visible
 *  so players know the mode exists; hovering explains why it's greyed out.
 *  (The queue/ELO plumbing is intact server-side for when it reopens.) */
function RankedCard() {
  return (
    <div
      className="entry-card wide ranked-card ranked-off tip"
      data-tip="Not available during playtesting"
    >
      <div className="entry-card-title">Ranked match</div>
      <div className="ranked-info">Ranked play and ELO ratings return after the playtest.</div>
      <button className="primary lg" disabled>
        Search Ranked
      </button>
      <div className="ranked-note">
        1v1 against a real player · ELO (1000–2400) moves only in Ranked
      </div>
    </div>
  );
}

function CreateJoin() {
  const username = useNet((s) => s.username);
  const guest = useNet((s) => s.guest);
  const create = useNet((s) => s.createGame);
  const join = useNet((s) => s.joinGame);
  const signout = useNet((s) => s.signout);
  const joinError = useNet((s) => s.joinError);
  const [players, setPlayers] = useState(2);
  const [createPw, setCreatePw] = useState('');
  const [joinId, setJoinId] = useState('');
  const [joinPw, setJoinPw] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  return (
    <Shell>
      <div className="entry-userbar">
        {guest ? 'Playing as' : 'Signed in as'} <strong>{username}</strong>
        {guest && <span className="guest-badge">guest</span>}
        <button className="link-btn" onClick={() => setShowLeaderboard(true)}>
          Leaderboard
        </button>
        <button className="link-btn" onClick={signout}>
          {guest ? 'Leave' : 'Sign out'}
        </button>
      </div>
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}
      <RankedCard />
      <div className="lobby-grid">
        <div className="entry-card">
          <div className="entry-card-title">Create a game</div>
          <div className="entry-field">
            <span>Players</span>
            <div className="seg-row">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={`seg ${players === n ? 'on' : ''}`}
                  onClick={() => setPlayers(n)}
                  type="button"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <label className="entry-field">
            <span>Game password</span>
            <input
              value={createPw}
              onChange={(e) => setCreatePw(e.target.value)}
              placeholder="optional — leave empty for link invites"
            />
          </label>
          <button className="primary lg" onClick={() => create(players, createPw)}>
            Create game
          </button>
        </div>

        <div className="entry-card">
          <div className="entry-card-title">Join a game</div>
          <label className="entry-field">
            <span>Game ID</span>
            <input
              value={joinId}
              onChange={(e) => setJoinId(e.target.value.toUpperCase())}
              placeholder="e.g. 7KQ2P"
              maxLength={5}
            />
          </label>
          <label className="entry-field">
            <span>Password</span>
            <input value={joinPw} onChange={(e) => setJoinPw(e.target.value)} />
          </label>
          {joinError && <div className="entry-error">{joinError}</div>}
          <button className="ghost lg" onClick={() => join(joinId, joinPw)}>
            Join game
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Room() {
  const room = useNet((s) => s.room)!;
  const username = useNet((s) => s.username);
  const startGame = useNet((s) => s.startGame);
  const leaveRoom = useNet((s) => s.leaveRoom);
  const addBot = useNet((s) => s.addBot);
  const removeBot = useNet((s) => s.removeBot);
  const isHost = room.host === username;
  const full = room.players.length >= room.playerCount;
  // One-click invites: the link opens the game and pre-fills this room.
  const [copied, setCopied] = useState(false);
  const copyInvite = () => {
    const url = `${location.origin}/?join=${room.gameId}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => window.prompt('Copy this invite link:', url));
  };

  return (
    <Shell>
      <div className="entry-card wide">
        <div className="entry-card-title">{room.ranked ? 'Ranked match' : 'Game lobby'}</div>
        {room.ranked ? (
          <div className="room-id">
            Opponent found — starting… <span className="room-hint">ELO is on the line</span>
          </div>
        ) : (
          <div className="room-id">
            Game ID <span className="room-code">{room.gameId}</span>
            <button className="ghost copy-link" onClick={copyInvite} type="button">
              {copied ? 'Link copied!' : 'Copy invite link'}
            </button>
            <span className="room-hint">
              {room.hasPass
                ? 'friends also need the room password'
                : 'anyone with the link can join'}
            </span>
          </div>
        )}
        <div className="room-players">
          {Array.from({ length: room.playerCount }).map((_, i) => {
            const p = room.players[i];
            return (
              <div key={i} className={`room-slot ${p ? 'filled' : ''}`}>
                <span className="room-dot" style={{ background: p ? COLORS[p.color] : 'transparent' }} />
                {p ? (
                  <span className="room-name">
                    {p.username}
                    {p.bot && <span className="room-bot-tag">AI</span>}
                    {p.username === username ? ' (you)' : ''}
                    {p.username === room.host ? ' · host' : ''}
                    {p.bot && isHost && (
                      <button className="link-btn room-bot-remove" onClick={() => removeBot(p.color)}>
                        remove
                      </button>
                    )}
                  </span>
                ) : isHost ? (
                  // Short a player? The host can seat an AI bot instead.
                  <span className="room-addbot">
                    <span className="room-addbot-label">Add bot</span>
                    {BOT_LEVELS.map((l) => (
                      <button key={l} className="room-bot-btn" onClick={() => addBot(l)}>
                        {BOT_LABEL[l]}
                      </button>
                    ))}
                  </span>
                ) : (
                  <span className="room-empty">waiting for a player…</span>
                )}
              </div>
            );
          })}
        </div>
        {isHost ? (
          <button className="primary lg" onClick={startGame} disabled={!full}>
            {full ? 'Start game' : `Waiting (${room.players.length}/${room.playerCount})`}
          </button>
        ) : (
          <div className="entry-waiting">Waiting for the host to start…</div>
        )}
        <button className="link-btn back" onClick={leaveRoom}>
          ← Leave lobby
        </button>
      </div>
    </Shell>
  );
}

export function EntryScreens() {
  const screen = useNet((s) => s.screen);
  const room = useNet((s) => s.room);
  if (screen === 'landing') return <Landing />;
  if (screen === 'auth') return <Auth />;
  if (screen === 'guest') return <GuestName />;
  // lobby
  return room ? <Room /> : <CreateJoin />;
}

/** Account-free entry: just a display name, then straight to the lobby (or the
 *  invite-linked room). Accounts stay available for Ranked/ELO. */
function GuestName() {
  const guestPlay = useNet((s) => s.guestPlay);
  const setScreen = useNet((s) => s.setScreen);
  const goAuth = useNet((s) => s.goAuth);
  const pendingJoin = useNet((s) => s.pendingJoin);
  const error = useNet((s) => s.authError);
  const busy = useNet((s) => s.authBusy);
  const [name, setName] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length >= 2) guestPlay(name.trim());
  };
  return (
    <Shell>
      <form className="entry-card" onSubmit={submit}>
        <div className="entry-card-title">
          {pendingJoin ? `Join game ${pendingJoin}` : 'Play online'}
        </div>
        <label className="entry-field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="shown to other players"
            maxLength={20}
            autoFocus
          />
        </label>
        {error && <div className="entry-error">{error}</div>}
        <button className="primary lg" type="submit" disabled={busy || name.trim().length < 2}>
          {pendingJoin ? 'Join game' : 'Continue'}
        </button>
        {/* accounts (for Ranked/ELO) + the leaderboard live here, off the menu */}
        <div className="online-extras">
          <button type="button" className="ghost" onClick={() => goAuth('signin')}>
            Sign In
          </button>
          <button type="button" className="ghost" onClick={() => setShowLeaderboard(true)}>
            Leaderboard
          </button>
        </div>
        <div className="entry-switch">
          Want an ELO rating?{' '}
          <button type="button" className="link-btn" onClick={() => goAuth('signup')}>
            Create a free account
          </button>
        </div>
        <button type="button" className="link-btn back" onClick={() => setScreen('landing')}>
          ← Back
        </button>
      </form>
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}
    </Shell>
  );
}
