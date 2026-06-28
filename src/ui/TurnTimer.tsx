import { useEffect, useState } from 'react';
import { useGame } from '../store';

/**
 * Per-turn countdown. The parent remounts this (via `key`) on each new turn or
 * limit change, so a single interval per mount drives the countdown; it pauses
 * while a modal is open and auto-ends the turn at zero.
 */
export function TurnTimer({ width }: { width?: number }) {
  const winner = useGame((s) => s.game.winner);
  const turnSeconds = useGame((s) => s.settings.turnSeconds);
  const modal = useGame((s) => s.modal);
  const endTurn = useGame((s) => s.endTurn);

  const [remaining, setRemaining] = useState<number | null>(turnSeconds);

  // One interval for the life of this mount (deps exclude `remaining`, so it is
  // never re-created mid-countdown). Pauses while a modal is open.
  useEffect(() => {
    if (turnSeconds == null || winner || modal) return;
    const id = setInterval(() => {
      setRemaining((r) => (r == null ? r : Math.max(0, r - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [turnSeconds, winner, modal]);

  // Auto-end the turn once it reaches zero (changes turn → parent remounts us).
  useEffect(() => {
    if (remaining === 0 && turnSeconds != null && !winner && !modal) endTurn();
  }, [remaining, turnSeconds, winner, modal, endTurn]);

  if (turnSeconds == null || remaining == null) return null;

  const low = remaining <= 5;
  const pct = Math.max(0, Math.min(1, remaining / turnSeconds));

  return (
    <div
      className={`turn-timer-top${low ? ' low' : ''}`}
      style={width ? { width } : undefined}
      role="timer"
      aria-label={`${remaining} seconds left this turn`}
      title="Time left this turn"
    >
      <span className="turn-timer-fill" style={{ width: `${pct * 100}%` }} />
    </div>
  );
}
