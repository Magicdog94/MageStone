// Hints for newer players (playtest, v0.16.0): against an Easy or Medium bot a
// human can ask "what should I do now?". The suggestion is the Hard brain's
// own choice for the human's seat, and the explanation is a plain-words
// reason for it, so the hint teaches WHY as well as WHAT.
import { chooseAction, type BotAction, type BotLevel } from './bot';
import { NEXUS_CELLS, edgeRotation, sameCell } from './board';
import { combatOdds, plannedAttackers, unitById } from './rules';
import type { Cell, GameState, PlayerColor, Unit } from './types';

/** Bot levels that come with the Hint button for the humans they play. */
export const HINT_LEVELS: BotLevel[] = ['easy', 'medium'];

export interface Hint {
  /** The suggested play, or null when the best thing is to End Turn. */
  action: BotAction | null;
  /** One or two plain sentences: what to do and why. */
  text: string;
  /** The cell to light up on the board (destination or target), if any. */
  cell: Cell | null;
}

const KIND: Record<Unit['kind'], string> = { warrior: 'Warrior', priest: 'Priest', mage: 'Mage' };
const near = (a: Cell, b: Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

/** Does `cell` sit on `player`'s home base (the edge their seat owns)? */
function onOwnBase(state: GameState, player: PlayerColor, cell: Cell): boolean {
  return edgeRotation(cell.r, cell.c) === state.seats[player];
}

/** A plain-words reason for `a`, played by `state.current`. */
export function explainHint(state: GameState, a: BotAction | null): Hint {
  const me = state.current;
  const enemyRite = state.ritual && state.ritual.player !== me ? state.ritual : null;
  const riteNote = enemyRite ? 'An enemy Ritual is burning, so breaking it comes first. ' : '';
  if (!a) {
    return {
      action: null,
      cell: null,
      text: 'Nothing useful is left this go. Press End Turn.',
    };
  }
  const u = unitById(state, a.unitId);
  const who = u ? `your ${KIND[u.kind]}` : 'that unit';
  switch (a.type) {
    case 'move': {
      const d = a.dest;
      let why = 'It sets up your next play.';
      if (enemyRite && NEXUS_CELLS.some((c) => sameCell(c, d))) {
        why = 'Landing any unit on the Nexus breaks their Ritual.';
      } else if (enemyRite && unitById(state, enemyRite.priestId) && near(d, unitById(state, enemyRite.priestId)!.cell)) {
        why = 'Next to their Priest, you can attack it and break the Ritual.';
      } else if (u?.kind === 'mage' && u.carried > 0 && onOwnBase(state, me, d)) {
        why = 'Your stones activate as soon as your Mage is home.';
      } else if (u?.kind === 'mage' && state.stones.some((s) => !s.carrier && sameCell(s.cell, d))) {
        why = 'Your Mage can pick up the MageStone there.';
      } else if (u?.kind === 'priest' && state.gravestones.some((g) => sameCell(g.cell, d))) {
        why = 'Your Priest can raise a fallen Warrior from that gravestone.';
      } else if (u?.kind === 'priest' && NEXUS_CELLS.some((c) => sameCell(c, d))) {
        why = 'From the Nexus your Priest can begin the Ritual.';
      } else if (state.units.some((e) => e.owner !== me && near(e.cell, d))) {
        why = 'Next to an enemy it can attack, and every Warrior beside the same enemy adds a die.';
      } else if (u?.kind === 'mage' && state.stones.some((s) => !s.carrier)) {
        why = 'It brings your Mage closer to the MageStones.';
      }
      return { action: a, cell: d, text: `${riteNote}Move ${who} to the glowing square. ${why}` };
    }
    case 'attack': {
      const t = unitById(state, a.targetId);
      const ids = plannedAttackers(state, a.unitId, a.targetId);
      const pct = ids.length ? Math.round(combatOdds(state, ids, a.targetId).win * 100) : 0;
      const many = ids.length > 1 ? ` with ${ids.length} Warriors` : '';
      return {
        action: a,
        cell: t?.cell ?? null,
        text: `${riteNote}Attack the ${t ? KIND[t.kind] : 'enemy'}${many}: about ${pct}% to win.`,
      };
    }
    case 'bolt': {
      const t = unitById(state, a.targetId);
      return {
        action: a,
        cell: t?.cell ?? null,
        text: `${riteNote}Select ${who}, press BOLT and hit the ${t ? KIND[t.kind] : 'enemy'}. It costs one activated stone.`,
      };
    }
    case 'nova':
      return { action: a, cell: null, text: 'Select your Mage and press NOVA: it wipes out every enemy around it.' };
    case 'collect':
      return { action: a, cell: null, text: 'Select your Mage and press Collect to pick up the stone.' };
    case 'activate':
      return { action: a, cell: null, text: 'Select your Mage and press Activate.' };
    case 'resurrect':
      return { action: a, cell: null, text: 'Select your Priest and press Resurrect to bring a Warrior back.' };
    case 'ritual':
      return {
        action: a,
        cell: null,
        text: 'Select your Priest and press Begin Ritual. If nobody breaks it in their next two goes, you win.',
      };
  }
}

/** The Hard brain's suggestion for whoever is to play, explained. */
export function suggestHint(state: GameState): Hint {
  let a: BotAction | null;
  try {
    a = chooseAction(state, 'hard');
  } catch {
    a = null;
  }
  return explainHint(state, a);
}
