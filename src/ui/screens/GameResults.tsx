import { useEffect, useMemo } from 'react';
import { useNet } from '../../net/useNet';
import { bossOf, buildLeaderboard, outcomeClass, type HotseatResult } from '../../net/hotseatResults';

function when(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function ResultsTable({ rows }: { rows: HotseatResult[] }) {
  return (
    <table className="lb-table gr-table">
      <thead>
        <tr>
          <th className="lb-col-name">Player</th>
          <th>Result</th>
          <th title="The opponent you played: an Easy, Medium or Hard bot, or a human">Boss</th>
          <th>Won by</th>
          <th>Round</th>
          <th className="gr-hide-narrow">Kills</th>
          <th className="gr-hide-narrow lb-col-name">Against</th>
          <th className="gr-hide-narrow">Date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.rid ?? i}>
            <td className="lb-col-name">{r.name}</td>
            <td className={`gr-outcome ${outcomeClass(r.outcome)}`}>{r.outcome}</td>
            <td>{bossOf(r.opponents)}</td>
            <td>{r.method === 'Draw' || r.method === 'Rage Quit' ? '—' : r.method}</td>
            <td>{r.rounds}</td>
            <td className="gr-hide-narrow">{r.kills}</td>
            <td className="gr-hide-narrow lb-col-name">{r.opponents.join(', ')}</td>
            <td className="gr-hide-narrow">{when(r.created)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Bottom of the main page: EVERY hotseat game (finished, or left part-way
 *  as a "Defeat by Rage Quit"), newest first, by the
 *  name each player gave before starting. Never trimmed: the list grows as
 *  long as it needs to. */
export function GameResults() {
  const rows = useNet((s) => s.hotseatResults);
  const fetchHotseatResults = useNet((s) => s.fetchHotseatResults);
  useEffect(() => {
    fetchHotseatResults();
  }, [fetchHotseatResults]);
  return (
    <section className="game-results" id="game-results" aria-label="Game Results">
      <h2 className="game-results-title">
        Game Results{rows && rows.length > 0 ? ` (${rows.length})` : ''}
      </h2>
      {!rows ? (
        <div className="lb-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="lb-empty">No hotseat games recorded yet.</div>
      ) : (
        <ResultsTable rows={rows} />
      )}
    </section>
  );
}

const CROWNS: Record<number, { cls: string; label: string }> = {
  1: { cls: 'crown-gold', label: 'Gold crown, 1st place' },
  2: { cls: 'crown-silver', label: 'Silver crown, 2nd place' },
  3: { cls: 'crown-bronze', label: 'Bronze crown, 3rd place' },
};

/** A small crown, coloured by the CSS class (gold, silver or bronze). */
function Crown({ rank }: { rank: number }) {
  const c = CROWNS[rank];
  return (
    <svg className={`pl-crown ${c.cls}`} viewBox="0 0 24 18" role="img" aria-label={c.label}>
      <title>{c.label}</title>
      <path
        d="M2 5 L7 10 L12 2 L17 10 L22 5 L20 15 L4 15 Z"
        fill="currentColor"
        stroke="rgba(0,0,0,0.45)"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <rect x="4" y="15" width="16" height="2.5" rx="0.8" fill="currentColor" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      <circle cx="12" cy="2" r="1.6" fill="currentColor" />
      <circle cx="2" cy="5" r="1.4" fill="currentColor" />
      <circle cx="22" cy="5" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** Under Game Results: every player who has a recorded hotseat game, ranked by
 *  wins (ties: fewer losses, then more kills). Worked out from the same full
 *  results list, so old games count and each new game moves the table. */
export function PlayerLeaderboard() {
  const rows = useNet((s) => s.hotseatResults);
  const board = useMemo(() => (rows ? buildLeaderboard(rows) : null), [rows]);
  return (
    <section className="game-results player-board" id="player-leaderboard" aria-label="Leaderboard">
      <h2 className="game-results-title">Leaderboard{board && board.length > 0 ? ` (${board.length})` : ''}</h2>
      {!board ? (
        <div className="lb-empty">Loading…</div>
      ) : board.length === 0 ? (
        <div className="lb-empty">No players ranked yet.</div>
      ) : (
        <>
          <table className="lb-table gr-table pl-table">
            <thead>
              <tr>
                <th className="pl-rank">Rank</th>
                <th className="lb-col-name">Player</th>
                <th>Played</th>
                <th>Win</th>
                <th title="Defeats, including Defeat by Rage Quit">Lost</th>
                <th>Kills</th>
              </tr>
            </thead>
            <tbody>
              {board.map((p) => (
                <tr key={p.name.toLowerCase()} className={p.rank <= 3 ? `pl-top pl-top-${p.rank}` : undefined}>
                  <td className="pl-rank">{p.rank <= 3 ? <Crown rank={p.rank} /> : p.rank}</td>
                  <td className="lb-col-name">{p.name}</td>
                  <td>{p.played}</td>
                  <td>{p.won}</td>
                  <td>{p.lost}</td>
                  <td>{p.kills}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pl-note">
            Ranked by wins. Ties go to fewer losses, then more kills. Rage quits count as losses; draws count as
            played only.
          </p>
        </>
      )}
    </section>
  );
}
