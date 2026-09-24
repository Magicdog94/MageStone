import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { activeRestrict, attackOptions, tutAllows, unitActions, useGame } from '../store';
import { useNet } from '../net/useNet';
import { usePlayerLabel } from './playerNames';
import { COLORS } from '../three/coords';
import {
  boltTargets,
  budgetOf,
  canBolt,
  canNova,
  gameOver,
  gravestoneBank,
  gravestoneCapacity,
  hasPlayLeft,
  mageActionDieValue,
  magePowerDie,
  movesLeft,
  novaVictims,
  ritualHoldOf,
  unitById,
} from '../game/rules';
import { useTokenUrl } from '../three/tokens';
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
const KIND_ABILITY = {
  warrior: 'Attacks adjacent enemies · coordinates 1–3d6',
  mage: 'Collects & activates stones · power die d6→d12→d20',
  priest: 'Cannot attack, but kills what attacks it · resurrects · Nexus ritual',
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

/** Always-visible turn structure — the whole go, then play passes. */
function PhaseTrack() {
  const game = useGame((s) => s.game);
  if (gameOver(game)) return null;
  const phase = game.turnPhase;
  const squares = movesLeft(game, game.current);
  const steps = [
    {
      key: 'act',
      label: `1 · Move any units — ${squares} square${squares === 1 ? '' : 's'} left`,
      done: false,
      active: phase === 'act',
    },
    {
      key: 'units',
      label: '2 · Each unit may act once — attacking costs no squares',
      done: false,
      active: false,
    },
    { key: 'pass', label: '3 · End your go — spare squares are lost', done: false, active: false },
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
            ? `${intro.attackFaces} vs ${intro.defenseFaces} — the Mage tries to block`
            : 'no defence — only a Mage can block'}
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
  const endActivation = useGame((s) => s.endActivation);
  const undoActivation = useGame((s) => s.undoActivation);
  const canUndo = useGame((s) => s.undoPoint !== null);
  const collectStones = useGame((s) => s.collectStones);
  const activateStones = useGame((s) => s.activateStones);
  const doResurrect = useGame((s) => s.doResurrect);
  const doRitual = useGame((s) => s.doRitual);
  const openModal = useGame((s) => s.openModal);
  const turnSeconds = useGame((s) => s.settings.turnSeconds);
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
  const netStatus = useNet((s) => s.status);
  const netRoom = useNet((s) => s.room);
  const netDown = netStatus !== 'online' || !netRoom;
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
  // A primitive, so the effect depends on "has it ended" rather than the whole
  // game object (which changes on every activation).
  const finished = gameOver(game);
  useEffect(() => {
    if (!finished) {
      fbPrompted.current = false;
      return;
    }
    if (tutorial || fbPrompted.current) return;
    fbPrompted.current = true;
    const t = window.setTimeout(() => setShowFeedback(true), 2600);
    return () => window.clearTimeout(t);
  }, [finished, tutorial]);
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
  // Tutorial guardrails: during a hands-on task only the taught buttons render.
  const tutRestrict = useGame(activeRestrict);
  const actions = unitActions(game, selectedUnitId, tutRestrict);
  const attackOpts = myTurn ? attackOptions(game, selectedUnitId, tutRestrict) : [];
  const phase = game.turnPhase;

  // The go's allowance for whoever is acting. Squares are the only currency
  // now — how many units join in is up to the player.
  const squaresLeft = movesLeft(game, game.current);
  const graveBank = gravestoneBank(game);
  const graveCap = gravestoneCapacity(game);
  const graveUrl = useTokenUrl('gravestone');

  return (
    <div className="hud">
      {finished && (
        <div
          className="winner"
          style={{ '--accent': game.winner ? COLORS[game.winner] : 'var(--gold)' } as CSSProperties}
        >
          {/* name the METHOD (MageStone / Ritual / Conquest), or the stalemate */}
          <span className="winner-eyebrow">
            {game.winMethod === 'Draw'
              ? 'Stalemate'
              : game.winMethod
                ? `${game.winMethod} Victory`
                : 'Victory'}
          </span>
          <span className="winner-name">
            {game.winner
              ? `${label(game.winner)} wins`
              : 'A draw — neither side can break the siege'}
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
          data-tip={`Gravestone bank: ${graveBank} of ${graveCap} left. It never refills — every Warrior death and every resurrection spends one for good.`}
        >
          {graveUrl ? (
            <img className="grave-token" src={graveUrl} alt="" width={22} height={22} />
          ) : (
            <GraveIcon size={18} />
          )}
          {graveBank}
        </span>
      </div>
      {online &&
        (netDown ? (
          // The phone or browser dropped the connection while the player was
          // elsewhere; useNet is already reconnecting them to their seat.
          <div className="turn-banner net-down" role="status">
            {netRoom ? 'Connection lost — reconnecting…' : 'This match is no longer on the server'}
          </div>
        ) : (
          <div className={`turn-banner ${myTurn ? 'mine' : ''}`} style={{ '--accent': COLORS[game.current] } as CSSProperties}>
            {myTurn ? 'Your turn' : `${label(game.current)}'s turn`}
          </div>
        ))}

      <SiegeBanner />
      <EliminationToast />
      {/* no Settings during the guided tutorial — its Main Menu / New Game
          buttons would strand the coach; "Skip tutorial" is the exit */}
      {!tutorial && (
        <button className="gear" onClick={() => openModal('settings')} aria-label="Settings">
          <CogIcon size={20} />
        </button>
      )}
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
          {/* The go's allowance: squares to spend between as many units as
              the player likes. Pips go out as they are walked (a Bolt spends
              them too), and whatever is still lit when the go ends is lost. */}
          <div className="budget-tray" aria-label="Movement left this go">
            <div className="sq-row">
              {Array.from({ length: budgetOf(game) }, (_, i) => (
                <span
                  key={i}
                  className={`sq-pip${i < squaresLeft ? '' : ' spent'}`}
                  style={{ '--accent': COLORS[game.current] } as CSSProperties}
                />
              ))}
            </div>
            <div className="budget-read">
              <strong>{squaresLeft}</strong> square{squaresLeft === 1 ? '' : 's'} of movement left
            </div>
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
                  carrying {selectedUnit.carried} unactivated · {selectedUnit.activated} Activated
                  · attack d{magePowerDie(selectedUnit.activated)}
                </div>
              )}
              {/* how far this unit can still march out of the go's squares */}
              {(() => {
                const moved = game.unitsMovedThisTurn.includes(selectedUnit.id);
                // A task with no movement in it hides the "move up to N" hint.
                if (tutRestrict?.dests && tutRestrict.dests.length === 0) return null;
                return !moved && squaresLeft > 0 ? (
                  <div className="muted">
                    move up to {squaresLeft} square{squaresLeft === 1 ? '' : 's'} — whatever you
                    walk comes off this go
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
                    mode; NOVA (4 stones) blasts every ENEMY within 1 square. */}
                {myTurn && selectedUnit.kind === 'mage' && canBolt(game, selectedUnit.id) && tutAllows(tutRestrict, 'bolt') && (
                  <button
                    className={`primary attack-btn${boltMode ? ' arming' : ''}`}
                    onClick={() => setBoltMode(!boltMode)}
                    disabled={boltTargets(game, selectedUnit.id).length === 0}
                    title={
                      boltTargets(game, selectedUnit.id).length === 0
                        ? 'No enemies within range'
                        : 'Spend 1 Activated stone — click any enemy in range. Only an enemy Mage can block it (its power die against yours); nothing else gets a defence roll. Blocked or not, the stone lands on the target square, still Activated.'
                    }
                  >
                    {boltMode ? 'Pick a target…' : 'Bolt'}
                    <small>1 stone · range {mageActionDieValue(game, selectedUnit.id)}</small>
                  </button>
                )}
                {myTurn && selectedUnit.kind === 'mage' && canNova(game, selectedUnit.id) && tutAllows(tutRestrict, 'nova') && (
                  <button
                    className="primary attack-btn"
                    onClick={() => castNova()}
                    title="Spend 4 Activated stones — destroys every ENEMY unit in the 8 surrounding squares (diagonals too). No defence rolls; friendly units are unharmed. The 4 stones land on the diagonals, still Activated."
                  >
                    Nova
                    <small>4 stones · {novaVictims(game, selectedUnit.id).length} enemies caught</small>
                  </button>
                )}
                {actions.collect && <button onClick={collectStones}>Collect</button>}
                {actions.activate && <button onClick={activateStones}>Activate</button>}
                {actions.resurrect && <button onClick={doResurrect}>Resurrect</button>}
                {actions.ritual && <button onClick={doRitual}>Begin Ritual</button>}
              </div>
            </>
          ) : phase === 'act' && !hasPlayLeft(game) ? (
            <strong>Nothing left to do this go — end your turn</strong>
          ) : (
            <span className="muted">No unit selected</span>
          )}
        </div>

        <div className="spacer" />

        {game.ritual &&
          (() => {
            // How many more times play has to come back round to the ritualist:
            // two in a heads-up game, one with four players.
            const left = ritualHoldOf(game) - (game.ritual.returns ?? 0);
            return (
              <span
                className="ritual-flag"
                title={
                  `${label(game.ritual.player)}'s Rite of the Nexus completes when play has come ` +
                  `back round to them ${left === 1 ? 'once more' : `${left} more times`}. ` +
                  `Reach any Nexus square, or kill the Priest, before then.`
                }
              >
                Ritual · {label(game.ritual.player)} ·{' '}
                {left === 1 ? 'wins on their next go' : 'wins on their go after next'}
              </span>
            );
          })()}

        <div className="actions">
          {!myTurn ? (
            <span className="muted">
              {label(game.current)}
              {bots[game.current] ? ' (bot)' : ''} is playing…
            </span>
          ) : (
            <>
              {phase === 'act' && tutAllows(tutRestrict, 'endTurn') && (
                <>
                  {tutAllows(tutRestrict, 'undo') && (
                    <button
                      className="ghost"
                      onClick={undoActivation}
                      disabled={!canUndo}
                      title={
                        canUndo
                          ? 'Take your whole go back and start it again'
                          : game.activationDice.length === 0
                            ? 'Nothing to undo yet — you have not moved or acted'
                            : 'The dice have been rolled — a resolved fight cannot be taken back'
                      }
                    >
                      Undo
                    </button>
                  )}
                  <button
                    className="primary"
                    onClick={endActivation}
                    title={
                      game.activationDice.length > 0
                        ? 'End your go and pass play on — any squares left over are lost'
                        : 'Nothing committed — this passes, and the whole go is forfeit'
                    }
                  >
                    End Turn
                  </button>
                </>
              )}
              {phase === 'act' && !hasPlayLeft(game) && (
                <span className="muted">Nothing left to do this go</span>
              )}
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
