import { useEffect, useState, type CSSProperties } from 'react';
import { unitActions, useGame } from '../store';
import { useNet } from '../net/useNet';
import { COLORS } from '../three/coords';
import {
  discardsLeft,
  gravestoneBank,
  gravestoneCapacity,
  hasPlayLeft,
  magePowerDie,
  unitById,
} from '../game/rules';
import { PipDie } from './Die';
import { CombatRoll } from './CombatRoll';
import { EliminationToast } from './EliminationToast';
import { PlayerStrip } from './PlayerStrip';
import { SiegeBanner } from './SiegeBanner';
import { TurnTimer } from './TurnTimer';
import { Modals } from './Modals';
import { CogIcon, GraveIcon } from './Icons';

const KIND_LABEL = { warrior: 'Warrior', mage: 'Mage', priest: 'Priest' } as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function HUD() {
  const game = useGame((s) => s.game);
  const selectedUnitId = useGame((s) => s.selectedUnitId);
  const selectedDieId = useGame((s) => s.selectedDieId);
  const rolling = useGame((s) => s.rolling);
  const roll = useGame((s) => s.roll);
  const discard = useGame((s) => s.discard);
  const selectDie = useGame((s) => s.selectDie);
  const endTurn = useGame((s) => s.endTurn);
  const collectStones = useGame((s) => s.collectStones);
  const activateStones = useGame((s) => s.activateStones);
  const doResurrect = useGame((s) => s.doResurrect);
  const doRitual = useGame((s) => s.doRitual);
  const openModal = useGame((s) => s.openModal);
  const turnSeconds = useGame((s) => s.settings.turnSeconds);
  const combatNonce = useGame((s) => s.combatNonce);
  const online = useGame((s) => s.online);
  const myColor = useGame((s) => s.myColor);
  const bots = useGame((s) => s.bots);
  // A bot's turn is never "my turn" — the BotDriver plays it; humans watch.
  const myTurn = !bots[game.current] && (!online || game.current === myColor);
  const exitToLobby = () => {
    useNet.getState().leaveRoom();
    useNet.setState({ screen: 'lobby' });
  };

  // Match the turn-timer bar to the width of the two central player cards.
  const [timerWidth, setTimerWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    const strip = document.querySelector('.player-strip');
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const cards = [...strip.querySelectorAll('.pstat')];
      if (!cards.length) return;
      const sr = strip.getBoundingClientRect();
      const cx = sr.left + sr.width / 2;
      const central = cards
        .map((c) => c.getBoundingClientRect())
        .map((r) => ({ r, d: Math.abs((r.left + r.right) / 2 - cx) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .map((x) => x.r);
      const w = Math.round(
        Math.max(...central.map((r) => r.right)) - Math.min(...central.map((r) => r.left)),
      );
      setTimerWidth(w);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    strip.querySelectorAll('.pstat').forEach((c) => ro.observe(c));
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [game.players.length]);

  const selectedUnit = selectedUnitId ? unitById(game, selectedUnitId) : undefined;
  const actions = unitActions(game, selectedUnitId);
  const phase = game.turnPhase;
  const combat = game.lastCombat;

  const dleft = phase === 'discard' ? discardsLeft(game) : 0;
  const discardLabel = `Discard ${dleft} ${dleft === 1 ? 'die' : 'dice'}`;

  const graveBank = gravestoneBank(game);
  const graveCap = gravestoneCapacity(game);

  const phaseHint = rolling
    ? 'Rolling the dice…'
    : phase === 'roll'
      ? 'Roll 5 dice — one Mage, one Priest, three Warrior.'
      : phase === 'discard'
        ? `${discardLabel}. Click a die in the tray or on the board.`
        : 'Move up to 3 units (each die moves its matching unit), then act: attack, ritual, activate or resurrect.';

  return (
    <div className="hud">
      {game.winner && (
        <div className="winner" style={{ '--accent': COLORS[game.winner] } as CSSProperties}>
          <span className="winner-eyebrow">Victory</span>
          <span className="winner-name">
            {online && game.winner === myColor ? 'You win' : `${cap(game.winner)} wins`}
          </span>
          {online ? (
            <button className="primary" onClick={exitToLobby}>
              Back to Lobby
            </button>
          ) : (
            <button className="primary" onClick={() => openModal('newGame')}>
              New Game
            </button>
          )}
        </div>
      )}

      {/* Top: player status, turn timer, settings */}
      <PlayerStrip />
      <TurnTimer key={`${game.current}:${turnSeconds ?? 'off'}`} width={timerWidth} />
      {online && (
        <div className={`turn-banner ${myTurn ? 'mine' : ''}`} style={{ '--accent': COLORS[game.current] } as CSSProperties}>
          {myTurn ? 'Your turn' : `${cap(game.current)}'s turn`}
        </div>
      )}
      <SiegeBanner />
      <EliminationToast />
      <button className="gear" onClick={() => openModal('settings')} aria-label="Settings">
        <CogIcon size={20} />
      </button>
      {online && (
        <button className="leave-btn" onClick={exitToLobby}>
          Leave
        </button>
      )}

      {combat && combatNonce > 0 && (
        <CombatRoll key={combatNonce} combat={combat} runId={combatNonce} />
      )}

      {/* Bottom control frame — fixed width; right column: ritual · (i) · button */}
      <div className="hud-bottom">
        <div className="tray">
          <div className="dice">
            {game.dice.length === 0 && <span className="muted">roll to begin</span>}
            {game.dice.map((d) => {
              const state = d.discarded
                ? 'discarded'
                : d.usedBy
                  ? 'used'
                  : d.id === selectedDieId
                    ? 'selected'
                    : 'idle';
              const click = !myTurn
                ? undefined
                : phase === 'discard' && !d.discarded
                  ? () => discard(d.id)
                  : phase === 'act' && !d.discarded && !d.usedBy
                    ? () => selectDie(d.id)
                    : undefined;
              return (
                <PipDie
                  key={d.id}
                  value={d.value}
                  kind={d.kind}
                  state={state}
                  onClick={click}
                  title={`${d.kind[0].toUpperCase()}${d.kind.slice(1)} die`}
                />
              );
            })}
          </div>
        </div>

        <div className="divider" />

        <div className="selinfo">
          {selectedUnit ? (
            <>
              <strong>{KIND_LABEL[selectedUnit.kind]}</strong>
              {selectedUnit.kind === 'mage' && (
                <div className="muted">
                  carrying {selectedUnit.carried} · activated {selectedUnit.activated} · attack d
                  {magePowerDie(selectedUnit.activated)}
                </div>
              )}
              <div className="unit-actions">
                {actions.collect && <button onClick={collectStones}>Collect</button>}
                {actions.activate && <button onClick={activateStones}>Activate</button>}
                {actions.resurrect && <button onClick={doResurrect}>Resurrect</button>}
                {actions.ritual && <button onClick={doRitual}>Begin Ritual</button>}
              </div>
            </>
          ) : phase === 'discard' ? (
            <strong>{discardLabel}</strong>
          ) : (
            <span className="muted">No unit selected</span>
          )}
        </div>

        <div className="spacer" />

        <span className="turn-chip tip" data-tip="Round — advances when play returns to the first player">
          Turn {game.turn ?? 1}
        </span>

        <span
          className="grave-bank tip"
          data-tip={`Gravestone bank: ${graveBank} left to place · up to ${graveCap} on the board (3 per active player).`}
        >
          <GraveIcon size={18} />
          {graveBank}
        </span>

        {game.ritual && (
          <span className="ritual-flag" title="A ritual is in progress">
            Ritual · {game.ritual.player}
          </span>
        )}

        <span className="info" tabIndex={0} aria-label={phaseHint}>
          i<span className="tooltip">{phaseHint}</span>
        </span>

        <div className="actions">
          {!myTurn ? (
            <span className="muted">
              {cap(game.current)}
              {bots[game.current] ? ' (bot)' : ''} is playing…
            </span>
          ) : (
            <>
              {phase === 'roll' && (
                <button className="primary" onClick={roll}>
                  Roll Dice
                </button>
              )}
              {phase === 'act' && (
                <button className="primary" onClick={endTurn}>
                  End Turn
                </button>
              )}
              {phase === 'act' && !hasPlayLeft(game) && <span className="muted">No plays left</span>}
            </>
          )}
        </div>
      </div>

      <div className="log">
        {game.log.slice(-4).map((line, i, arr) => (
          <div key={i} className={i === arr.length - 1 ? 'log-live' : ''}>
            {line}
          </div>
        ))}
      </div>

      <Modals />
    </div>
  );
}
