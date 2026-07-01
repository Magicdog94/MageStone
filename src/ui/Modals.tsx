import { useState, type ReactNode } from 'react';
import { useGame } from '../store';
import { useNet } from '../net/useNet';
import type { PlayerColor } from '../game/types';
import {
  RANDOM_LAYOUT,
  STONE_LAYOUTS,
  stoneCells,
  type StoneLayout,
} from '../game/setup';
import { COLORS } from '../three/coords';
import { Field, Modal, Segmented } from './controls';

const TIMER_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
  { value: 90, label: '90s' },
];
const PLAYER_OPTIONS = [
  { value: 2, label: '2' },
  { value: 4, label: '4' },
];

const TEAM_OPTIONS: { value: PlayerColor; label: string }[] = [
  { value: 'red', label: 'Red' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'yellow', label: 'Yellow' },
];
const ALL_COLORS: PlayerColor[] = TEAM_OPTIONS.map((t) => t.value);

/** Team-colour picker. With `locked` every colour shows selected (4-player);
 *  otherwise the player picks exactly `max`, the oldest swapping out when full. */
function TeamPicker({
  value,
  onChange,
  max,
  locked = false,
}: {
  value: PlayerColor[];
  onChange: (next: PlayerColor[]) => void;
  max: number;
  locked?: boolean;
}) {
  const toggle = (color: PlayerColor) => {
    if (locked) return;
    const has = value.includes(color);
    if (has) {
      if (value.length <= 1) return; // keep at least one picked
      onChange(value.filter((c) => c !== color));
    } else if (value.length < max) {
      onChange([...value, color]);
    } else {
      onChange([...value.slice(1), color]); // full → drop the oldest pick
    }
  };
  return (
    <div className="team-picker" role="group" aria-label="Teams">
      {TEAM_OPTIONS.map((t) => {
        const active = locked || value.includes(t.value);
        return (
          <button
            key={t.value}
            type="button"
            className={`team-swatch${active ? ' active' : ''}${locked ? ' locked' : ''}`}
            style={{ ['--team' as string]: COLORS[t.value] }}
            aria-pressed={active}
            disabled={locked}
            onClick={() => toggle(t.value)}
          >
            <span className="team-dot" />
            <span className="team-name">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Mini map of the central 8×8 with the board grid drawn over it, showing the
 *  layout's full canonical pattern (16 stones) so the *name* matches the shape
 *  in both 2- and 4-player — a 2-player game simply uses a symmetric half of it.
 *  Central cells are rows/cols 4–11 → local 0–7; the 2×2 Nexus sits at 3–4. */
function LayoutThumb({ layout }: { layout: StoneLayout }) {
  const cells = stoneCells(layout, 4);
  const lines = [];
  for (let i = 0; i <= 8; i++) {
    lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={8} />);
    lines.push(<line key={`h${i}`} x1={0} y1={i} x2={8} y2={i} />);
  }
  return (
    <svg className="layout-map" viewBox="0 0 8 8" aria-hidden="true">
      <rect x="3" y="3" width="2" height="2" className="layout-nexus" rx="0.2" />
      <g className="layout-grid">{lines}</g>
      {cells.map((c, i) => (
        <circle key={i} cx={c.c - 4 + 0.5} cy={c.r - 4 + 0.5} r="0.4" className="layout-stone" />
      ))}
    </svg>
  );
}

/** MageStone layout chooser — eight symmetric presets plus a Random option. */
function LayoutPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const tile = (id: string, name: string, body: ReactNode) => (
    <button
      key={id}
      type="button"
      className={`layout-tile${value === id ? ' active' : ''}`}
      aria-pressed={value === id}
      onClick={() => onChange(id)}
      title={name}
    >
      {body}
      <span className="layout-name">{name}</span>
    </button>
  );
  return (
    <div className="layout-picker" role="group" aria-label="MageStone layout">
      {STONE_LAYOUTS.map((l) => tile(l.id, l.name, <LayoutThumb layout={l} />))}
      {tile(RANDOM_LAYOUT, 'Random', <span className="layout-random">?</span>)}
    </div>
  );
}

function NewGameModal() {
  const playerColors = useGame((s) => s.playerColors);
  const storedLayout = useGame((s) => s.stoneLayoutId);
  const settings = useGame((s) => s.settings);
  const newGame = useGame((s) => s.newGame);
  const setTurnSeconds = useGame((s) => s.setTurnSeconds);
  const closeModal = useGame((s) => s.closeModal);
  const started = useGame((s) => s.started);

  const [mode, setMode] = useState(playerColors.length === 4 ? 4 : 2);
  // The pair picked for a 2-player game (kept while toggling to 4 and back).
  const [duo, setDuo] = useState<PlayerColor[]>(
    playerColors.length === 2 ? playerColors : ['red', 'green'],
  );
  const [layout, setLayout] = useState(storedLayout);
  const [timer, setTimer] = useState(settings.turnSeconds ?? 0);

  const teams = mode === 4 ? ALL_COLORS : duo;
  const canStart = mode === 4 || duo.length === 2;

  const start = () => {
    if (!canStart) return;
    setTurnSeconds(timer === 0 ? null : timer);
    newGame(teams, layout);
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
          <button className="primary" onClick={start} disabled={!canStart}>
            Start Game
          </button>
        </>
      }
    >
      <Field label="Players" hint="2 play opposite each other; 4 fill every side">
        <Segmented options={PLAYER_OPTIONS} value={mode} onChange={setMode} ariaLabel="Players" />
      </Field>
      <Field
        label="Teams"
        hint={mode === 4 ? 'All four colours play' : 'Pick two colours'}
      >
        <TeamPicker value={teams} onChange={setDuo} max={2} locked={mode === 4} />
      </Field>
      <Field
        label="MageStones"
        hint={`${mode * 4} stones — ${mode === 2 ? 'a symmetric half of the layout' : 'the full layout'}`}
      >
        <LayoutPicker value={layout} onChange={setLayout} />
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
  const status = useNet((s) => s.status);
  const online = status === 'online';

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
      <div className="modal-section">Server</div>
      <Field label="Status" hint="Online multiplayer connection">
        <span className={`server-pill${online ? ' online' : ''}`}>
          <span className="server-dot" />
          {online ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Offline'}
        </span>
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
