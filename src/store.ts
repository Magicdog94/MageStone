import { create } from 'zustand';
import { createGame, orderPlayers, playerSet } from './game/setup';
import {
  activate,
  attackTargets,
  beginRitual,
  canActivate,
  canCollect,
  canDieMoveUnit,
  canResurrect,
  canRitual,
  collect,
  discardDie,
  endTurn,
  legalMoves,
  moveUnit,
  plannedAttackers,
  resolveAttack,
  resurrect,
  rollDice,
  setRolledValues,
  unitById,
} from './game/rules';
import type { Cell, GameState, PlayerColor, UnitKind } from './game/types';
import type { BotLevel } from './game/bot';

export type HealthBarMode = 'off' | 'always' | 'hover';
export type ModalId = 'newGame' | 'settings' | null;

/** A unit that was just defeated — captured before the engine removes it, so the
 *  3D layer can play its collapse animation at the square where it fell. */
export interface DeathEvent {
  id: string;
  kind: UnitKind;
  owner: PlayerColor;
  cell: Cell;
}

export interface Settings {
  healthBars: HealthBarMode;
  /** Per-turn time limit in seconds, or null for no limit. */
  turnSeconds: number | null;
}

interface UIState {
  game: GameState;
  selectedUnitId: string | null;
  selectedDieId: string | null;
  hoveredUnitId: string | null;

  /** True while the 3D dice are tumbling (before values are reported). */
  rolling: boolean;
  /** Increments each roll so the 3D roller knows to throw fresh dice. */
  rollNonce: number;
  reportDiceValues: (values: number[]) => void;

  /** The most recent unit defeat + a nonce, so the 3D layer can play a one-shot
   *  collapse animation each time a unit falls. */
  lastDeath: DeathEvent | null;
  deathNonce: number;
  /** Bumped on every attack so the HUD replays the combat dice roll. */
  combatNonce: number;

  playerCount: number;
  /** Team colours selected for the local game, in clockwise turn order. Each
   *  colour also fixes that player's home edge (red=top, blue=right, …). */
  playerColors: PlayerColor[];
  /** Chosen MageStone layout id (or 'random' to reroll each game). */
  stoneLayoutId: string;
  settings: Settings;
  modal: ModalId;
  /** False until the first game is started — the opening New Game modal is then
   *  mandatory (no Cancel/close) so the player must pick before the timer runs. */
  started: boolean;

  /** Online multiplayer: true for a networked match; `myColor` is the colour this
   *  client controls (null = local hot-seat, where every colour is controllable). */
  online: boolean;
  myColor: PlayerColor | null;
  /** Colours played by AI bots (and their difficulty). */
  bots: Partial<Record<PlayerColor, BotLevel>>;
  /** True when THIS client executes bot turns: always in hot-seat; online, only
   *  the host (otherwise every client would move the bots at once). */
  botController: boolean;
  startOnline: (
    state: GameState,
    myColor: PlayerColor,
    bots?: Partial<Record<PlayerColor, BotLevel>>,
    isHost?: boolean,
  ) => void;
  setLocalMode: () => void;

  newGame: (
    players?: number | PlayerColor[],
    stoneLayoutId?: string,
    bots?: Partial<Record<PlayerColor, BotLevel>>,
  ) => void;
  openModal: (modal: Exclude<ModalId, null>) => void;
  closeModal: () => void;
  setHealthBars: (mode: HealthBarMode) => void;
  setTurnSeconds: (seconds: number | null) => void;
  setHovered: (unitId: string | null) => void;

  roll: () => void;
  discard: (dieId: string) => void;
  selectUnit: (unitId: string | null) => void;
  selectDie: (dieId: string | null) => void;
  moveTo: (dest: Cell) => void;
  endTurn: () => void;

  attack: (targetId: string) => void;
  collectStones: () => void;
  activateStones: () => void;
  doResurrect: () => void;
  doRitual: () => void;
}

/** In an online match a client may only act on its own colour's turn — except
 *  the bot controller (the host), which also acts for the bot colours. */
const outOfTurn = (s: UIState) =>
  s.online && s.game.current !== s.myColor && !(s.botController && s.bots[s.game.current]);

export const useGame = create<UIState>((set) => ({
  game: createGame(2),
  selectedUnitId: null,
  selectedDieId: null,
  hoveredUnitId: null,
  rolling: false,
  rollNonce: 0,
  lastDeath: null,
  deathNonce: 0,
  combatNonce: 0,
  playerCount: 2,
  playerColors: playerSet(2),
  stoneLayoutId: 'diamond',
  settings: { healthBars: 'off', turnSeconds: 60 },
  // Open the New Game selector on first load so the player chooses players/timer
  // before the turn timer starts (the timer pauses while any modal is open).
  modal: 'newGame',
  started: false,
  online: false,
  myColor: null,
  bots: {},
  botController: true,

  startOnline: (state, myColor, bots = {}, isHost = false) =>
    set({
      game: state,
      online: true,
      myColor,
      bots,
      botController: isHost,
      started: true,
      modal: null,
      selectedUnitId: null,
      selectedDieId: null,
      hoveredUnitId: null,
      rolling: false,
    }),

  setLocalMode: () =>
    set((s) => ({
      online: false,
      myColor: null,
      bots: {},
      botController: true,
      started: false,
      modal: 'newGame',
      game: createGame(s.playerColors, s.stoneLayoutId),
      selectedUnitId: null,
      selectedDieId: null,
      rolling: false,
    })),

  newGame: (players, stoneLayoutId, bots) =>
    set((s) => {
      // Accept an explicit colour list, a player count, or fall back to the
      // last-used selection. createGame normalises into clockwise turn order.
      const colors = Array.isArray(players)
        ? orderPlayers(players)
        : players === undefined
          ? s.playerColors
          : playerSet(players);
      const layoutId = stoneLayoutId ?? s.stoneLayoutId;
      const game = createGame(colors, layoutId);
      return {
        game,
        playerColors: game.players,
        playerCount: game.players.length,
        stoneLayoutId: layoutId,
        bots: bots ?? {},
        botController: true,
        selectedUnitId: null,
        selectedDieId: null,
        hoveredUnitId: null,
        rolling: false,
        modal: null,
        started: true,
      };
    }),

  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setHealthBars: (mode) => set((s) => ({ settings: { ...s.settings, healthBars: mode } })),
  setTurnSeconds: (seconds) => set((s) => ({ settings: { ...s.settings, turnSeconds: seconds } })),
  setHovered: (unitId) => set({ hoveredUnitId: unitId }),

  roll: () =>
    set((s) => {
      if (outOfTurn(s)) return {};
      return {
        game: rollDice(s.game),
        selectedUnitId: null,
        selectedDieId: null,
        rolling: true,
        rollNonce: s.rollNonce + 1,
      };
    }),

  reportDiceValues: (values) =>
    set((s) => (outOfTurn(s) ? {} : { game: setRolledValues(s.game, values), rolling: false })),

  discard: (dieId) =>
    set((s) => (s.rolling || outOfTurn(s) ? {} : { game: discardDie(s.game, dieId) })),

  selectUnit: (unitId) =>
    set((s) => {
      if (unitId === null) return { selectedUnitId: null };
      if (outOfTurn(s)) return {};
      const unit = unitById(s.game, unitId);
      if (!unit || unit.owner !== s.game.current) return {};
      const die = s.game.dice.find((d) => d.id === s.selectedDieId);
      const keepDie = die && canDieMoveUnit(die, unit, s.game) ? s.selectedDieId : null;
      return { selectedUnitId: unitId, selectedDieId: keepDie };
    }),

  selectDie: (dieId) =>
    set((s) => {
      if (dieId === null) return { selectedDieId: null };
      const die = s.game.dice.find((d) => d.id === dieId);
      if (!die || die.discarded || die.usedBy !== null) return {};
      return { selectedDieId: dieId };
    }),

  moveTo: (dest) =>
    set((s) => {
      const { selectedUnitId, selectedDieId } = s;
      if (!selectedUnitId || !selectedDieId || outOfTurn(s)) return {};
      const game = moveUnit(s.game, selectedUnitId, selectedDieId, dest);
      if (game === s.game) return {};
      // Keep the unit selected (it may still act); drop the spent die.
      return { game, selectedDieId: null };
    }),

  endTurn: () =>
    set((s) =>
      outOfTurn(s) ? {} : { game: endTurn(s.game), selectedUnitId: null, selectedDieId: null },
    ),

  attack: (targetId) =>
    set((s) => {
      const { game, selectedUnitId } = s;
      if (!selectedUnitId || outOfTurn(s)) return {};
      const attackerIds = plannedAttackers(game, selectedUnitId, targetId);
      if (attackerIds.length === 0) return {};
      const game2 = resolveAttack(game, attackerIds, targetId);
      if (game2 === game) return {};
      const out: Partial<UIState> = {
        game: game2,
        selectedUnitId: null,
        selectedDieId: null,
        combatNonce: s.combatNonce + 1,
      };
      // Snapshot the defeated unit from the PRE-attack state (it's gone in game2)
      // so the 3D layer can animate its collapse where it stood.
      const fallenId = game2.lastCombat?.defeatedId;
      if (fallenId) {
        const u = unitById(game, fallenId);
        if (u) {
          out.lastDeath = { id: u.id, kind: u.kind, owner: u.owner, cell: u.cell };
          out.deathNonce = s.deathNonce + 1;
        }
      }
      return out;
    }),

  collectStones: () =>
    set((s) => {
      if (!s.selectedUnitId || outOfTurn(s)) return {};
      const game = collect(s.game, s.selectedUnitId);
      return game === s.game ? {} : { game };
    }),

  activateStones: () =>
    set((s) => {
      if (!s.selectedUnitId || outOfTurn(s)) return {};
      const game = activate(s.game, s.selectedUnitId);
      return game === s.game ? {} : { game };
    }),

  doResurrect: () =>
    set((s) => {
      if (!s.selectedUnitId || outOfTurn(s)) return {};
      const game = resurrect(s.game, s.selectedUnitId);
      return game === s.game ? {} : { game, selectedUnitId: null };
    }),

  doRitual: () =>
    set((s) => {
      if (!s.selectedUnitId || outOfTurn(s)) return {};
      const game = beginRitual(s.game, s.selectedUnitId);
      return game === s.game ? {} : { game };
    }),
}));

// ---- Derived helpers used by the 3D view (pure; computed in components) ----

export function moveDestinations(game: GameState, unitId: string | null, dieId: string | null): Cell[] {
  if (game.turnPhase !== 'act' || !unitId || !dieId) return [];
  const unit = unitById(game, unitId);
  const die = game.dice.find((d) => d.id === dieId);
  if (!unit || !die || !canDieMoveUnit(die, unit, game)) return [];
  return legalMoves(game, unit, die.value);
}

export function attackTargetIds(game: GameState, unitId: string | null): Set<string> {
  if (game.turnPhase !== 'act' || !unitId) return new Set();
  return new Set(attackTargets(game, unitId).map((u) => u.id));
}

export function unitActions(game: GameState, unitId: string | null) {
  if (!unitId) return { collect: false, activate: false, resurrect: false, ritual: false };
  return {
    collect: canCollect(game, unitId),
    activate: canActivate(game, unitId),
    resurrect: canResurrect(game, unitId),
    ritual: canRitual(game, unitId),
  };
}

