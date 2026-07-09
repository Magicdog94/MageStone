import { useState } from 'react';
import { Modal } from './controls';

const ACK_KEY = 'ms-copyright-ack';

/** A blocking copyright / alpha notice shown on the front page before anything
 *  else can be used. Mandatory (no dismiss but the "I acknowledge" button); the
 *  acknowledgement is remembered per browser. */
export function CopyrightNotice() {
  const [acked, setAcked] = useState(() => {
    try {
      return localStorage.getItem(ACK_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (acked) return null;

  const ack = () => {
    try {
      localStorage.setItem(ACK_KEY, '1');
    } catch {
      /* storage unavailable — it just shows again next load */
    }
    setAcked(true);
  };

  return (
    <Modal
      title="Notice"
      footer={
        <button className="primary" onClick={ack}>
          I acknowledge
        </button>
      }
    >
      <div className="copyright-notice">
        <p>
          © 2026 MageStone. MageStone and MageStone.net are original game projects. All rights
          reserved.
        </p>
        <p>
          All game artwork, rules text, board designs, character concepts, logos, website content,
          and digital assets are protected by copyright and may not be copied, reproduced, modified,
          distributed, or used commercially without prior written permission.
        </p>
        <p>
          MageStone is currently in alpha playtesting. Gameplay, rules, artwork, and features are
          subject to change.
        </p>
      </div>
    </Modal>
  );
}
