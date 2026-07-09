// Core domain types for MageStone. Pure data — no rendering concerns.

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow';

export type UnitKind = 'warrior' | 'mage' | 'priest';

/** Board cell, 0-indexed. r = row (top→bottom), c = column (left→right). */
export interface Cell {
  r: number;
  c: number;
}

export interface Unit {
  id: string;
  kind: UnitKind;
  owner: PlayerColor;
  cell: Cell;
  /** Cell occupied before this unit's most recent move (for priest step-back). */
  prevCell?: Cell;
  /** MageStones the Mage is carrying (collected but not yet activated). */
  carried: number;
  /** MageStones the Mage has activated (drives combat power tier). */
  activated: number;
}

export interface MageStone {
  id: string;
  cell: Cell;
  /** True once a Mage has collected it (removed from the board). */
  collected: boolean;
  /** True for a stone dropped by a slain Mage that was already activated — it
   *  shows as a gold disk on the board (collecting it makes it carried again). */
  activated?: boolean;
}

export interface Gravestone {
  id: string;
  cell: Cell;
}

/** Which unit kind a die may activate. */
export type DieKind = 'mage' | 'priest' | 'warrior';

/** A single rolled die awaiting use this turn. */
export interface Die {
  id: string;
  value: number; // 1..6
  kind: DieKind;
  discarded: boolean;
  /** Unit id this die was spent on (movement/action), if any. */
  usedBy: string | null;
}

export type TurnPhase = 'roll' | 'discard' | 'act' | 'end';

export type ActionKind = 'attack' | 'collect' | 'activate' | 'resurrect' | 'ritual';

export interface CombatResult {
  attackerIds: string[];
  defenderId: string;
  /** Owners of each side — the 3D combat dice land on each roller's tray. */
  attackerOwner: PlayerColor;
  defenderOwner: PlayerColor;
  attackerKind: UnitKind;
  defenderKind: UnitKind; // for colouring the defender's die
  attackRoll: number;
  attackDice: number[]; // individual attacker dice rolled
  attackFaces: number; // the die size used by the attacker (6/12/20) — for display
  defenseRoll: number;
  defenseFaces: number; // the defender's die size (6, or a Mage's power die 12/20)
  outcome: 'win' | 'lose' | 'draw';
  defeatedId: string | null;
  /** The defender's cell at the moment of attack — lets attackers turn to face
   *  it (and keep facing) even after a defeated defender is removed. */
  defenderCell: Cell;
}

export interface Ritual {
  player: PlayerColor;
  priestId: string;
}

/** A Mage/Priest awaiting respawn because an enemy is holding its base. */
export interface PendingRespawn {
  id: string;
  owner: PlayerColor;
  kind: 'mage' | 'priest';
  /** Activated MageStones the Mage keeps when it returns. */
  activated?: number;
}

export interface GameState {
  players: PlayerColor[];
  /** Board seat (quarter-turns from the top: 0=top, 1=right, 2=bottom, 3=left)
   *  each colour occupies. Decoupled from colour so any two colours can be
   *  seated opposite each other in a 2-player game. */
  seats: Record<PlayerColor, number>;
  current: PlayerColor;
  /** Round number, starting at 1 — increments when play wraps back to the
   *  first still-active player. */
  turn: number;
  turnPhase: TurnPhase;
  dice: Die[];
  units: Unit[];
  stones: MageStone[];
  gravestones: Gravestone[];
  unitsMovedThisTurn: string[];
  unitsActedThisTurn: string[];
  ritual: Ritual | null;
  lastCombat: CombatResult | null;
  pendingRespawns: PendingRespawn[];
  /** Players knocked out of the game: reduced to zero units on the board while
   *  their base was besieged. They take no turns and never respawn. */
  eliminated: PlayerColor[];
  /** Enemy units each player has defeated (kill counter). */
  kills: Record<PlayerColor, number>;
  winner: PlayerColor | null;
  /** How the winner won — shown on the victory panel. */
  winMethod: 'MageStone' | 'Ritual' | 'Conquest' | null;
  log: string[];
}
