import { useEffect, useState, type CSSProperties } from 'react';
import { attackOptions, unitActions, useGame } from '../store';
import { useNet } from '../net/useNet';
import { usePlayerLabel } from './playerNames';
import { COLORS } from '../three/coords';
import {
  discardsLeft,
  gravestoneBank,
  gravestoneCapacity,
  hasPlayLeft,
  magePowerDie,
  unitById,
} from '../game/rules';
import { useTokenUrl } from '../three/tokens';
import { PipDie } from './Die';
import { EliminationToast } from './EliminationToast';
import { PadControls } from './PadControls';
import { PlayerStrip } from './PlayerStrip';
import { SiegeBanner } from './SiegeBanner';
import { TurnTimer } from './TurnTimer';
import { Modals } from './Modals';
import { CogIcon, GraveIcon } from './Icons';

const KIND_LABEL = { warrior: 'Warrior', mage: 'Mage', priest: 'Priest' } as const;

/** "Red rolls 15 · Green rolls 4" — shown only once the physical combat dice
 *  have settled face-up (set by three/Dice.tsx::CombatDice on settle). */
function CombatAnnounce() {
  const roll = useGame((s) => s.combatRoll);
  const label = usePlayerLabel();
  if (!roll) return null;
  return (
    <div className="combat-announce" key={roll.nonce} role="status">
      <span className="ca-side" style={{ '--accent': COLORS[roll.attacker] } as CSSProperties}>
        <span className="ca-name">{label(roll.attacker)}</span> rolls{' '}
        <span className="ca-roll">{roll.attackRoll}</span>
      </span>
      <span className="ca-dot">·</span>
      <span className="ca-side" style={{ '--accent': COLORS[roll.defender] } as CSSProperties}>
        <span className="ca-name">{label(roll.defender)}</span> rolls{' '}
        <span className="ca-roll">{roll.defenseRoll}</span>
      </span>
    </div>
  );
}

export function HUD() {
  const game = useGame((s) => s.game);
  const selectedUnitId = useGame((s) => s.selectedUnitId);
  const selectedDieId = useGame((s) => s.selectedDieId);
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
  const mobile = useGame((s) => s.settings.layout === 'mobile');
  const online = useGame((s) => s.online);
  const myColor = useGame((s) => s.myColor);
  const bots = useGame((s) => s.bots);
  const attack = useGame((s) => s.attack);
  const label = usePlayerLabel();
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
  const attackOpts = myTurn ? attackOptions(game, selectedUnitId) : [];
  const phase = game.turnPhase;

  const dleft = phase === 'discard' ? discardsLeft(game) : 0;
  const discardLabel = `Discard ${dleft} ${dleft === 1 ? 'die' : 'dice'}`;

  const graveBank = gravestoneBank(game);
  const graveCap = gravestoneCapacity(game);
  const graveUrl = useTokenUrl('gravestone');

  return (
    <div className="hud">
      {game.winner && (
        <div className="winner" style={{ '--accent': COLORS[game.winner] } as CSSProperties}>
          {/* name the METHOD of victory (MageStone / Ritual / Conquest) */}
          <span className="winner-eyebrow">
            {game.winMethod ? `${game.winMethod} Victory` : 'Victory'}
          </span>
          <span className="winner-name">{`${label(game.winner)} wins`}</span>
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

      {/* Top: player status, turn timer, round + gravestone-bank chips, settings */}
      <PlayerStrip />
      <TurnTimer key={`${game.current}:${turnSeconds ?? 'off'}`} width={timerWidth} />
      <div className="top-chips">
        <span className="turn-chip tip" data-tip="Round — advances when play returns to the first player">
          Turn {game.turn ?? 1}
        </span>
        <span
          className="grave-bank tip"
          data-tip={`Gravestone bank: ${graveBank} left to place · up to ${graveCap} on the board (3 per active player).`}
        >
          {graveUrl ? (
            <img className="grave-token" src={graveUrl} alt="" width={22} height={22} />
          ) : (
            <GraveIcon size={18} />
          )}
          {graveBank}
        </span>
      </div>
      {online && (
        <div className={`turn-banner ${myTurn ? 'mine' : ''}`} style={{ '--accent': COLORS[game.current] } as CSSProperties}>
          {myTurn ? 'Your turn' : `${label(game.current)}'s turn`}
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

      {/* attacks roll REAL physics dice on the table (Dice.tsx::CombatDice);
          the numbers are announced here only once those dice settle face-up */}
      <CombatAnnounce />

      {/* Bottom control frame — fixed width; right column: ritual · button */}
      <div className="hud-bottom">
        <div className="tray">
          <div className="dice">
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
                  size={mobile ? 34 : 48}
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
                {/* Attack from the bar — no need to click the enemy on the board.
                    Warriors offer Single/Double/Triple (coordinated); a Mage a
                    lone Attack with its power die. */}
                {attackOpts.map((o) => (
                  <button
                    key={o.count}
                    className="primary attack-btn"
                    onClick={() => attack(o.targetId, o.attackerIds)}
                    title={`Win chance ${Math.round(o.odds * 100)}%`}
                  >
                    {o.label}
                    <small>{Math.round(o.odds * 100)}%</small>
                  </button>
                ))}
                {actions.collect && <button onClick={collectStones}>Collect</button>}
                {actions.activate && <button onClick={activateStones}>Activate</button>}
                {actions.resurrect && <button onClick={doResurrect}>Resurrect</button>}
                {actions.ritual && <button onClick={doRitual}>Begin Ritual</button>}
              </div>
            </>
          ) : phase === 'discard' ? (
            <strong>{discardLabel}</strong>
          ) : phase === 'roll' ? (
            /* pre-roll: name whose turn it is right here, where the eyes are */
            <>
              <strong style={{ color: COLORS[game.current] }}>{label(game.current)} to roll</strong>
              <div className="muted">Roll to begin</div>
            </>
          ) : (
            <span className="muted">No unit selected</span>
          )}
        </div>

        <div className="spacer" />

        {game.ritual && (
          <span className="ritual-flag" title="A ritual is in progress">
            Ritual · {game.ritual.player}
          </span>
        )}

        <div className="actions">
          {!myTurn ? (
            <span className="muted">
              {label(game.current)}
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

      {/* (the running-commentary log box is gone — the engine still records
          game.log for toasts/debugging, it just isn't rendered) */}
      <PadControls />

      <Modals />
    </div>
  );
}
