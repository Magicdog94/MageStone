// Executes AI turns. Mounted once on the game screen; whenever the current
// player is a bot this client controls, performs ONE step (roll / one discard /
// one move / one action / end turn) with a human-like pause between steps.
// Every step goes through the normal store actions — the same code path as a
// click — so dice physics, selection flashes, combat animations and the online
// state broadcast all behave exactly as they do for a human player.
//
// DESIGN NOTE: this is an interval TICKER, not a state-change-driven effect.
// The old effect-driven loop could dead-end forever if a step threw or the
// engine rejected a pick without changing state (nothing re-triggered it) —
// long 4-player bot games froze. The ticker re-reads fresh state every beat,
// so no single bad step can ever stall the game; a step that fails or is
// rejected simply ends the turn.
import { useEffect, useRef } from 'react';
import { useGame } from '../store';
import { chooseAction, chooseDiscard, type BotAction } from '../game/bot';

/** Pause between bot steps, ms (a touch quicker between discards). */
const stepDelay = (phase: string) => (phase === 'discard' ? 550 : 800);

function executeAction(a: BotAction): void {
  const s = useGame.getState();
  switch (a.type) {
    case 'move':
      s.selectUnit(a.unitId);
      s.selectDie(a.dieId);
      s.moveTo(a.dest);
      break;
    case 'attack':
      s.selectUnit(a.unitId);
      s.attack(a.targetId);
      break;
    case 'bolt':
      s.selectUnit(a.unitId);
      s.castBolt(a.targetId);
      break;
    case 'nova':
      s.selectUnit(a.unitId);
      s.castNova();
      break;
    case 'collect':
      s.selectUnit(a.unitId);
      s.collectStones();
      break;
    case 'activate':
      s.selectUnit(a.unitId);
      s.activateStones();
      break;
    case 'resurrect':
      s.selectUnit(a.unitId);
      s.doResurrect();
      break;
    case 'ritual':
      s.selectUnit(a.unitId);
      s.doRitual();
      break;
  }
}

export function BotDriver() {
  // A boolean regime flag (not the game object) — the interval below reads
  // fresh state each tick, so it survives bot-to-bot turn handoffs untouched.
  const enabled = useGame((s) => !!s.bots[s.game.current] && s.botController && !s.game.winner);
  const lastStep = useRef(0);
  // A momentous play (attack, sorcery, ritual) is HELD briefly before it is
  // executed — the pause reads as the bot weighing the decision, like a human
  // hovering before committing. The action is chosen once and cached; `sig`
  // drops it if the game state moved on underneath.
  const pending = useRef<{ action: BotAction; at: number; sig: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const tick = window.setInterval(() => {
      // Heartbeat breadcrumbs (visible via window.__botTicks/__botLast in dev
      // tools) — used to diagnose "bot stopped playing" reports.
      const dbg = window as unknown as { __botTicks?: number; __botLast?: string };
      dbg.__botTicks = (dbg.__botTicks ?? 0) + 1;
      const s = useGame.getState();
      const g = s.game;
      const lvl = s.bots[g.current];
      if (!lvl || !s.botController || g.winner || s.rolling || s.tutorial) {
        dbg.__botLast = `guard:${!lvl ? 'lvl' : !s.botController ? 'ctl' : g.winner ? 'win' : s.rolling ? 'rolling' : 'tutorial'}`;
        return;
      }
      const now = performance.now();
      if (now - lastStep.current < stepDelay(g.turnPhase) + Math.random() * 300) return;
      lastStep.current = now;
      dbg.__botLast = `step:${g.turnPhase}:${g.current}:${Date.now()}`;
      try {
        if (g.turnPhase === 'roll') {
          s.roll();
          return;
        }
        if (g.turnPhase === 'discard') {
          const id = chooseDiscard(g, lvl) ?? g.dice.find((d) => !d.discarded)?.id;
          if (id) s.discard(id);
          // Rejected or nothing to discard → never dead-end the turn.
          if (useGame.getState().game === g) s.endTurn();
          return;
        }
        // act
        const sig = `${g.current}:${g.turnPhase}:${g.dice.filter((d) => !d.discarded && !d.usedBy).length}:${g.units.length}`;
        if (pending.current) {
          if (pending.current.sig !== sig) {
            pending.current = null; // the board moved on — re-decide
          } else if (now < pending.current.at) {
            return; // still "thinking" over the big play
          } else {
            const a = pending.current.action;
            pending.current = null;
            executeAction(a);
            if (useGame.getState().game === g) s.endTurn();
            return;
          }
        }
        const action = chooseAction(g, lvl);
        if (!action) {
          s.endTurn();
          return;
        }
        // Hold the dramatic plays for a human-length beat before committing.
        const big =
          action.type === 'attack' ||
          action.type === 'bolt' ||
          action.type === 'nova' ||
          action.type === 'ritual';
        if (big) {
          pending.current = { action, at: now + 900 + Math.random() * 900, sig };
          return;
        }
        executeAction(action);
        if (useGame.getState().game === g) s.endTurn();
      } catch (e) {
        console.warn('MageStone: bot step failed — ending the turn.', e);
        try {
          useGame.getState().endTurn();
        } catch {
          /* keep ticking; the next beat retries from fresh state */
        }
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [enabled]);

  return null;
}
