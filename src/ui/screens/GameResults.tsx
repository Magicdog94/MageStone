import { useEffect } from 'react';
import { useNet } from '../../net/useNet';
import type { HotseatResult } from '../../net/hotseatResults';

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
            <td className={`gr-outcome gr-${r.outcome.toLowerCase()}`}>{r.outcome}</td>
            <td>{r.method === 'Draw' ? '—' : r.method}</td>
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

/** Bottom of the main page: EVERY finished hotseat game, newest first, by the
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
