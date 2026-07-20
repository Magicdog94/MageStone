import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { attackOptions, unitActions, useGame } from '../store';
import { useNet } from '../net/useNet';
import { usePlayerLabel } from './playerNames';
import { COLORS } from '../three/coords';
import {
  boltTargets,
  canBolt,
  canNova,
  canUndoDiscard,
  discardsLeft,
  gravestoneBank,
  gravestoneCapacity,
  hasPlayLeft,
  mageActionDieValue,
  magePowerDie,
  novaVictims,
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
import { Tutorial } from './Tutorial';
import { FeedbackModal } from './FeedbackModal';
import { BookIcon, CameraLockIcon, CogIcon, GraveIcon } from './Icons';

const KIND_LABEL = { warrior: 'Warrior', mage: 'Mage', priest: 'Priest' } as const;
/** The die colours, lifted for text on the dark tray — the kind labels under
 *  the dice wear their die's colour (mirrors ui/Die.tsx STYLE). */
const DIE_LABEL_COLOR = { mage: '#7ba4e4', priest: '#55bd80', warrior: '#e07a75' } as const;
const KIND_ABILITY = {
  warrior: 'Attacks adjacent enemies · coordinates 1–3d6',
  mage: 'Collects & activates stones · power die d6→d12→d20',
  priest: 'No attack · resurrects Warriors · Nexus ritual',
} as const;

/** Camera-lock toggle: keep the camera at its start pose and rotate the BOARD
 *  toward whichever human is playing (bots don't move the view). */
function CamFixToggle() {
  const on = useGame((s) => s.settings.cameraFix);
  const setCameraFix = useGame((s) => s.setCameraFix);
  return (
    <button
      className={`cam-toggle${on ? ' on' : ''}`}
      onClick={() => setCameraFix(!on)}
      aria-pressed={on}
      aria-label="Camera lock"
      title={on ? 'Camera lock ON — the board turns to face each player' : 'Camera lock OFF — click to fix the camera and turn the board instead'}
    >
      <CameraLockIcon size={20} />
    </button>
  );
}

/** Always-visible turn structure — each stage ticks off as the turn advances. */
function PhaseTrack() {
  const game = useGame((s) => s.game);
  if (game.winner) return null;
  const phase = game.turnPhase;
  const dleft = phase === 'discard' ? discardsLeft(game) : 0;
  const steps = [
    { key: 'roll', label: '1 · Roll 5 dice', done: phase !== 'roll', active: phase === 'roll' },
    {
      key: 'discard',
      label: phase === 'discard' ? `2 · Discard ${dleft} more` : '2 · Discard 2',
      done: phase === 'act',
      active: phase === 'discard',
    },
    { key: 'act', label: '3 · Move & act', done: false, active: phase === 'act' },
  ];
  return (
    <div className="phase-track" aria-label="Turn phases">
      {steps.map((s) => (
        <span key={s.key} className={`phase-step${s.done ? ' done' : ''}${s.active ? ' active' : ''}`}>
          {s.done ? '✓ ' : ''}
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** "Red rolls 15 · Green rolls 4" — shown only once the physical combat dice
 *  have settled face-up (set by three/Dice.tsx::CombatDice on settle). */
function CombatAnnounce() {
  const roll = useGame((s) => s.combatRoll);
  const intro = useGame((s) => s.combatIntro);
  const label = usePlayerLabel();
  // Numbers once the dice settle; before that, WHO fights WHOM with WHAT.
  if (roll) {
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
  if (!intro) return null;
  if (intro.kind === 'nova') {
    return (
      <div className="combat-announce" role="status">
        <span className="ca-side" style={{ '--accent': COLORS[intro.attacker] } as CSSProperties}>
          <span className="ca-name">{label(intro.attacker)} Mage</span>
        </span>
        <span className="ca-dot">unleashes</span>
        <span className="ca-nova">NOVA</span>
        <span className="ca-dot">·</span>
        <span className="ca-faces">
          {intro.count} unit{intro.count === 1 ? '' : 's'} consumed · nothing can repel
        </span>
      </div>
    );
  }
  if (intro.kind === 'bolt') {
    return (
      <div className="combat-announce" role="status">
        <span className="ca-side" style={{ '--accent': COLORS[intro.attacker] } as CSSProperties}>
          <span className="ca-name">{label(intro.attacker)} Mage</span>
        </span>
        <span className="ca-dot">bolts</span>
        <span className="ca-side" style={{ '--accent': COLORS[intro.defender] } as CSSProperties}>
          <span className="ca-name">
            {label(intro.defender)} {KIND_LABEL[intro.defenderKind]}
          </span>
        </span>
        <span className="ca-dot">·</span>
        <span className="ca-faces">
          {intro.defenderKind === 'mage'
            ? `${intro.attackFaces} vs ${intro.defenseFaces} — only a Mage can repel`
            : 'no defence'}
        </span>
      </div>
    );
  }
  return (
    <div className="combat-announce" role="status">
      <span className="ca-side" style={{ '--accent': COLORS[intro.attacker] } as CSSProperties}>
        <span className="ca-name">
          {label(intro.attacker)} {KIND_LABEL[intro.attackerKind]}
          {intro.count > 1 ? ` ×${intro.count}` : ''}
        </span>
      </span>
      <span className="ca-dot">attacks</span>
      <span className="ca-side" style={{ '--accent': COLORS[intro.defender] } as CSSProperties}>
        <span className="ca-name">
          {label(intro.defender)} {KIND_LABEL[intro.defenderKind]}
        </span>
      </span>
      <span className="ca-dot">·</span>
      <span className="ca-faces">
        {intro.attackFaces} vs {intro.defenseFaces} · ties re-roll
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
  const undoDiscard = useGame((s) => s.undoDiscard);
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
  const boltMode = useGame((s) => s.boltMode);
  const setBoltMode = useGame((s) => s.setBoltMode);
  const castNova = useGame((s) => s.castNova);
  const label = usePlayerLabel();
  // A bot's turn is never "my turn" — the BotDriver plays it; humans watch.
  const myTurn = !bots[game.current] && (!online || game.current === myColor);
  const exitToLobby = () => {
    useNet.getState().leaveRoom();
    useNet.setState({ screen: 'lobby' });
  };

  // The Rule Book overlay, opened from the golden book beside the toggles.
  const [showRules, setShowRules] = useState(false);
  // Alpha feedback: a persistent pill during play, and an automatic prompt
  // shortly after each game ends (never during the tutorial).
  const [showFeedback, setShowFeedback] = useState(false);
  const tutorial = useGame((s) => s.tutorial);
  const fbPrompted = useRef(false);
  useEffect(() => {
    if (!game.winner) {
      fbPrompted.current = false;
      return;
    }
    if (tutorial || fbPrompted.current) return;
    fbPrompted.current = true;
    const t = window.setTimeout(() => setShowFeedback(true), 2600);
    return () => window.clearTimeout(t);
  }, [game.winner, tutorial]);
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
      <PhaseTrack />
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
      {/* golden Rule Book — sits in the top-right row with music/fullscreen */}
      <button className="book-toggle" onClick={() => setShowRules(true)} aria-label="Rule Book" title="Rule Book">
        <BookIcon size={20} />
      </button>
      {/* camera lock: fixed camera + the board turns to face each human player */}
      <CamFixToggle />
      {showRules && <Tutorial onClose={() => setShowRules(false)} />}
      {/* always-available bug/feedback entry point during a match */}
      {!tutorial && (
        <button className="feedback-btn" onClick={() => setShowFeedback(true)}>
          Feedback
        </button>
      )}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
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
            {(() => {
              // Kind tags under the dice, in each die's colour: M · P · W1 W2
              // W3 — so players always know which die drives which unit.
              let warriorNo = 0;
              return game.dice.map((d) => {
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
                const label =
                  d.kind === 'mage' ? 'M' : d.kind === 'priest' ? 'P' : `W${++warriorNo}`;
                return (
                  <div className="die-col" key={d.id}>
                    <PipDie
                      value={d.value}
                      kind={d.kind}
                      state={state}
                      onClick={click}
                      size={mobile ? 34 : 48}
                      title={`${d.kind[0].toUpperCase()}${d.kind.slice(1)} die`}
                    />
                    <span className="die-label" style={{ color: DIE_LABEL_COLOR[d.kind] }}>
                      {label}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        <div className="divider" />

        <div className="selinfo">
          {selectedUnit ? (
            <>
              <strong title={KIND_ABILITY[selectedUnit.kind]}>{KIND_LABEL[selectedUnit.kind]}</strong>
              <div className="muted unit-ability">{KIND_ABILITY[selectedUnit.kind]}</div>
              {selectedUnit.kind === 'mage' && (
                <div className="muted">
                  carrying {selectedUnit.carried} · activated {selectedUnit.activated} · attack d
                  {magePowerDie(selectedUnit.activated)}
                </div>
              )}
              {/* the assigned die + how far this unit can still march */}
              {(() => {
                const die = game.dice.find((d) => d.id === selectedDieId);
                const moved = game.unitsMovedThisTurn.includes(selectedUnit.id);
                return die && !moved ? (
                  <div className="muted">
                    die {die.value} — move up to {die.value} squares
                  </div>
                ) : null;
              })()}
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
                {/* Mage sorcery: BOLT (ranged, 1 stone) arms click-to-target
                    mode; NOVA (3 stones) blasts everything within 1 square. */}
                {myTurn && selectedUnit.kind === 'mage' && canBolt(game, selectedUnit.id) && (
                  <button
                    className={`primary attack-btn${boltMode ? ' arming' : ''}`}
                    onClick={() => setBoltMode(!boltMode)}
                    disabled={boltTargets(game, selectedUnit.id).length === 0}
                    title={
                      boltTargets(game, selectedUnit.id).length === 0
                        ? 'No enemies within range'
                        : 'Spend 1 activated stone — click any enemy in range. Only an enemy Mage can repel. The stone lands on the target square, still activated.'
                    }
                  >
                    {boltMode ? 'Pick a target…' : 'Bolt'}
                    <small>1 stone · range {mageActionDieValue(game, selectedUnit.id)}</small>
                  </button>
                )}
                {myTurn && selectedUnit.kind === 'mage' && canNova(game, selectedUnit.id) && (
                  <button
                    className="primary attack-btn"
                    onClick={() => castNova()}
                    title="Spend 3 activated stones — destroys EVERY unit within 1 square (diagonals too, friend or foe). Nothing can repel it. The stones scatter nearby, still activated."
                  >
                    Nova
                    <small>3 stones · {novaVictims(game, selectedUnit.id).length} caught</small>
                  </button>
                )}
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
              {/* mis-clicked a discard? take it back — until anything moves/acts
                  (available in the hands-on tutorial too — it teaches it) */}
              {canUndoDiscard(game) && (
                <button
                  className="ghost"
                  onClick={undoDiscard}
                  title="Take back the last discarded die"
                >
                  Undo
                </button>
              )}
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
