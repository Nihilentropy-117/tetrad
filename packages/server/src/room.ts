// Room: the authority loop (DESIGN §3.3). Transport-agnostic — connections are
// anything with send(); the WebSocket wiring lives in server.ts. The engine is
// the sole validator; the room adds zero rules. Wall-clock concerns (decision
// timeouts) live here, never in the engine.

import {
  applyAction,
  eventsFor,
  initialState,
  legalActions,
  redact,
  type Action,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerId,
} from "@tetrad/engine";
import type { ServerMsg } from "./protocol.js";

export interface Conn {
  send(msg: ServerMsg): void;
}

/** Injected so tests can drive timeouts deterministically. */
export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realScheduler: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as NodeJS.Timeout),
};

export interface RoomOptions {
  code: string;
  seed: string;
  mode?: "ffa" | "teams";
  maxPlayers?: number; // project constraint: 4 (S3)
  decisionTimeoutMs?: number;
  scheduler?: Scheduler;
  /** append one line to the room's action log (JSONL) */
  persist?: (line: string) => void;
}

interface Seat {
  token: string;
  playerId: PlayerId;
  name: string;
  conn: Conn | null;
}

let tokenCounter = 0;
function newToken(): string {
  tokenCounter += 1;
  return `t${tokenCounter.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class Room {
  readonly code: string;
  readonly mode: "ffa" | "teams";
  private readonly seed: string;
  private readonly maxPlayers: number;
  private readonly decisionTimeoutMs: number;
  private readonly scheduler: Scheduler;
  private readonly persist: (line: string) => void;

  private seats: Seat[] = [];
  private state: GameState | null = null;
  private log: Action[] = [];
  private version = 0;
  private timer: unknown = null;
  private deadlineAt: number | null = null;

  constructor(opts: RoomOptions) {
    this.code = opts.code;
    this.seed = opts.seed;
    this.mode = opts.mode ?? "ffa";
    this.maxPlayers = opts.maxPlayers ?? 4;
    this.decisionTimeoutMs = opts.decisionTimeoutMs ?? 45_000;
    this.scheduler = opts.scheduler ?? realScheduler;
    this.persist = opts.persist ?? (() => {});
  }

  /** Read-only snapshot for tooling and tests. Never send this to clients. */
  get snapshot(): GameState | null {
    return this.state;
  }

  get started(): boolean {
    return this.state !== null;
  }

  get actionLog(): readonly Action[] {
    return this.log;
  }

  join(name: string, conn: Conn): { token: string; playerId: PlayerId } | null {
    if (this.started) {
      conn.send({ t: "error", code: "started", message: "game already started; use rejoin" });
      return null;
    }
    if (this.seats.length >= this.maxPlayers) {
      conn.send({ t: "error", code: "full", message: "room is full" });
      return null;
    }
    const seat: Seat = {
      token: newToken(),
      playerId: `p${this.seats.length}`,
      name: name || `P${this.seats.length}`,
      conn,
    };
    this.seats.push(seat);
    conn.send({ t: "joined", code: this.code, token: seat.token, playerId: seat.playerId, seat: this.seats.length - 1 });
    this.broadcastLobby();
    return { token: seat.token, playerId: seat.playerId };
  }

  rejoin(token: string, conn: Conn): boolean {
    const seat = this.seats.find((s) => s.token === token);
    if (!seat) {
      conn.send({ t: "error", code: "badToken", message: "unknown reconnect token" });
      return false;
    }
    seat.conn = conn;
    conn.send({ t: "joined", code: this.code, token: seat.token, playerId: seat.playerId, seat: this.seats.indexOf(seat) });
    if (this.state) {
      this.sendState(seat, []); // full current view; no replay needed (§3.3)
    } else {
      this.broadcastLobby();
    }
    return true;
  }

  disconnect(conn: Conn): void {
    const seat = this.seats.find((s) => s.conn === conn);
    if (!seat) return;
    seat.conn = null;
    if (!this.started) this.broadcastLobby();
  }

  start(token: string): void {
    const seat = this.seats.find((s) => s.token === token);
    if (!seat) return;
    if (seat !== this.seats[0]) {
      seat.conn?.send({ t: "error", code: "notHost", message: "only the host can start" });
      return;
    }
    if (this.started) {
      seat.conn?.send({ t: "error", code: "started", message: "already started" });
      return;
    }
    if (this.seats.length < 2) {
      seat.conn?.send({ t: "error", code: "needPlayers", message: "need at least 2 players" });
      return;
    }
    if (this.mode === "teams" && this.seats.length !== 4) {
      seat.conn?.send({ t: "error", code: "needPlayers", message: "teams mode needs exactly 4 players" });
      return;
    }
    const config: GameConfig = {
      mode: this.mode,
      players: this.seats.map((s) => ({ id: s.playerId, name: s.name })),
      dealerSeat: this.seats.length - 1, // player left of the dealer (seat 0) goes first (S7)
    };
    this.state = initialState(config, this.seed);
    this.persist(JSON.stringify({ header: true, seed: this.seed, config }));
    this.version += 1;
    this.armDecisionTimer();
    this.broadcast([]);
  }

  /** A client-intended action. The engine validates; we only map token→player. */
  handleAction(token: string, action: Action): void {
    const seat = this.seats.find((s) => s.token === token);
    if (!seat) return;
    if (!this.state) {
      seat.conn?.send({ t: "error", code: "notStarted", message: "game not started" });
      return;
    }
    if (action.player !== seat.playerId) {
      seat.conn?.send({ t: "error", code: "wrongPlayer", message: "you can only act as yourself" });
      return;
    }
    this.apply(action, seat.conn);
  }

  private apply(action: Action, errConn: Conn | null): void {
    if (!this.state) return;
    const r = applyAction(this.state, action);
    if (!r.ok) {
      errConn?.send({ t: "error", code: r.error.code, message: r.error.message });
      return;
    }
    this.state = r.state;
    this.log.push(action);
    this.version += 1;
    this.persist(JSON.stringify(action));
    this.armDecisionTimer(); // stamp the deadline before broadcasting it
    this.broadcast(r.events);
  }

  /** Stale decisions get answered with their default (§3.2/§3.3). */
  private armDecisionTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clear(this.timer);
      this.timer = null;
    }
    const pending = this.state?.pending;
    this.deadlineAt = null;
    if (!pending) return;
    const { id, player } = { id: pending.decision.id, player: pending.decision.player };
    const choice = pending.decision.default;
    this.deadlineAt = Date.now() + this.decisionTimeoutMs;
    this.timer = this.scheduler.set(() => {
      this.timer = null;
      if (this.state?.pending?.decision.id !== id) return; // already answered
      this.apply({ type: "decide", player, decisionId: id, choice }, null);
    }, this.decisionTimeoutMs);
  }

  private sendState(seat: Seat, events: GameEvent[]): void {
    if (!this.state || !seat.conn) return;
    const view = redact(this.state, seat.playerId);
    seat.conn.send({
      t: "state",
      version: this.version,
      view,
      legal: legalActions(this.state, seat.playerId),
      events: eventsFor(events, seat.playerId),
      ...(view.decision && this.deadlineAt !== null ? { deadline: this.deadlineAt } : {}),
    });
  }

  private broadcast(events: GameEvent[]): void {
    for (const seat of this.seats) this.sendState(seat, events);
  }

  private broadcastLobby(): void {
    const msg: ServerMsg = {
      t: "lobby",
      code: this.code,
      mode: this.mode,
      players: this.seats.map((s) => ({ playerId: s.playerId, name: s.name, connected: s.conn !== null })),
      host: this.seats[0]?.playerId ?? "p0",
    };
    for (const seat of this.seats) seat.conn?.send(msg);
  }
}
