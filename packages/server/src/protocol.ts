// Wire protocol between clients and the server. Clients only ever see
// ServerMsg payloads: redacted views, filtered events, legal-action hints.

import type { Action, ActionSpec, GameEvent, PlayerId, PlayerView } from "@tetrad/engine";

export type ClientMsg =
  | { t: "create"; name: string; mode?: "ffa" | "teams" }
  | { t: "join"; code: string; name: string; bot?: boolean }
  | { t: "rejoin"; code: string; token: string }
  | { t: "start" } // host only
  | { t: "recuse"; spectate: boolean } // host only, pre-start: sit out and watch
  | { t: "action"; action: Action }
  | { t: "ping" };

export interface LobbyPlayer {
  playerId: PlayerId;
  name: string;
  connected: boolean;
  bot?: boolean;
  spectating?: boolean;
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
      /** epoch ms when the pending decision auto-resolves to its default */
      deadline?: number;
    }
  | { t: "error"; code: string; message: string }
  | { t: "pong" };
