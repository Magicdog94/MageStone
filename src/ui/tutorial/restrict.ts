// Tutorial GUARDRAILS, shared by the store (which enforces them), the 3D view
// and HUD (which hide whatever they forbid), the guided script, and the sweep
// test that proves no allowed interaction can strand a player.
import type { Cell } from '../../game/types';

export type TutActionName =
  | 'roll'
  | 'attack'
  | 'bolt'
  | 'nova'
  | 'collect'
  | 'activate'
  | 'resurrect'
  | 'ritual'
  | 'undo'
  | 'endTurn';

export interface TutRestrict {
  /** Unit ids the player may select (deselecting is always allowed). */
  units?: string[];
  /** Allowed move destinations; [] = this step involves no movement. */
  dests?: Cell[];
  /** Action verbs allowed this step ([] = none). */
  actions?: TutActionName[];
  /** Attack / bolt target unit ids allowed. */
  targets?: string[];
  /** A coordinated attack must bring at least this many attackers. */
  minAttackers?: number;
  /** Scripted dice for the task's combat (attacker rolls first, defender
   *  last) — staged demo fights must land the taught outcome even when the
   *  PLAYER throws the punch. Omitted = real dice. */
  rig?: number[];
}

/** Does the restriction (if any) allow this action? */
export const tutAllows = (r: TutRestrict | null | undefined, a: TutActionName): boolean =>
  !r || !r.actions || r.actions.includes(a);

/**
 * The board between tasks: nothing selectable, no squares, no verbs. While the
 * tutorial runs and no task is live, every player gesture meets this — the
 * coach's click blocker already stops the mouse, and this also stops keyboard
 * focus and anything else that slips past it, so nobody can nudge a piece in a
 * gap between lessons and break the next one.
 */
export const TUT_LOCK: TutRestrict = { units: [], dests: [], actions: [] };
