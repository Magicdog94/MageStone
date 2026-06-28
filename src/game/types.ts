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
  attackerKind: UnitKind;
  defenderKind: UnitKind; // for colouring the defender's die
  attackRoll: number;
  attackDice: number[]; // individual attacker dice rolled
  attackFaces: number; // the die size used by the attacker (6/12/20) — for display
  defenseRoll: number;
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

/** A Priest that won a defence and may flee (out-of-turn) up to `steps`. */
export interface PendingFlee {
  priestId: string;
  owner: PlayerColor;
  steps: number;
}

export interface GameState {
  players: PlayerColor[];
  current: PlayerColor;
  turnPhase: TurnPhase;
  dice: Die[];
  units: Unit[];
  stones: MageStone[];
  gravestones: Gravestone[];
  gravestonePool: number; // remaining unused gravestone markers
  unitsMovedThisTurn: string[];
  unitsActedThisTurn: string[];
  ritual: Ritual | null;
  lastCombat: CombatResult | null;
  pendingRespawns: PendingRespawn[];
  pendingFlee: PendingFlee | null;
  /** Enemy units each player has defeated (kill counter). */
  kills: Record<PlayerColor, number>;
  winner: PlayerColor | null;
  log: string[];
}
