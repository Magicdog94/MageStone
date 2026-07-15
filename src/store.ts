import { create } from 'zustand';
import { createGame, orderPlayers, playerSet } from './game/setup';
import { createTutorialGame } from './game/tutorialSetup';
import {
  activate,
  attackTargets,
  beginRitual,
  boltTargets,
  canActivate,
  canCollect,
  canDieMoveUnit,
  canResurrect,
  canRitual,
  collect,
  combatOdds,
  discardDie,
  endTurn,
  legalMoves,
  magePowerDie,
  moveUnit,
  novaVictims,
  plannedAttackers,
  resolveAttack,
  resolveBolt,
  resolveNova,
  resurrect,
  rollDice,
  setRolledValues,
  unitById,
} from './game/rules';
import type { Cell, GameState, PlayerColor, UnitKind } from './game/types';
import type { BotLevel } from './game/bot';

export type HealthBarMode = 'off' | 'always' | 'hover';
export type LayoutMode = 'desktop' | 'mobile';
export type ModalId = 'newGame' | 'settings' | null;

// Compact phone layout: restored from the player's saved choice, else
// auto-detected once from the device (coarse pointer or a small viewport —
// e.g. an iPhone 14 in landscape is 844×390).
function detectLayout(): LayoutMode {
  try {
    const saved = localStorage.getItem('ms-layout');
    if (saved === 'mobile' || saved === 'desktop') return saved;
  } catch {
    /* storage may be unavailable (private mode) — fall through to detection */
  }
  if (typeof window === 'undefined') return 'desktop';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999) < 500;
  return coarse || small ? 'mobile' : 'desktop';
}

/** A unit that was just defeated — captured before the engine removes it, so the
 *  3D layer can play its collapse animation at the square where it fell. */
export interface DeathEvent {
  id: string;
  kind: UnitKind;
  owner: PlayerColor;
  cell: Cell;
}

/** The result of an attack, announced ONLY once the physical combat dice have
 *  settled face-up on the table (so the number reveal builds tension). */
export interface CombatRollInfo {
  attacker: PlayerColor;
  attackRoll: number;
  defender: PlayerColor;
  defenseRoll: number;
  outcome: 'win' | 'lose' | 'draw';
  nonce: number;
}

/** Announced the INSTANT an attack is declared (before the dice even settle):
 *  who attacks whom and with which dice — "Red Warrior ×3 attacks Green Mage,
 *  3d6 vs d12". Cleared together with the roll announcement. */
export interface CombatIntro {
  /** 'attack' = normal melee; 'bolt'/'nova' = Mage sorcery announcements. */
  kind?: 'attack' | 'bolt' | 'nova';
  attacker: PlayerColor;
  attackerKind: UnitKind;
  count: number;
  defender: PlayerColor;
  defenderKind: UnitKind;
  attackFaces: string;
  defenseFaces: string;
}

export interface Settings {
  healthBars: HealthBarMode;
  /** Per-turn time limit in seconds, or null for no limit. */
  turnSeconds: number | null;
  /** Silence the sound effects (music has its own toggle). */
  sfxMuted: boolean;
  /** Interface layout: compact 'mobile' (phones, landscape) or full 'desktop'. */
  layout: LayoutMode;
  /** Shorten combat dice/death timings for players who fight a lot. */
  fastDice: boolean;
  /** Skip the exterior town + prop dressing for weaker machines. */
  lowGfx: boolean;
  /** Camera lock: keep the camera at its start position and ROTATE THE BOARD
   *  to face each human player instead (bots keep the last human's view). */
  cameraFix: boolean;
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
  /** Bumped when the Rapier WASM world panics (it poisons itself — every later
   *  call throws). Keyed onto <Physics> so the world remounts fresh. */
  physicsEpoch: number;
  bumpPhysicsEpoch: () => void;
  /** True while the 3D view is down (SceneBoundary caught a crash) — rolls then
   *  resolve from engine values almost immediately instead of waiting 10s. */
  sceneDown: boolean;
  setSceneDown: (down: boolean) => void;
  /** Camera-lock view: quarter-turns applied to the BOARD so the acting human's
   *  edge faces the fixed camera (0 when the lock is off; bots don't move it). */
  viewOffset: number;
  /** Bumped when the camera lock engages — the scene snaps back to its start pose. */
  camResetNonce: number;
  /** Bumped on every attack so the HUD replays the combat dice roll. */
  combatNonce: number;
  /** The rolled combat result to announce — set by the 3D dice layer the moment
   *  the physical dice SETTLE (not when the attack resolves), so "X rolls N,
   *  Y rolls M" appears only after the faces are shown. Cleared when the dice
   *  sweep away. */
  combatRoll: CombatRollInfo | null;
  showCombatRoll: (info: Omit<CombatRollInfo, 'nonce'> | null) => void;
  /** The "X attacks Y — 3d6 vs d6" banner, shown while the dice tumble. */
  combatIntro: CombatIntro | null;

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
  /** True while the guided Tutorial mode is running (TutorialCoach drives play). */
  tutorial: boolean;

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
  /** Start the guided Tutorial: a pre-arranged 2-player board the TutorialCoach
   *  plays automatically while narrating every rule. */
  startTutorial: () => void;
  /** Tutorial-only fixed roll: set the 5 dice to exact values with no physics
   *  throw, so the guided script is deterministic (order: mage, priest, w, w, w). */
  tutorialRoll: (values: number[]) => void;

  newGame: (
    players?: number | PlayerColor[],
    stoneLayoutId?: string,
    bots?: Partial<Record<PlayerColor, BotLevel>>,
  ) => void;
  openModal: (modal: Exclude<ModalId, null>) => void;
  closeModal: () => void;
  setHealthBars: (mode: HealthBarMode) => void;
  setTurnSeconds: (seconds: number | null) => void;
  setSfxMuted: (muted: boolean) => void;
  setLayout: (layout: LayoutMode) => void;
  setFastDice: (fast: boolean) => void;
  setLowGfx: (low: boolean) => void;
  setCameraFix: (on: boolean) => void;
  setHovered: (unitId: string | null) => void;

  roll: () => void;
  discard: (dieId: string) => void;
  selectUnit: (unitId: string | null) => void;
  selectDie: (dieId: string | null) => void;
  moveTo: (dest: Cell) => void;
  endTurn: () => void;

  /** Attack `targetId` with the currently selected unit. `attackerIds` lets the
   *  action bar pick the coordination level (single/double/triple); omitted, the
   *  board-click path auto-maximises coordination via `plannedAttackers`. `rng`
   *  overrides the dice randomness (the guided Tutorial scripts its combat). */
  attack: (targetId: string, attackerIds?: string[], rng?: () => number) => void;
  /** Bolt targeting mode: the next enemy clicked takes the ranged bolt. */
  boltMode: boolean;
  setBoltMode: (on: boolean) => void;
  castBolt: (targetId: string, rng?: () => number) => void;
  castNova: (rng?: () => number) => void;
  collectStones: () => void;
  activateStones: () => void;
  doResurrect: () => void;
  doRitual: () => void;
}

// Rate-limits physics-world rebuilds (see bumpPhysicsEpoch).
let lastEpochBump = 0;

/** In an online match a client may only act on its own colour's turn — except
 *  the bot controller (the host), which also acts for the bot colours. */
const outOfTurn = (s: UIState) =>
  s.online && s.game.current !== s.myColor && !(s.botController && s.bots[s.game.current]);

export const useGame = create<UIState>((set, get) => ({
  game: createGame(2),
  selectedUnitId: null,
  selectedDieId: null,
  hoveredUnitId: null,
  rolling: false,
  rollNonce: 0,
  lastDeath: null,
  deathNonce: 0,
  physicsEpoch: 0,
  sceneDown: false,
  boltMode: false,
  combatNonce: 0,
  combatRoll: null,
  combatIntro: null,
  playerCount: 2,
  playerColors: playerSet(2),
  stoneLayoutId: 'diamond',
  settings: {
    healthBars: 'off',
    turnSeconds: 60,
    sfxMuted: false,
    layout: detectLayout(),
    fastDice: false,
    lowGfx: (() => {
      try {
        return localStorage.getItem('ms-lowgfx') === '1';
      } catch {
        return false;
      }
    })(),
    cameraFix: (() => {
      try {
        return localStorage.getItem('ms-camerafix') === '1';
      } catch {
        return false;
      }
    })(),
  },
  viewOffset: 0,
  camResetNonce: 0,
  // Open the New Game selector on first load so the player chooses players/timer
  // before the turn timer starts (the timer pauses while any modal is open).
  modal: 'newGame',
  started: false,
  tutorial: false,
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
      tutorial: false,
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
      tutorial: false,
      modal: 'newGame',
      game: createGame(s.playerColors, s.stoneLayoutId),
      selectedUnitId: null,
      selectedDieId: null,
      rolling: false,
    })),

  startTutorial: () =>
    set({
      online: false,
      myColor: null,
      bots: {},
      botController: true,
      started: true,
      tutorial: true,
      modal: null,
      game: createTutorialGame(),
      selectedUnitId: null,
      selectedDieId: null,
      rolling: false,
    }),

  tutorialRoll: (values) =>
    set((s) => ({
      game: setRolledValues(rollDice(s.game), values),
      rolling: false,
      selectedUnitId: null,
      selectedDieId: null,
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
        tutorial: false,
      };
    }),

  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setHealthBars: (mode) => set((s) => ({ settings: { ...s.settings, healthBars: mode } })),
  setTurnSeconds: (seconds) => set((s) => ({ settings: { ...s.settings, turnSeconds: seconds } })),
  setSfxMuted: (muted) => set((s) => ({ settings: { ...s.settings, sfxMuted: muted } })),
  setFastDice: (fast) => set((s) => ({ settings: { ...s.settings, fastDice: fast } })),
  setLowGfx: (low) => {
    try {
      localStorage.setItem('ms-lowgfx', low ? '1' : '0');
    } catch {
      /* storage unavailable — applies for this session only */
    }
    set((s) => ({ settings: { ...s.settings, lowGfx: low } }));
  },
  setCameraFix: (on) => {
    try {
      localStorage.setItem('ms-camerafix', on ? '1' : '0');
    } catch {
      /* storage unavailable — applies for this session only */
    }
    set((s) => ({
      settings: { ...s.settings, cameraFix: on },
      // Engaging the lock also snaps the camera home — that's the "fix".
      camResetNonce: on ? s.camResetNonce + 1 : s.camResetNonce,
    }));
  },
  setLayout: (layout) => {
    try {
      localStorage.setItem('ms-layout', layout);
    } catch {
      /* storage unavailable — the choice still applies for this session */
    }
    set((s) => ({ settings: { ...s.settings, layout } }));
  },
  setHovered: (unitId) => set({ hoveredUnitId: unitId }),

  bumpPhysicsEpoch: () => {
    // Throttled: if even the fresh world panics instantly we must not remount
    // every frame — the dice fall back to engine values either way.
    const now = Date.now();
    if (now - lastEpochBump < 5000) return;
    lastEpochBump = now;
    console.warn('MageStone: physics world crashed — rebuilding it.');
    set((s) => ({ physicsEpoch: s.physicsEpoch + 1 }));
  },
  setSceneDown: (down) => set({ sceneDown: down }),

  showCombatRoll: (info) =>
    set((s) => ({
      combatRoll: info ? { ...info, nonce: s.combatNonce + 1 } : null,
      // the intro banner hands over to the numbers (or clears with them)
      combatIntro: info ? s.combatIntro : null,
    })),

  roll: () => {
    set((s) => {
      if (outOfTurn(s)) return {};
      return {
        game: rollDice(s.game),
        selectedUnitId: null,
        selectedDieId: null,
        rolling: true,
        rollNonce: s.rollNonce + 1,
        combatIntro: null,
        combatRoll: null,
      };
    });
    // Last-resort watchdog, deliberately OUTSIDE the render loop: the 3D dice
    // normally report the physical faces, and Dice.tsx has its own in-frame
    // settle timeout — but if the frame loop itself dies (tab throttled, WebGL
    // context lost), `rolling` would wedge forever and freeze bot games. The
    // engine already rolled real values, so after 10s we simply accept them.
    const armed = get();
    if (!armed.rolling) return;
    const nonce = armed.rollNonce;
    // With the 3D view down there's nothing to wait for — resolve almost at
    // once; otherwise give the physical dice a generous 10s.
    const grace = armed.sceneDown ? 400 : 10000;
    window.setTimeout(() => {
      const s = get();
      if (s.rolling && s.rollNonce === nonce) {
        if (!s.sceneDown) console.warn('MageStone: dice watchdog cleared a stuck roll');
        s.reportDiceValues(s.game.dice.map((d) => d.value));
      }
    }, grace);
  },

  reportDiceValues: (values) =>
    set((s) => (outOfTurn(s) ? {} : { game: setRolledValues(s.game, values), rolling: false })),

  discard: (dieId) =>
    set((s) => (s.rolling || outOfTurn(s) ? {} : { game: discardDie(s.game, dieId) })),

  selectUnit: (unitId) =>
    set((s) => {
      if (unitId === null) return { selectedUnitId: null, boltMode: false };
      if (outOfTurn(s)) return {};
      const unit = unitById(s.game, unitId);
      if (!unit || unit.owner !== s.game.current) return {};
      const die = s.game.dice.find((d) => d.id === s.selectedDieId);
      let dieId = die && canDieMoveUnit(die, unit, s.game) ? s.selectedDieId : null;
      // Unit-first flow: clicking a unit with no (matching) die selected
      // auto-assigns the HIGHEST free die of its kind — so the first warrior
      // gets the best warrior roll, the next the second best, and so on. A
      // manually clicked die still wins (kept above); this only fills the gap.
      if (!dieId && s.game.turnPhase === 'act') {
        const best = s.game.dice
          .filter((d) => !d.discarded && d.usedBy === null && canDieMoveUnit(d, unit, s.game))
          .sort((a, b) => b.value - a.value)[0];
        dieId = best?.id ?? null;
      }
      // switching units always leaves bolt-targeting mode
      return { selectedUnitId: unitId, selectedDieId: dieId, boltMode: false };
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
      outOfTurn(s)
        ? {}
        : { game: endTurn(s.game), selectedUnitId: null, selectedDieId: null, boltMode: false },
    ),

  attack: (targetId, attackerIds, rng) =>
    set((s) => {
      const { game, selectedUnitId } = s;
      if (!selectedUnitId || outOfTurn(s)) return {};
      const ids =
        attackerIds && attackerIds.length > 0
          ? attackerIds
          : plannedAttackers(game, selectedUnitId, targetId);
      if (ids.length === 0) return {};
      // Announce the matchup the moment the attack is declared — who, whom,
      // and which dice — so the fight is readable before anything lands.
      const lead = unitById(game, ids[0]);
      const target = unitById(game, targetId);
      let intro: CombatIntro | null = null;
      if (lead && target) {
        const isMage = lead.kind === 'mage';
        intro = {
          attacker: lead.owner,
          attackerKind: lead.kind,
          count: ids.length,
          defender: target.owner,
          defenderKind: target.kind,
          attackFaces: isMage ? `d${magePowerDie(lead.activated)}` : `${ids.length}d6`,
          defenseFaces: target.kind === 'mage' ? `d${magePowerDie(target.activated)}` : 'd6',
        };
      }
      const game2 = resolveAttack(game, ids, targetId, rng);
      if (game2 === game) return {};
      const out: Partial<UIState> = {
        game: game2,
        selectedUnitId: null,
        selectedDieId: null,
        combatNonce: s.combatNonce + 1,
        combatIntro: intro,
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

  setBoltMode: (on) => set({ boltMode: on }),

  castBolt: (targetId, rng) => {
    const s = get();
    const mageId = s.selectedUnitId;
    if (!mageId || outOfTurn(s)) return;
    const game = s.game;
    const mage = unitById(game, mageId);
    const target = unitById(game, targetId);
    if (!mage || !target) return;
    const faces = magePowerDie(mage.activated);
    const game2 = resolveBolt(game, mageId, targetId, rng);
    if (game2 === game) return;
    const repelled = !game2.units.every((u) => u.id !== targetId) && target.kind === 'mage';
    const out: Partial<UIState> = {
      game: game2,
      boltMode: false,
      selectedUnitId: null,
      selectedDieId: null,
      combatNonce: s.combatNonce + 1,
      combatIntro: {
        kind: 'bolt',
        attacker: mage.owner,
        attackerKind: 'mage',
        count: 1,
        defender: target.owner,
        defenderKind: target.kind,
        attackFaces: `d${faces}`,
        defenseFaces: target.kind === 'mage' ? `d${magePowerDie(target.activated)}` : '—',
      },
    };
    if (!repelled) {
      out.lastDeath = { id: target.id, kind: target.kind, owner: target.owner, cell: target.cell };
      out.deathNonce = s.deathNonce + 1;
    }
    set(out);
    // Unopposed bolts have no dice to sweep the banner away — clear it after a beat.
    if (target.kind !== 'mage') {
      window.setTimeout(() => {
        if (get().combatIntro?.kind === 'bolt') set({ combatIntro: null });
      }, 4200);
    }
  },

  castNova: (rng) => {
    const s = get();
    const mageId = s.selectedUnitId;
    if (!mageId || outOfTurn(s)) return;
    const game = s.game;
    const mage = unitById(game, mageId);
    if (!mage) return;
    const victims = novaVictims(game, mageId);
    const game2 = resolveNova(game, mageId, rng);
    if (game2 === game) return;
    set({
      game: game2,
      boltMode: false,
      selectedUnitId: null,
      selectedDieId: null,
      combatIntro: {
        kind: 'nova',
        attacker: mage.owner,
        attackerKind: 'mage',
        count: victims.length,
        defender: mage.owner,
        defenderKind: 'mage',
        attackFaces: '',
        defenseFaces: '',
      },
    });
    // Stagger the collapse animations — the death layer takes one event per
    // nonce, and a Nova fells several units at once.
    victims.forEach((v, i) => {
      window.setTimeout(() => {
        set((st) => ({
          lastDeath: { id: v.id, kind: v.kind, owner: v.owner, cell: v.cell },
          deathNonce: st.deathNonce + 1,
        }));
      }, i * 120);
    });
    window.setTimeout(() => {
      if (get().combatIntro?.kind === 'nova') set({ combatIntro: null });
    }, 4200);
  },

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

// Camera-lock view offset: whenever a HUMAN's turn begins (or the toggle
// flips), rotate the board so their home edge faces the fixed camera (visual
// seat 2, the bottom). Bots never move the view — spectators keep watching
// from wherever the last human left it.
useGame.subscribe((s) => {
  let next = s.viewOffset;
  if (!s.settings.cameraFix) next = 0;
  else if (!s.bots[s.game.current]) {
    const seat = s.game.seats[s.game.current] ?? 2;
    next = (2 - seat + 4) % 4;
  }
  if (next !== s.viewOffset) useGame.setState({ viewOffset: next });
});

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

/** Enemies the selected Mage could BOLT (used while bolt-targeting). */
export function boltTargetIds(game: GameState, unitId: string | null): Set<string> {
  if (game.turnPhase !== 'act' || !unitId) return new Set();
  return new Set(boltTargets(game, unitId).map((u) => u.id));
}

/** One selectable attack for the action bar: how many attackers coordinate, who
 *  they are, the enemy targeted, and the win odds. */
export interface AttackOption {
  label: string;
  count: number;
  attackerIds: string[];
  targetId: string;
  odds: number;
}

/**
 * Attack buttons to show on the action bar for the selected unit, so a player
 * can attack from the HUD instead of clicking the enemy on the 3D board. Targets
 * the best adjacent enemy (highest win odds, then most valuable kind) and offers
 * Single / Double / Triple for a Warrior (as coordinating Warriors + free dice
 * allow) or a lone Attack for a Mage (with its power die — Mages can't coordinate).
 */
export function attackOptions(game: GameState, unitId: string | null): AttackOption[] {
  if (game.turnPhase !== 'act' || !unitId) return [];
  const unit = unitById(game, unitId);
  if (!unit || unit.kind === 'priest') return [];
  const targets = attackTargets(game, unitId);
  if (targets.length === 0) return [];
  // Pick the single best target: highest win odds at full coordination, breaking
  // ties toward the more valuable enemy (mage > priest > warrior).
  const kindRank = { mage: 3, priest: 2, warrior: 1 } as const;
  let best = targets[0];
  let bestScore = -Infinity;
  for (const t of targets) {
    const planned = plannedAttackers(game, unitId, t.id);
    const score = combatOdds(game, planned, t.id).win * 10 + kindRank[t.kind];
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (unit.kind === 'mage') {
    return [
      { label: 'Attack', count: 1, attackerIds: [unitId], targetId: best.id, odds: combatOdds(game, [unitId], best.id).win },
    ];
  }
  const planned = plannedAttackers(game, unitId, best.id);
  const labels = ['Single Attack', 'Double Attack', 'Triple Attack'];
  const opts: AttackOption[] = [];
  for (let n = 1; n <= Math.min(3, planned.length); n++) {
    const attackerIds = planned.slice(0, n);
    opts.push({
      label: labels[n - 1],
      count: n,
      attackerIds,
      targetId: best.id,
      odds: combatOdds(game, attackerIds, best.id).win,
    });
  }
  return opts;
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

// Dev-only: expose the store so previews/tests can drive turns headlessly.
if (import.meta.env.DEV) {
  (window as unknown as { __game?: typeof useGame }).__game = useGame;
  // Raw engine hooks for the headless bot-balance arena (no store, no physics).
  (window as unknown as { __engine?: object }).__engine = {
    createGame,
    rollDice,
    discardDie,
    moveUnit,
    plannedAttackers,
    resolveAttack,
    collect,
    activate,
    resurrect,
    beginRitual,
    resolveBolt,
    resolveNova,
    endTurn,
  };
}
