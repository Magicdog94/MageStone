import { useState } from 'react';
import { useGame } from '../store';
import { Modal } from './controls';

const SEEN_KEY = 'ms-alpha-welcome';

/** A one-time alpha disclaimer shown when a game first starts (once per browser).
 *  Mandatory (no dismiss but the Ok button) so every new tester reads it. */
export function AlphaWelcome() {
  const started = useGame((s) => s.started);
  const modal = useGame((s) => s.modal);
  const tutorial = useGame((s) => s.tutorial);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Wait until a game is actually running and no other modal is open, so it
  // never stacks over the opening New Game selector. Never during the tutorial.
  if (dismissed || !started || modal || tutorial) return null;

  const ok = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* storage unavailable — it just shows again next load */
    }
    setDismissed(true);
  };

  return (
    <Modal
      title="Welcome to the MageStone Alpha"
      footer={
        <button className="primary" onClick={ok}>
          Ok
        </button>
      }
    >
      <p className="alpha-welcome-text">
        This is not a finished product, and is no way a reflection of a final production. Any
        comments you have; positive or negative, will be greatly appreciated. Have fun!
      </p>
    </Modal>
  );
}
