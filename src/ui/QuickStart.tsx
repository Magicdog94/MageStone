import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useGame } from '../store';
import { Modal } from './controls';
import { StoneIcon, SwordIcon } from './Icons';
import { QUICK_START_KEY, alphaWelcomeSeen, markSeen, quickStartSeen } from './onboarding';

/**
 * The four things a new player needs, at most 40 words each. Written from a
 * playtester's notes: they skipped the tutorial, sandboxed for ten minutes,
 * guessed the goal was wiping out the other side, and never found the squares
 * readout — so the MageStone race leads, and the allowance comes straight after.
 */
const CARDS: { title: string; icon: ReactNode; body: string }[] = [
  {
    title: 'Win the MageStone race',
    icon: <StoneIcon size={30} />,
    body:
      'Walk your Mage onto a MageStone to pick it up, then carry it home to your base and ' +
      'Activate it. Bring six Activated stones home to win. Holding the centre with your ' +
      'Priest, or wiping out your rival, also wins.',
  },
  {
    title: 'Six squares a turn',
    icon: <span className="qs-glyph">6</span>,
    body:
      'On your go you have 6 squares to share between up to 3 pieces — one piece six ' +
      'squares, or three pieces two each. Unused squares are lost when you press End Turn. ' +
      'The top banner shows whose go it is.',
  },
  {
    title: 'Every piece is different',
    icon: <span className="qs-glyph">?</span>,
    body:
      'Warriors fight, and gang up when two or three stand beside the same enemy. Your Mage ' +
      'collects MageStones and grows stronger with them. Your Priest can’t attack, but raises ' +
      'fallen Warriors. Click any piece to see what it does.',
  },
  {
    title: 'How a fight works',
    icon: <SwordIcon size={30} />,
    body:
      'Attack an enemy standing next to you. You roll, they roll, and the higher total wins — ' +
      'the loser is removed, ties re-roll. More Warriors means more dice, and Activated stones ' +
      'upgrade your Mage’s die from d6 to d12 to d20.',
  },
];

/**
 * One-minute onboarding for a player who skips the full tutorial: four short
 * cards, shown once per browser at the start of their first real game, and on
 * demand from Settings. While it is open the turn clock and the bots are paused
 * (`store.quickStart`), so reading it never costs anyone their first go.
 */
export function QuickStart() {
  const open = useGame((s) => s.quickStart);
  const setQuickStart = useGame((s) => s.setQuickStart);
  const started = useGame((s) => s.started);
  const modal = useGame((s) => s.modal);
  const tutorial = useGame((s) => s.tutorial);
  const [step, setStep] = useState(0);

  // Someone who dismissed the alpha notice on an earlier visit — before the
  // Quick Start existed — still gets it once, the first time a real game is
  // running with nothing else on screen. (A brand-new player is handed straight
  // over by AlphaWelcome instead.)
  useEffect(() => {
    if (open || !started || modal || tutorial) return;
    if (quickStartSeen() || !alphaWelcomeSeen()) return;
    setQuickStart(true);
  }, [open, started, modal, tutorial, setQuickStart]);

  if (!open || tutorial) return null;

  const close = () => {
    markSeen(QUICK_START_KEY);
    setStep(0);
    setQuickStart(false);
  };
  const card = CARDS[step];
  const last = step === CARDS.length - 1;

  return (
    <Modal
      title="Quick Start"
      onClose={close}
      footer={
        <>
          <button className="ghost" onClick={close}>
            Skip
          </button>
          <span className="qs-spacer" />
          {step > 0 && (
            <button className="ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="primary" onClick={last ? close : () => setStep(step + 1)}>
            {last ? 'Let’s play' : 'Next'}
          </button>
        </>
      }
    >
      <div className="qs-card" key={step}>
        <div className="qs-icon" aria-hidden="true">
          {card.icon}
        </div>
        <h3 className="qs-title">{card.title}</h3>
        <p className="qs-body">{card.body}</p>
      </div>
      <div className="qs-dots" aria-label={`Card ${step + 1} of ${CARDS.length}`}>
        {CARDS.map((c, i) => (
          <button
            key={c.title}
            className={`qs-dot${i === step ? ' on' : ''}`}
            onClick={() => setStep(i)}
            aria-label={`Card ${i + 1}: ${c.title}`}
          />
        ))}
      </div>
    </Modal>
  );
}
