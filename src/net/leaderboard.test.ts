import { describe, expect, it } from 'vitest';
import { buildLeaderboard, RAGE_QUIT, type HotseatResult, type Outcome } from './hotseatResults';

let n = 0;
const row = (name: string, outcome: Outcome, kills = 0, created?: string): HotseatResult => ({
  rid: `r${n++}`,
  name,
  outcome,
  color: 'red',
  winner: null,
  method: 'Conquest',
  rounds: 5,
  kills,
  opponents: ['Blue (Easy AI)'],
  created,
});

describe('player leaderboard', () => {
  it('is empty with no results', () => {
    expect(buildLeaderboard([])).toEqual([]);
  });

  it('totals played, won, lost (rage quits as losses) and kills', () => {
    const lb = buildLeaderboard([
      row('Jacob', 'Victory', 4),
      row('Jacob', 'Defeat', 1),
      row('Jacob', RAGE_QUIT, 2),
      row('Jacob', 'Draw', 0),
    ]);
    expect(lb).toEqual([{ rank: 1, name: 'Jacob', played: 4, won: 1, lost: 2, kills: 7 }]);
  });

  it('ranks by wins, then fewer losses, then kills', () => {
    const lb = buildLeaderboard([
      row('A', 'Victory'),
      row('B', 'Victory'),
      row('B', 'Victory'),
      row('C', 'Victory', 1),
      row('C', 'Defeat'),
      row('D', 'Victory', 5),
      row('D', 'Defeat'),
      row('E', 'Defeat'),
    ]);
    expect(lb.map((r) => `${r.rank}${r.name}`)).toEqual(['1B', '2A', '3D', '4C', '5E']);
  });

  it('merges names that differ only by case or spacing, showing the latest spelling', () => {
    const lb = buildLeaderboard([
      row('JACOB', 'Victory', 0, '2026-11-12T10:00:00Z'),
      row(' jacob ', 'Defeat', 0, '2026-11-10T10:00:00Z'),
    ]);
    expect(lb).toHaveLength(1);
    expect(lb[0]).toMatchObject({ name: 'JACOB', played: 2, won: 1, lost: 1 });
  });

  it('never caps the list', () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(`P${i}`, 'Victory'));
    const lb = buildLeaderboard(rows);
    expect(lb).toHaveLength(150);
    expect(lb.at(-1)!.rank).toBe(150);
  });
});
