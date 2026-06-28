import { useState } from 'react';
import { useGame } from '../store';
import { Field, Modal, Segmented } from './controls';

const TIMER_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
  { value: 90, label: '90s' },
];
const PLAYER_OPTIONS = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
];

function NewGameModal() {
  const playerCount = useGame((s) => s.playerCount);
  const settings = useGame((s) => s.settings);
  const newGame = useGame((s) => s.newGame);
  const setTurnSeconds = useGame((s) => s.setTurnSeconds);
  const closeModal = useGame((s) => s.closeModal);
  const started = useGame((s) => s.started);

  const [players, setPlayers] = useState(playerCount);
  const [timer, setTimer] = useState(settings.turnSeconds ?? 0);

  const start = () => {
    setTurnSeconds(timer === 0 ? null : timer);
    newGame(players);
  };

  // The opening modal (before any game starts) is mandatory: the player must
  // choose, so no Cancel and no dismiss.
  return (
    <Modal
      title="New Game"
      onClose={started ? closeModal : undefined}
      footer={
        <>
          {started && (
            <button className="ghost" onClick={closeModal}>
              Cancel
            </button>
          )}
          <button className="primary" onClick={start}>
            Start Game
          </button>
        </>
      }
    >
      <Field label="Players" hint="Seated clockwise from the top">
        <Segmented options={PLAYER_OPTIONS} value={players} onChange={setPlayers} ariaLabel="Players" />
      </Field>
      <Field label="Turn timer" hint="Time limit per turn">
        <Segmented options={TIMER_OPTIONS} value={timer} onChange={setTimer} ariaLabel="Turn timer" />
      </Field>
    </Modal>
  );
}

function SettingsModal() {
  const settings = useGame((s) => s.settings);
  const setTurnSeconds = useGame((s) => s.setTurnSeconds);
  const openModal = useGame((s) => s.openModal);
  const closeModal = useGame((s) => s.closeModal);

  return (
    <Modal
      title="Settings"
      onClose={closeModal}
      footer={
        <>
          <button className="ghost" onClick={() => openModal('newGame')}>
            New Game
          </button>
          <button className="primary" onClick={closeModal}>
            Done
          </button>
        </>
      }
    >
      <div className="modal-section">Game</div>
      <Field label="Turn timer" hint="Time limit per turn (applies now)">
        <Segmented
          options={TIMER_OPTIONS}
          value={settings.turnSeconds ?? 0}
          onChange={(v) => setTurnSeconds(v === 0 ? null : v)}
          ariaLabel="Turn timer"
        />
      </Field>
    </Modal>
  );
}

export function Modals() {
  const modal = useGame((s) => s.modal);
  if (modal === 'newGame') return <NewGameModal />;
  if (modal === 'settings') return <SettingsModal />;
  return null;
}
