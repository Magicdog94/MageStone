import { useEffect, useState } from 'react';
import { useGame } from '../store';
import { Modal } from './controls';
import { ALPHA_WELCOME_KEY as SEEN_KEY, quickStartSeen } from './onboarding';

/** A one-time alpha disclaimer shown when a game first starts (once per browser).
 *  Mandatory (no dismiss but the Ok button) so every new tester reads it. */
export function AlphaWelcome() {
  const started = useGame((s) => s.started);
  const modal = useGame((s) => s.modal);
  const tutorial = useGame((s) => s.tutorial);
  const setQuickStart = useGame((s) => s.setQuickStart);
  const setWelcomeOpen = useGame((s) => s.setWelcomeOpen);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Wait until a game is actually running and no other modal is open, so it
  // never stacks over the opening New Game selector. Never during the tutorial.
  const showing = !dismissed && started && !modal && !tutorial;
  // While it is up, the turn clock and the bots wait: a new player reading it
  // was losing the first ~13 seconds of a 90-second first go.
  useEffect(() => {
    setWelcomeOpen(showing);
  }, [showing, setWelcomeOpen]);
  if (!showing) return null;

  const ok = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* storage unavailable — it just shows again next load */
    }
    setDismissed(true);
    // A brand-new player goes straight on to the one-minute Quick Start.
    if (!quickStartSeen()) setQuickStart(true);
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
