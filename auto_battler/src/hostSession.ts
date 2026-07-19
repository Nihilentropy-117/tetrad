// Host-side WebSocket session: like bot-client's Session (which can only join
// an existing room) but it CREATES the room and can send "start". Exposes the
// same surface the bot-client Agent uses (name, sendAction), so an Agent can
// drive this seat unchanged.

import WebSocket from "ws";
import type { Action, ClientMsg, LobbyPlayer, ServerMsg, StateMsg } from "../../bot-client/src/types.js";

export interface HostSessionEvents {
  onState(msg: StateMsg): void;
  onLobby(players: LobbyPlayer[]): void;
  onError(code: string, message: string): void;
  onClose(): void;
}

export class HostSession {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private closedByUs = false;
  private reconnectDelay = 1000;
  private startSent = false;
  private codeResolve!: (code: string) => void;
  private codeReject!: (err: Error) => void;

  code: string | null = null;
  playerId: string | null = null;
  latest: StateMsg | null = null;
  /** resolves with the room code once the server acks the create */
  readonly codeReady = new Promise<string>((res, rej) => {
    this.codeResolve = res;
    this.codeReject = rej;
  });

  constructor(
    private url: string,
    readonly name: string,
    private events: HostSessionEvents
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on("open", () => {
      this.reconnectDelay = 1000;
      const hello: ClientMsg =
        this.token && this.code
          ? { t: "rejoin", code: this.code, token: this.token }
          : { t: "create", name: this.name, mode: "ffa" };
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
      if (!this.token) {
        this.codeReject(new Error("connection closed before the room was created"));
        return this.events.onClose();
      }
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
        this.codeResolve(msg.code);
        break;
      case "lobby":
        this.events.onLobby(msg.players);
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

  /** Host-only: start the game. Idempotent. */
  start(): void {
    if (this.startSent) return;
    this.startSent = true;
    this.ws?.send(JSON.stringify({ t: "start" } satisfies ClientMsg));
  }

  sendAction(action: Action): void {
    this.ws?.send(JSON.stringify({ t: "action", action } satisfies ClientMsg));
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }
}
