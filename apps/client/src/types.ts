// Type-only imports from the engine (erased at build time — the client ships
// zero rules code) plus a mirror of the server wire protocol and pure display
// helpers for card ids.

import type {
  Action,
  ActionSpec,
  DecisionRequest,
  GameEvent,
  PlayerView,
} from "@tetrad/engine";

export type { Action, ActionSpec, DecisionRequest, GameEvent, PlayerView };

// --- wire protocol (mirrors packages/server/src/protocol.ts) ---------------

export type ClientMsg =
  | { t: "create"; name: string; mode?: "ffa" | "teams" }
  | { t: "join"; code: string; name: string }
  | { t: "rejoin"; code: string; token: string }
  | { t: "start" }
  | { t: "action"; action: Action }
  | { t: "ping" };

export interface LobbyPlayer {
  playerId: string;
  name: string;
  connected: boolean;
}

export type ServerMsg =
  | { t: "joined"; code: string; token: string; playerId: string; seat: number }
  | { t: "lobby"; code: string; mode: "ffa" | "teams"; players: LobbyPlayer[]; host: string }
  | { t: "state"; version: number; view: PlayerView; legal: ActionSpec[]; events: GameEvent[] }
  | { t: "error"; code: string; message: string }
  | { t: "pong" };

export type StateMsg = Extract<ServerMsg, { t: "state" }>;

// --- display helpers (presentation only; the server decides legality) ------

export const COLOR_HEX: Record<string, string> = {
  red: "#e5484d",
  blue: "#3e7bfa",
  green: "#30a46c",
  yellow: "#d6a316",
};

export interface CardInfo {
  id: string;
  kind: "number" | "stun" | "counter" | "rally" | "advantage" | "inspiration";
  color: string | null;
  label: string;
}

const KIND_LABEL: Record<string, string> = {
  stun: "Stun",
  counter: "Counter",
  rally: "Rally",
  advantage: "Advantage",
  inspiration: "Inspiration",
};

export function cardInfo(id: string): CardInfo {
  const [a, b] = id.split("-");
  if (a === "wild") {
    return { id, kind: b as CardInfo["kind"], color: null, label: KIND_LABEL[b] ?? b };
  }
  if (/^\d+$/.test(b)) {
    return { id, kind: "number", color: a, label: b === "0" ? "0 ✦" : b };
  }
  return { id, kind: b as CardInfo["kind"], color: a, label: KIND_LABEL[b] ?? b };
}

/** Display-only class metadata (names/flavor; rules stay on the server). */
export const CLASS_META: Record<string, { name: string; color: string; blurb: string }> = {
  zerker: { name: "Zerker", color: "red", blurb: "Rage, big dice, bigger risks" },
  knight: { name: "Knight", color: "red", blurb: "Block, taunt, punish" },
  warlock: { name: "Warlock", color: "blue", blurb: "Curses and control" },
  sorcerer: { name: "Sorcerer", color: "blue", blurb: "Chaos with a safety net" },
  thief: { name: "Thief", color: "green", blurb: "Steal, cheat, vanish" },
  scout: { name: "Scout", color: "green", blurb: "Shape your hand, shape the game" },
  priest: { name: "Priest", color: "yellow", blurb: "Heal, banish, defy death" },
  paladin: { name: "Paladin", color: "yellow", blurb: "Steady shield, holy smite" },
};

export function playerName(view: PlayerView | null, id: string): string {
  if (!view) return id;
  const p = view.players.find((x) => x.id === id);
  if (!p) return id;
  const meta = p.classId ? CLASS_META[p.classId]?.name : null;
  return meta ? `${id} (${meta})` : id;
}

/** Render an engine event as one feed line. */
export function fmtEvent(e: GameEvent, you: string): string | null {
  const p = (id: unknown) => (id === you ? "You" : String(id));
  switch (e.type) {
    case "TurnStarted":
      return `— ${p(e.player)}${e.actingAs !== e.player ? ` (played by ${p(e.actingAs)})` : ""} — turn ${e.turn}`;
    case "CardPlayed":
      return `${p(e.player)} played ${cardInfo(String(e.card)).color ?? "wild"} ${cardInfo(String(e.card)).label}${e.viaWhims ? " (whims)" : ""}`;
    case "DiceRolled":
      return `${p(e.roller)} rolled ${Array.isArray(e.faces) ? (e.faces as number[]).join("+") : e.total} = ${e.total}${e.loaded ? " (loaded!)" : ""}`;
    case "DamageDealt":
      return `${p(e.src)} hit ${p(e.tgt)} for ${e.amount} (${e.hp} HP left)`;
    case "Healed":
      return `${p(e.target)} healed ${e.amount} (${e.hp} HP)`;
    case "SaveRolled":
      return `${p(e.roller)} save vs ${e.dc}: ${e.total} — ${e.passed ? "passed" : "failed"}`;
    case "ColorChanged":
      return `color is now ${String(e.color).toUpperCase()}`;
    case "ColorChosen":
      return `${p(e.by)} chose ${String(e.color).toUpperCase()}`;
    case "StatusApplied":
      return `${p(e.owner)} gains ${e.status}`;
    case "StatusExpired":
      return `${e.status} ends on ${p(e.owner)}`;
    case "Stunned":
      return `${p(e.target)} is stunned (${e.turns})`;
    case "TurnSkipped":
      return `${p(e.player)}'s turn is skipped`;
    case "OrderReversed":
      return `play order reversed`;
    case "DrewCard":
      return `${p(e.player)} drew a card`;
    case "CardDrawn":
      return `you drew ${cardInfo(String(e.card)).color ?? "wild"} ${cardInfo(String(e.card)).label}`;
    case "AbilityTriggered":
      return `${p(e.player)} uses ${e.name}`;
    case "AttackBlocked":
      return `${p(e.player)} blocked the attack (${e.by})`;
    case "DamagePrevented":
      return `${p(e.target)} takes no damage`;
    case "IllEffectPrevented":
      return `${p(e.target)} shrugs off the effect`;
    case "PlayerDied":
      return `☠ ${p(e.player)} has fallen`;
    case "PlayerRevived":
      return `✚ ${p(e.player)} returns at ${e.hp} HP`;
    case "PlayerWon":
      return `★ ${p(e.player)} cards out — place ${e.place}!`;
    case "PlayerConceded":
      return `${p(e.player)} concedes`;
    case "GameEnded":
      return `game over — winner: ${p(e.winner)}`;
    case "TurnStolen":
      return `${p(e.by)} steals ${p(e.victim)}'s turn!`;
    case "RageActivated":
      return `${p(e.player)} is RAGING (+${e.bonus})`;
    case "AnytimeDiscard":
      return `${p(e.player)} discards ${cardInfo(String(e.card)).label} — any time!`;
    case "CardViewed":
      return `you see: ${cardInfo(String(e.card)).color ?? "wild"} ${cardInfo(String(e.card)).label}`;
    case "DecisionRequested":
    case "TurnEnded":
    case "ClassChosen":
    case "Attack":
      return null; // rendered elsewhere / too noisy
    default:
      return e.type;
  }
}
