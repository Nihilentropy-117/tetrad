// Core shared types for the Tetrad rules engine.
// Rule IDs (S*, T*, A*, SP*, C*, ZK-*, ...) refer to DESIGN.md.

export type Color = "red" | "blue" | "green" | "yellow";
export const COLORS: readonly Color[] = ["red", "blue", "green", "yellow"];

export type CardKind =
  | "number" // 0-9; 0 is the Tetrad/Ultimate (SP6)
  | "stun" // Skip analog (SP1), pseudo-number 11 (D2)
  | "counter" // Reverse analog (SP2), pseudo-number 12 (D2)
  | "rally" // Draw Two analog (SP3), pseudo-number 13
  | "advantage" // Wild (SP4)
  | "inspiration"; // Wild Draw Four (SP5)

export type CardId = string;
export type PlayerId = string;

export interface CardDef {
  id: CardId;
  kind: CardKind;
  color: Color | null; // null for wilds
  number: number | null; // 0-9 for number cards, null otherwise
}

export type ClassId =
  | "zerker"
  | "knight"
  | "warlock"
  | "sorcerer"
  | "thief"
  | "scout"
  | "priest"
  | "paladin";

export type Parity = "odd" | "even";

export type AbilityKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "stun"
  | "counter"
  | "rally"
  | "advantage"
  | "inspiration";

/** n d6 + plus */
export interface Dice {
  n: number;
  plus: number;
}

export interface SaveSpec {
  dc: number;
  /** what happens on a successful save */
  onPass: "half" | "none";
}

export type TargetWho = "any" | "enemy" | "other" | "allyOrSelf" | "dead";

export interface TargetSpec {
  count: number; // how many targets the action must supply
  who: TargetWho;
  upTo?: boolean; // fewer than count allowed
}

// ---------------------------------------------------------------------------
// Declarative effect specs (interpreted by effects.ts). Cards/classes are data.
// ---------------------------------------------------------------------------

export type Sel = "t0" | "t1" | "t2" | "self" | "allEnemies";

export type EffectSpec =
  | {
      do: "damage";
      to: Sel;
      dice: Dice;
      save?: SaveSpec;
      aoe?: boolean;
      rollTwice?: boolean;
      lifesteal?: boolean; // heal source for damage dealt
    }
  | { do: "heal"; to: Sel; dice: Dice; exploding?: boolean }
  | { do: "stun"; to: Sel; turns: number; save?: { dc: number; reduceTo: number } }
  | { do: "draw"; who: Sel; n: number; forced?: boolean }
  | { do: "applyStatus"; to: Sel | "global"; status: StatusSpec }
  | { do: "removeIllEffects"; to: Sel }
  | { do: "custom"; key: string; arg?: unknown };

export interface Mods {
  dmgOutFlat?: number;
  dmgOutMult?: number;
  dmgInFlat?: number; // negative = reduction
  dmgInMult?: number; // 2 = frenzy taken, applied via defender-min search (C2)
  colorBonusOverride?: number; // WL-A pact demon
  saveRolls?: number; // roll N times take best (ZK-7)
  attackAdvantage?: boolean; // PA-4 blessed weapon
  noDamage?: boolean; // KN-0 / PR-A (with bypass)
  sanctuaryBypassDc?: number; // PR-A: attacker save to bypass
  noIllEffects?: boolean; // PR-5
  untargetable?: boolean; // PR-S banish
  revealHand?: boolean; // SC-0
  hpFloor?: number; // raging ZK-R
  curse?: boolean;
  lifestealHalf?: boolean; // ZK-1 battle cry
  rageBonus?: number; // ZK-A/ZK-I stacking (+3/+4)
  halfFrom?: PlayerId; // KN-4: half damage from taunt target
}

export type TriggerOn =
  | "takeDamage"
  | "targetedByAbility"
  | "attackIncoming" // before damage applies (block-style)
  | "illEffectIncoming"
  | "aoeIncoming"
  | "colorChanged" // global (TH-A)
  | "abilityCardPlayed" // global (PA-8)
  | "specialCardResolving" // SO-C dispel (special branch)
  | "numberAbilityResolving"; // SO-C dispel (1-9 branch)

export interface ArmedSpec {
  on: TriggerOn;
  key: string; // handler key in the trigger registry
  uses: number;
}

export type DurSpec =
  | { kind: "colorChange"; changes?: number }
  | { kind: "endOfTurn" }
  | { kind: "sourceNextTurnEnd" }
  | { kind: "untilTriggered" }
  | { kind: "rage" } // lives while owner has any rage status
  | { kind: "permanent" };

export interface StatusSpec {
  key: string;
  dur: DurSpec;
  mods?: Mods;
  /** effects run at the start of the SOURCE's turn (A8) */
  tick?: EffectSpec[];
  armed?: ArmedSpec;
  ill?: boolean; // counts as an ill effect for prevention/removal
  data?: Record<string, unknown>;
}

export interface StatusInst {
  id: string;
  key: string;
  source: PlayerId; // who created it (A6 grace, A8 ticks)
  owner: PlayerId | "global"; // who it sits on
  mods?: Mods;
  tick?: EffectSpec[];
  armed?: ArmedSpec;
  ill?: boolean;
  dur:
    | { kind: "colorChange"; at: number; grace?: boolean }
    | { kind: "endOfTurn"; turn: number }
    | { kind: "sourceNextTurnEnd"; createdTurn: number }
    | { kind: "untilTriggered" }
    | { kind: "rage" }
    | { kind: "permanent" };
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Class definitions (data)
// ---------------------------------------------------------------------------

export interface AbilitySpec {
  name: string;
  /** how the granted standard attack interacts with the ability (A3) */
  attack: "replace" | "retain" | "grant" | "none";
  targets?: TargetSpec;
  effects: EffectSpec[];
  /** override when the actor is Raging (Zerker) */
  raging?: { effects?: EffectSpec[]; targets?: TargetSpec };
  /** resolve the granted attack before the ability effects (TH-7) */
  attackFirst?: boolean;
  /** class inspiration draw effects replace the standard draw-4 (Q13) */
  replacesInspirationDraw?: boolean;
  /** rally: replaces the standard target-draws-2 (SP3) */
  replacesRallyDraw?: boolean;
  /** rally: attack goes to attackTarget/next enemy instead of t0 (M12) */
  rallyAttackTo?: "free";
  /** needs extra action params (client hint) */
  extra?: string;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  color: Color;
  parity: Parity;
  maxHp: number;
  attackDice: number; // number of d6 in the standard attack
  colorBonus: number; // flat bonus when color applies (T5)
  alwaysColorBonus?: boolean; // SO-P
  passive?: string; // key into passive hooks
  abilities: Partial<Record<AbilityKey, AbilitySpec>>;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type RngState =
  | { kind: "seeded"; s: number }
  | { kind: "scripted"; values: number[]; i: number };

export interface GameConfig {
  mode: "ffa" | "teams"; // teams: even seats vs odd seats (S8)
  players: { id: PlayerId; name: string }[];
  dealerSeat: number;
}

export type PlayerStatus = "active" | "dead" | "won" | "conceded";

export interface PlayerState {
  id: PlayerId;
  seat: number;
  classId: ClassId | null;
  hp: number;
  status: PlayerStatus;
  hand: CardId[];
  lastHitBy: PlayerId | null; // SP2 counter target
  pendingClass: ClassId | null; // hidden until simultaneous reveal (S4)
}

export interface TurnState {
  activePlayer: PlayerId;
  direction: 1 | -1;
  hasDrawn: boolean;
  attacksUsed: number;
  skipAttack: boolean; // ZK-9
  stolenBy: PlayerId | null; // WL-I delirium: who is acting
  homefieldGiven: number; // SC-A max 2/turn
}

export interface FieldState {
  activeColor: Color;
  activeNumber: number | null; // pseudo-numbers 11/12/13 for specials
  pile: CardId[]; // top = last element
  underPile: CardId[]; // discard actions (SP7)
}

export interface DecisionRequest {
  id: string;
  player: PlayerId;
  kind: string;
  prompt: string;
  options?: unknown[];
  default: unknown;
}

/** Serializable resolution op; state.stack drives the micro-step machine. */
export interface Op {
  t: string;
  [k: string]: unknown;
}

export interface GameState {
  config: GameConfig;
  phase: "classSelect" | "playing" | "finished";
  rng: RngState;
  players: PlayerState[];
  turn: TurnState;
  field: FieldState;
  drawPile: CardId[];
  staging: CardId[]; // cards held mid-resolution (Scout keeps, Mastermind, ...)
  effects: StatusInst[];
  stack: Op[];
  pending: { op: Op; decision: DecisionRequest } | null;
  colorChangeCount: number;
  turnCount: number;
  nextId: number; // id/hitId counter
  scratch: Record<string, unknown>; // transient cross-op data (e.g. rally draws)
  placements: PlayerId[]; // card-out order, then survivors, then dead (reverse)
  deaths: PlayerId[]; // elimination order
  winner: PlayerId | "team0" | "team1" | null;
}

// ---------------------------------------------------------------------------
// Actions & events
// ---------------------------------------------------------------------------

export type Action =
  | { type: "chooseClass"; player: PlayerId; classId: ClassId }
  | {
      type: "playCard";
      player: PlayerId;
      card: CardId;
      targets?: PlayerId[];
      attackTarget?: PlayerId; // for "grant" abilities (A3)
      chosenColor?: Color; // wilds
      declaredColor?: Color; // TH-I it's-not-cheating
      extra?: Record<string, unknown>; // ability-specific params
    }
  | { type: "drawCard"; player: PlayerId }
  | { type: "endTurn"; player: PlayerId } // decline to play after drawing (F1)
  | { type: "decide"; player: PlayerId; decisionId: string; choice: unknown }
  | { type: "anytime"; player: PlayerId; card: CardId; extra?: Record<string, unknown> } // SP8
  | { type: "concede"; player: PlayerId };

export interface GameEvent {
  type: string;
  /** if set, only these players may see this event (server filters) */
  private?: PlayerId[];
  [k: string]: unknown;
}

export interface RuleViolation {
  code: string;
  message: string;
}

export type Reply =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: RuleViolation };

/** Legal-action hints sent to clients (server-computed; client stays rules-free). */
export interface ActionSpec {
  type: Action["type"];
  card?: CardId;
  needs?: {
    targets?: TargetSpec;
    attackTarget?: boolean;
    chosenColor?: boolean;
    extra?: string;
    /** TH-I chameleon: colors this card may legally be declared as (M13).
     * Required when extra is "declaredColor"; optional otherwise. */
    declareColors?: Color[];
  };
  decisionId?: string;
  classId?: ClassId;
}

export interface Ctx {
  s: GameState;
  events: GameEvent[];
}
