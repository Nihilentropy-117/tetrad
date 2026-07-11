// Room integration tests with fake connections: authority, redaction, decision
// timeouts, reconnect. No real sockets needed — Room is transport-agnostic.

import { describe, expect, it } from "vitest";
import type { ServerMsg } from "../src/protocol.js";
import { Room, type Conn, type Scheduler } from "../src/room.js";

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  send(msg: ServerMsg): void {
    this.msgs.push(msg);
  }
  last<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      if (this.msgs[i].t === t) return this.msgs[i] as Extract<ServerMsg, { t: T }>;
    }
    return undefined;
  }
}

class FakeScheduler implements Scheduler {
  private q = new Map<number, () => void>();
  private n = 0;
  set(fn: () => void, _ms: number): unknown {
    this.q.set(++this.n, fn);
    return this.n;
  }
  clear(handle: unknown): void {
    this.q.delete(handle as number);
  }
  /** fire all queued timers (repeatedly, since firing may re-arm) */
  flush(): void {
    let guard = 0;
    while (this.q.size > 0) {
      if (++guard > 100) throw new Error("scheduler did not settle");
      const [k, fn] = this.q.entries().next().value as [number, () => void];
      this.q.delete(k);
      fn();
    }
  }
}

function mkRoom(classes: ("zerker" | "scout" | "priest")[], scheduler = new FakeScheduler()) {
  const room = new Room({ code: "TEST", seed: "server-test", scheduler, decisionTimeoutMs: 10 });
  const conns = classes.map(() => new FakeConn());
  const tokens = classes.map((_, i) => room.join(`P${i}`, conns[i])!.token);
  room.start(tokens[0]);
  classes.forEach((cls, i) => {
    room.handleAction(tokens[i], { type: "chooseClass", player: `p${i}`, classId: cls });
  });
  scheduler.flush(); // settle any initial decision (wild first card → dealer color)
  return { room, conns, tokens, scheduler };
}

describe("Room", () => {
  it("runs lobby → class select → playing, with per-player redaction", () => {
    const { room, conns } = mkRoom(["zerker", "priest"]);
    const s = room.snapshot!;
    expect(s.phase).toBe("playing");

    const v0 = conns[0].last("state")!;
    const v1 = conns[1].last("state")!;
    // own hand visible, other hand hidden — only counts leak
    expect(v0.view.players[0].hand).toBeDefined();
    expect(v0.view.players[1].hand).toBeUndefined();
    expect(v1.view.players[0].hand).toBeUndefined();
    expect(v0.view.players[1].handCount).toBe(7);
    // no message to p0 ever contains p1's cards or the RNG
    for (const m of conns[0].msgs) {
      const raw = JSON.stringify(m);
      expect(raw).not.toContain('"rng"');
      if (m.t === "state") expect(m.view.players[1].hand).toBeUndefined();
    }
    // only the acting player has legal actions
    const acting = s.turn.activePlayer;
    const actingConn = acting === "p0" ? v0 : v1;
    const otherConn = acting === "p0" ? v1 : v0;
    expect(actingConn.legal.length).toBeGreaterThan(0);
    expect(otherConn.legal.length).toBe(0);
  });

  it("rejects acting as another player and invalid actions, state untouched", () => {
    const { room, conns, tokens } = mkRoom(["zerker", "priest"]);
    const before = JSON.stringify(room.snapshot);
    room.handleAction(tokens[1], { type: "drawCard", player: "p0" }); // impersonation
    expect(conns[1].last("error")?.code).toBe("wrongPlayer");
    const notYourTurn = room.snapshot!.turn.activePlayer === "p0" ? 1 : 0;
    room.handleAction(tokens[notYourTurn], { type: "drawCard", player: `p${notYourTurn}` });
    expect(conns[notYourTurn].last("error")?.code).toBe("notYourTurn");
    expect(JSON.stringify(room.snapshot)).toBe(before);
  });

  it("answers a stale decision with its default on timeout (Scout draw)", () => {
    const { room, tokens, scheduler } = mkRoom(["scout", "zerker"]);
    const s0 = room.snapshot!;
    expect(s0.turn.activePlayer).toBe("p0");
    const handBefore = s0.players[0].hand.length;
    room.handleAction(tokens[0], { type: "drawCard", player: "p0" });
    expect(room.snapshot!.pending?.decision.kind).toBe("scoutReturn"); // SC-P
    scheduler.flush(); // decision timeout fires → default (keep N, return last 2)
    expect(room.snapshot!.pending).toBeNull();
    expect(room.snapshot!.players[0].hand.length).toBe(handBefore + 1);
  });

  it("sends a decision deadline only to the deciding player, and names in the view", () => {
    const { room, conns, tokens } = mkRoom(["scout", "zerker"]);
    // names flow through redaction
    const v = conns[0].last("state")!;
    expect(v.view.players.map((p) => p.name)).toEqual(["P0", "P1"]);
    // trigger a pending decision (Scout draw → scoutReturn)
    room.handleAction(tokens[0], { type: "drawCard", player: "p0" });
    expect(room.snapshot!.pending?.decision.player).toBe("p0");
    const s0 = conns[0].last("state")!;
    const s1 = conns[1].last("state")!;
    expect(s0.view.decision).toBeTruthy();
    expect(typeof s0.deadline).toBe("number");
    expect(s0.deadline!).toBeGreaterThan(Date.now() - 1000);
    expect(s1.view.decision).toBeNull();
    expect(s1.deadline).toBeUndefined();
  });

  it("reconnect delivers the current redacted view without replay", () => {
    const { room, conns, tokens } = mkRoom(["zerker", "priest"]);
    room.disconnect(conns[0]);
    const fresh = new FakeConn();
    expect(room.rejoin(tokens[0], fresh)).toBe(true);
    const state = fresh.last("state")!;
    expect(state.view.you).toBe("p0");
    expect(state.view.players[0].hand).toBeDefined();
    expect(state.view.players[1].hand).toBeUndefined();
  });

  it("appends a replayable JSONL log: header + every accepted action", () => {
    const lines: string[] = [];
    const scheduler = new FakeScheduler();
    const room = new Room({
      code: "LOGS",
      seed: "log-test",
      scheduler,
      persist: (l) => lines.push(l),
    });
    const c0 = new FakeConn();
    const c1 = new FakeConn();
    const t0 = room.join("A", c0)!.token;
    room.join("B", c1);
    room.start(t0);
    expect(JSON.parse(lines[0]).header).toBe(true);
    expect(JSON.parse(lines[0]).seed).toBe("log-test");
    room.handleAction(t0, { type: "chooseClass", player: "p0", classId: "zerker" });
    expect(JSON.parse(lines[1])).toEqual({ type: "chooseClass", player: "p0", classId: "zerker" });
    // rejected actions are not logged
    room.handleAction(t0, { type: "chooseClass", player: "p0", classId: "thief" });
    expect(lines.length).toBe(2);
  });

  it("enforces host-only start and minimum players", () => {
    const scheduler = new FakeScheduler();
    const room = new Room({ code: "HOST", seed: "s", scheduler });
    const c0 = new FakeConn();
    const c1 = new FakeConn();
    const t0 = room.join("A", c0)!.token;
    room.start(t0);
    expect(c0.last("error")?.code).toBe("needPlayers");
    const t1 = room.join("B", c1)!.token;
    room.start(t1);
    expect(c1.last("error")?.code).toBe("notHost");
    room.start(t0);
    expect(room.started).toBe(true);
  });
});
