// Real-socket smoke test: two WebSocket clients create/join/start a game and
// reach the playing phase, with redaction verified on the wire.

import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer } from "../src/server.js";

const PORT = 18923;
const server = startServer({ port: PORT });

afterAll(() => server.close());

interface TestClient {
  ws: WebSocket;
  recv: () => Promise<any>;
}

function client(): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const msgs: any[] = [];
    const waiters: ((m: any) => void)[] = [];
    ws.on("message", (d) => {
      const m = JSON.parse(String(d));
      const w = waiters.shift();
      if (w) w(m);
      else msgs.push(m);
    });
    const recv = () =>
      new Promise<any>((res, rej) => {
        if (msgs.length) return res(msgs.shift());
        const timer = setTimeout(() => rej(new Error("recv timeout")), 5000);
        waiters.push((m) => {
          clearTimeout(timer);
          res(m);
        });
      });
    ws.on("open", () => resolve({ ws, recv }));
    ws.on("error", reject);
  });
}

function send(c: TestClient, msg: unknown): void {
  c.ws.send(JSON.stringify(msg));
}

describe("websocket end-to-end", () => {
  it("two clients reach the playing phase over real sockets", async () => {
    const a = await client();
    const b = await client();

    send(a, { t: "create", name: "Alice" });
    const joinedA = await a.recv();
    expect(joinedA.t).toBe("joined");
    await a.recv(); // lobby

    send(b, { t: "join", code: joinedA.code, name: "Bob" });
    const joinedB = await b.recv();
    expect(joinedB.playerId).toBe("p1");
    await a.recv(); // lobby update
    await b.recv();

    send(a, { t: "start" });
    const stateA = await a.recv();
    await b.recv();
    expect(stateA.t).toBe("state");
    expect(stateA.view.phase).toBe("classSelect");
    expect(stateA.view.players[1].hand).toBeUndefined(); // redaction on the wire

    send(a, { t: "action", action: { type: "chooseClass", player: "p0", classId: "zerker" } });
    await a.recv();
    await b.recv();
    send(b, { t: "action", action: { type: "chooseClass", player: "p1", classId: "priest" } });
    let finalA = await a.recv();
    let finalB = await b.recv();

    // a wild first card inserts one dealer color decision — settle it
    let guard = 0;
    while (finalA.view.phase !== "playing") {
      expect(++guard).toBeLessThan(5);
      const holder = finalA.view.decision ? { m: finalA, c: a } : { m: finalB, c: b };
      const d = holder.m.view.decision;
      expect(d).toBeTruthy();
      send(holder.c, {
        t: "action",
        action: { type: "decide", player: d.player, decisionId: d.id, choice: d.default },
      });
      finalA = await a.recv();
      finalB = await b.recv();
    }

    expect(finalA.view.phase).toBe("playing");
    expect(finalA.view.players[1].hand).toBeUndefined();
    expect(JSON.stringify(finalA)).not.toContain('"rng"');
    const acting = finalA.view.turn.actingPlayer;
    const actingMsg = acting === "p0" ? finalA : finalB;
    expect(actingMsg.legal.some((l: any) => l.type === "drawCard")).toBe(true);

    a.ws.close();
    b.ws.close();
  });
});
