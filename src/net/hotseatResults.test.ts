import { describe, expect, it } from 'vitest';
import { createGame } from '../game/setup';
import { buildResult, cleanName } from './hotseatResults';

describe('hotseat results', () => {
  const base = createGame(2);
  const [a, b] = base.players;

  it('records nothing while the game is running', () => {
    expect(buildResult(base, {}, 'Jacob')).toBeNull();
  });

  it('records a victory for the first human seat', () => {
    const g = { ...base, winner: a, winMethod: 'Ritual' as const, turn: 7, kills: { ...base.kills, [a]: 3 } };
    const r = buildResult(g, { [b]: 'hard' }, 'Jacob')!;
    expect(r).toMatchObject({ name: 'Jacob', outcome: 'Victory', color: a, method: 'Ritual', rounds: 7, kills: 3 });
    expect(r.opponents[0]).toMatch(/\(AI\)$/);
  });

  it('skips bot seats when choosing the named player', () => {
    const g = { ...base, winner: b, winMethod: 'Conquest' as const };
    const r = buildResult(g, { [a]: 'hard' }, 'Jacob')!;
    expect(r.color).toBe(b);
    expect(r.outcome).toBe('Victory');
  });

  it('records a defeat and a draw', () => {
    expect(buildResult({ ...base, winner: b, winMethod: 'MageStone' }, {}, 'J')!.outcome).toBe('Defeat');
    expect(buildResult({ ...base, winner: null, winMethod: 'Draw' }, {}, 'J')!.outcome).toBe('Draw');
  });

  it('tidies names', () => {
    expect(cleanName('  Jacob   H  ')).toBe('Jacob H');
    expect(cleanName('x'.repeat(40))).toHaveLength(24);
  });
});
