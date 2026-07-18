// Self-contained mirror of the Tetrad wire protocol and the engine types it
// references. Deliberately duplicated from packages/server/src/protocol.ts and
// packages/engine/src/{types,redact}.ts so this folder imports NOTHING from
// the main codebase. If the protocol changes upstream, update this mirror.

export type Color = "red" | "blue" | "green" | "yellow";
export const COLORS: readonly Color[] = ["red", "blue", "green", "yellow"];

export type CardId = string;
export type PlayerId = string;

export type ClassId =
  | "zerker"
  | "knight"
  | "warlock"
  | "sorcerer"
  | "thief"
  | "scout"
  | "priest"
  | "paladin";

// --- actions (engine types.ts) ----------------------------------------------

export type Action =
  | { type: "chooseClass"; player: PlayerId; classId: ClassId }
  | {
      type: "playCard";
      player: PlayerId;
      card: CardId;
      targets?: PlayerId[];
      attackTarget?: PlayerId;
      chosenColor?: Color;
      declaredColor?: Color;
      extra?: Record<string, unknown>;
    }
  | { type: "drawCard"; player: PlayerId }
  | { type: "endTurn"; player: PlayerId }
  | { type: "decide"; player: PlayerId; decisionId: string; choice: unknown }
  | { type: "anytime"; player: PlayerId; card: CardId; extra?: Record<string, unknown> }
  | { type: "concede"; player: PlayerId };

export interface TargetSpec {
  count: number;
  who: "any" | "enemy" | "other" | "allyOrSelf" | "dead";
  upTo?: boolean;
}

/** Legal-action hints computed by the server; the bot never derives legality. */
export interface ActionSpec {
  type: Action["type"];
  card?: CardId;
  needs?: {
    targets?: TargetSpec;
    attackTarget?: boolean;
    chosenColor?: boolean;
    extra?: string;
    /** chameleon: colors this card may legally be declared as (required when
     * extra is "declaredColor"; optional otherwise) */
    declareColors?: Color[];
  };
  decisionId?: string;
  classId?: ClassId;
}

export interface DecisionRequest {
  id: string;
  player: PlayerId;
  kind: string;
  prompt: string;
  options?: unknown[];
  default: unknown;
}

export interface GameEvent {
  type: string;
  private?: PlayerId[];
  [k: string]: unknown;
}

// --- per-player redacted view (engine redact.ts) ----------------------------

export interface PlayerView {
  you: PlayerId;
  phase: "classSelect" | "playing" | "finished";
  mode: "ffa" | "teams";
  activeColor: string;
  activeNumber: number | null;
  topCard: CardId | null;
  drawPileCount: number;
  underPileCount: number;
  colorChangeCount: number;
  turn: {
    activePlayer: PlayerId;
    actingPlayer: PlayerId;
    direction: 1 | -1;
    hasDrawn: boolean;
  };
  players: Array<{
    id: PlayerId;
    name: string;
    seat: number;
    classId: string | null;
    hp: number;
    maxHp: number;
    status: string;
    handCount: number;
    hand?: CardId[];
    statuses: Array<{ key: string; source: PlayerId }>;
  }>;
  placements: PlayerId[];
  winner: PlayerId | "team0" | "team1" | null;
  decision: DecisionRequest | null;
}

// --- wire protocol (server protocol.ts) --------------------------------------

export type ClientMsg =
  | { t: "create"; name: string; mode?: "ffa" | "teams" }
  | { t: "join"; code: string; name: string; bot?: boolean }
  | { t: "rejoin"; code: string; token: string }
  | { t: "start" }
  | { t: "recuse"; spectate: boolean }
  | { t: "action"; action: Action }
  | { t: "ping" };

export interface LobbyPlayer {
  playerId: PlayerId;
  name: string;
  connected: boolean;
}

export type ServerMsg =
  | { t: "joined"; code: string; token: string; playerId: PlayerId; seat: number }
  | { t: "lobby"; code: string; mode: "ffa" | "teams"; players: LobbyPlayer[]; host: PlayerId }
  | {
      t: "state";
      version: number;
      view: PlayerView;
      legal: ActionSpec[];
      events: GameEvent[];
      /** epoch ms when a pending decision auto-resolves to its default */
      deadline?: number;
    }
  | { t: "error"; code: string; message: string }
  | { t: "pong" };

export type StateMsg = Extract<ServerMsg, { t: "state" }>;

// --- card display helpers (mirrors apps/client/src/types.ts, display only) ---

const KIND_LABEL: Record<string, string> = {
  stun: "Stun",
  counter: "Counter",
  rally: "Rally",
  advantage: "Advantage",
  inspiration: "Inspiration",
};

export interface CardInfo {
  id: string;
  kind: "number" | "stun" | "counter" | "rally" | "advantage" | "inspiration";
  color: string | null;
  label: string;
}

export function cardInfo(id: string): CardInfo {
  const [a = "", b = ""] = id.split("-");
  if (a === "wild") {
    return { id, kind: b as CardInfo["kind"], color: null, label: KIND_LABEL[b] ?? b };
  }
  if (/^\d+$/.test(b)) {
    return { id, kind: "number", color: a, label: b };
  }
  return { id, kind: b as CardInfo["kind"], color: a, label: KIND_LABEL[b] ?? b };
}

/** "green 7", "red Stun", "wild Inspiration" — human name for a card id. */
export function cardName(id: string): string {
  const info = cardInfo(id);
  const base = `${info.color ?? "wild"} ${info.label}`;
  return info.kind === "number" && info.label === "0" ? `${base} (Tetrad/Ultimate)` : base;
}
