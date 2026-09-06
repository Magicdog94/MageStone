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
  /** DERIVED MIRROR of the MageStone tokens this Mage holds that are still
   *  Unactivated. Never assign it directly — mutate `GameState.stones` and call
   *  `rules.ts::syncStones`, which is the single writer. */
  carried: number;
  /** DERIVED MIRROR of the Activated MageStone tokens this Mage holds (drives
   *  the combat power tier and MageStone victory). See `carried`. */
  activated: number;
}

/**
 * A MageStone **token**. Activation lives on the token, not on whoever holds
 * it, so it survives being carried, dropped, stolen, bolted or nova'd.
 *
 * `activated` transitions **false → true only**. Nothing in the engine may ever
 * set it back to false — that is a deliberate endgame-acceleration mechanic.
 */
export interface MageStone {
  id: string;
  /** Square the token occupies. Meaningless (stale) while it is carried. */
  cell: Cell;
  /** Unit id of the Mage holding it, or null when it lies on the board. */
  carrier: string | null;
  /** PERMANENT once true. Never write `false` over a `true`. */
  activated: boolean;
}

export interface Gravestone {
  id: string;
  cell: Cell;
}

/** Which unit kind a die may activate. */
export type DieKind = 'mage' | 'priest' | 'warrior';

/**
 * One of the five dice a player rolls at the start of a round. Nothing is
 * discarded any more: all five stay on the table and visible, and the player
 * simply never gets to spend more than `DICE_PER_ROUND` of them.
 */
export interface Die {
  id: string;
  /** Whose die this is. Every player rolls their own five each round. */
  owner: PlayerColor;
  value: number; // 1..6
  kind: DieKind;
  /** Unit id this die was spent on (movement/action), if any. */
  usedBy: string | null;
}

/** 'roll' = the round's dice have not been thrown yet; 'act' = activations are
 *  under way. (There is no discard step — nothing is discarded.) */
export type TurnPhase = 'roll' | 'act' | 'end';

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
  /** A tie is RE-ROLLED until the result is decisive, so neither side is
   *  favoured and 'draw' never occurs — the field is kept only for states
   *  broadcast by older clients. */
  outcome: 'win' | 'lose' | 'draw';
  defeatedId: string | null;
  /** The defender's cell at the moment of attack — lets attackers turn to face
   *  it (and keep facing) even after a defeated defender is removed. */
  defenderCell: Cell;
}

export interface Ritual {
  player: PlayerColor;
  priestId: string;
  /** The round it was declared in. Every other player gets a complete turn, and
   *  the win is claimed when play RETURNS to this player in a later round —
   *  which may be several activations into that round. */
  round: number;
}

/** A Mage/Priest awaiting respawn because an enemy is holding its base. */
export interface PendingRespawn {
  id: string;
  owner: PlayerColor;
  kind: 'mage' | 'priest';
  /** Activated MageStones the Mage keeps when it returns. Informational only —
   *  the stone TOKENS stay bound to the unit id, so they come back by
   *  themselves. */
  activated?: number;
}

export interface GameState {
  players: PlayerColor[];
  /** Board seat (quarter-turns from the top: 0=top, 1=right, 2=bottom, 3=left)
   *  each colour occupies. Decoupled from colour so any two colours can be
   *  seated opposite each other in a 2-player game. */
  seats: Record<PlayerColor, number>;
  /** Whose ACTIVATION it is. Play alternates: one activation each, in
   *  clockwise order, until nobody has dice left to spend. */
  current: PlayerColor;
  /** Who activates first this round. Rotates clockwise every round, which in a
   *  2-player game is strict alternation. */
  roundStarter: PlayerColor;
  /** Round number, starting at 1. A round is one roll plus the alternating
   *  activations that follow it. */
  turn: number;
  turnPhase: TurnPhase;
  dice: Die[];
  units: Unit[];
  stones: MageStone[];
  gravestones: Gravestone[];
  /** Players who have PASSED this round — they ended an activation without
   *  committing a die, so their remaining dice are ignored and they get no
   *  further activations until the round turns over. */
  passed: PlayerColor[];
  /** Die ids committed to the activation in progress; [] between activations.
   *  Every die in it shares a kind — that IS the same-colour bundle rule, which
   *  lets 2 or 3 same-colour dice resolve together before play passes. */
  activationDice: string[];
  /** Units that have moved / acted THIS ROUND (a unit gets at most one die per
   *  round, so these clear at the round boundary, not per activation). */
  unitsMovedThisTurn: string[];
  unitsActedThisTurn: string[];
  ritual: Ritual | null;
  lastCombat: CombatResult | null;
  pendingRespawns: PendingRespawn[];
  /**
   * The shared, FINITE Gravestone bank — 4 per participating player at setup
   * (8 for 2p, 16 for 4p). It only ever decreases: a Warrior's death spends
   * one, and a resurrection removes that token from the game for good. It is
   * never replenished, which is what eventually makes attrition permanent.
   */
  graveBank: number;
  /** Players who have already used their one resurrection this round. */
  resurrectedThisTurn: PlayerColor[];
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
