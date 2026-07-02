// Executes AI turns. Mounted once on the game screen; watches the store and,
// whenever the current player is a bot this client controls, performs ONE step
// (roll / one discard / one move / one action / end turn) after a human-like
// pause. Every step goes through the normal store actions — the same code path
// as a click — so dice physics, selection flashes, combat animations and the
// online state broadcast all behave exactly as they do for a human player.
import { useEffect } from 'react';
import { useGame } from '../store';
import { chooseAction, chooseDiscard, type BotAction } from '../game/bot';

/** Pause before each bot step, ms (a touch quicker between discards). */
const stepDelay = (phase: string) => (phase === 'discard' ? 550 : 750) + Math.random() * 350;

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
  const game = useGame((s) => s.game);
  const rolling = useGame((s) => s.rolling);
  const bots = useGame((s) => s.bots);
  const botController = useGame((s) => s.botController);

  useEffect(() => {
    const level = bots[game.current];
    if (!level || !botController || game.winner || rolling) return;

    const timer = setTimeout(() => {
      const s = useGame.getState();
      const g = s.game;
      const lvl = s.bots[g.current];
      if (!lvl || !s.botController || g.winner || s.rolling) return;

      if (g.turnPhase === 'roll') {
        s.roll();
        return;
      }
      if (g.turnPhase === 'discard') {
        const id = chooseDiscard(g, lvl) ?? g.dice.find((d) => !d.discarded)?.id;
        if (id) s.discard(id);
        return;
      }
      if (g.turnPhase === 'act') {
        const action = chooseAction(g, lvl);
        if (!action) {
          s.endTurn();
          return;
        }
        executeAction(action);
        // The effect only re-runs when the game changes, so a rejected pick
        // must not dead-end the turn — if the engine said no, end it now.
        if (useGame.getState().game === g) useGame.getState().endTurn();
      }
    }, stepDelay(game.turnPhase));

    return () => clearTimeout(timer);
    // Re-runs after every game change → each store mutation schedules the next step.
  }, [game, rolling, bots, botController]);

  return null;
}
