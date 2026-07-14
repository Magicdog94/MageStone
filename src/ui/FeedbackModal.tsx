import { useState, type FormEvent } from 'react';
import { useNet } from '../net/useNet';
import { useGame } from '../store';
import { Modal } from './controls';

/** The alpha feedback form: three open questions plus optional match details.
 *  Opened from the winner panel, the in-game Feedback pill, and the footer. */
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const sendFeedback = useNet((s) => s.sendFeedback);
  const game = useGame((s) => s.game);
  const [enjoy, setEnjoy] = useState('');
  const [confuse, setConfuse] = useState('');
  const [change, setChange] = useState('');
  const [duration, setDuration] = useState('');
  const [finished, setFinished] = useState('');
  const [bug, setBug] = useState('');
  const [sent, setSent] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!enjoy && !confuse && !change && !bug) return;
    sendFeedback({
      enjoy: enjoy || null,
      confuse: confuse || null,
      change: change || null,
      duration: duration || null,
      players: String(game.players.length),
      finished: finished || null,
      victory: game.winMethod ?? null,
      bug: bug || null,
    });
    setSent(true);
  };

  if (sent) {
    return (
      <Modal
        title="Thank you!"
        onClose={onClose}
        footer={
          <button className="primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <p className="hotseat-confirm">
          Your feedback goes straight to the workshop — it genuinely shapes the game. Have fun out
          there!
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Alpha feedback"
      onClose={onClose}
      footer={
        <button className="primary" onClick={submit} disabled={!enjoy && !confuse && !change && !bug}>
          Send Feedback
        </button>
      }
    >
      <form className="feedback-form" onSubmit={submit}>
        <label className="entry-field">
          <span>What was the most enjoyable part?</span>
          <textarea value={enjoy} onChange={(e) => setEnjoy(e.target.value)} rows={2} maxLength={2000} />
        </label>
        <label className="entry-field">
          <span>Was anything confusing or frustrating?</span>
          <textarea value={confuse} onChange={(e) => setConfuse(e.target.value)} rows={2} maxLength={2000} />
        </label>
        <label className="entry-field">
          <span>What is the one thing you would change?</span>
          <textarea value={change} onChange={(e) => setChange(e.target.value)} rows={2} maxLength={2000} />
        </label>
        <div className="feedback-row">
          <label className="entry-field">
            <span>Match length (optional)</span>
            <select value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value="">—</option>
              <option>Under 15 min</option>
              <option>15–30 min</option>
              <option>30–60 min</option>
              <option>Over an hour</option>
            </select>
          </label>
          <label className="entry-field">
            <span>Did you finish the game?</span>
            <select value={finished} onChange={(e) => setFinished(e.target.value)}>
              <option value="">—</option>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>
        </div>
        <label className="entry-field">
          <span>Bug report (optional)</span>
          <textarea
            value={bug}
            onChange={(e) => setBug(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="what happened, and what you expected"
          />
        </label>
      </form>
    </Modal>
  );
}
