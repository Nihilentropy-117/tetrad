// WebSocket session against the Tetrad server (join / rejoin / action),
// modeled on the human client's connection flow. Tracks the latest state by
// version and surfaces server errors to whoever is awaiting them.

import WebSocket from "ws";
import type { Action, ClientMsg, ServerMsg, StateMsg } from "./types.js";

export interface SessionEvents {
  onState(msg: StateMsg): void;
  onLobby(names: string[]): void;
  onError(code: string, message: string): void;
  onClose(): void;
}

export class Session {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private closedByUs = false;
  private reconnectDelay = 1000;

  code: string | null = null;
  playerId: string | null = null;
  latest: StateMsg | null = null;

  constructor(
    private url: string,
    private roomCode: string,
    readonly name: string,
    private events: SessionEvents
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on("open", () => {
      this.reconnectDelay = 1000;
      const hello: ClientMsg = this.token
        ? { t: "rejoin", code: this.roomCode, token: this.token }
        : { t: "join", code: this.roomCode.toUpperCase(), name: this.name };
      ws.send(JSON.stringify(hello));
    });
    ws.on("message", (data) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(data)) as ServerMsg;
      } catch {
        return;
      }
      this.handle(msg);
    });
    const retry = () => {
      if (this.closedByUs) return this.events.onClose();
      if (!this.token) return this.events.onClose(); // never joined; give up
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
    };
    ws.on("close", retry);
    ws.on("error", () => {
      /* 'close' follows */
    });
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case "joined":
        this.token = msg.token;
        this.code = msg.code;
        this.playerId = msg.playerId;
        break;
      case "lobby":
        this.events.onLobby(msg.players.map((p) => `${p.playerId} "${p.name}"${p.connected ? "" : " (offline)"}`));
        break;
      case "state":
        if (this.latest && msg.version <= this.latest.version) return; // stale
        this.latest = msg;
        this.events.onState(msg);
        break;
      case "error":
        this.events.onError(msg.code, msg.message);
        break;
      case "pong":
        break;
    }
  }

  sendAction(action: Action): void {
    this.ws?.send(JSON.stringify({ t: "action", action } satisfies ClientMsg));
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }
}
