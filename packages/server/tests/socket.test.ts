// Real-socket smoke test: two WebSocket clients create/join/start a game and
// reach the playing phase, with redaction verified on the wire.

import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { SpawnBotRequest } from "../src/bots.js";
import { startServer } from "../src/server.js";

const PORT = 18923;
const spawned: SpawnBotRequest[] = [];
const server = startServer({
  port: PORT,
  spawnBot: (req) => {
    spawned.push(req);
    return null;
  },
});

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

  it("host can list models and add a bot; non-hosts cannot", async () => {
    const host = await client();
    const guest = await client();

    send(host, { t: "create", name: "Alice" });
    const joined = await host.recv();
    await host.recv(); // lobby

    send(guest, { t: "join", code: joined.code, name: "Bob" });
    await guest.recv(); // joined
    await host.recv(); // lobby update
    await guest.recv();

    send(host, { t: "listBotModels" });
    const models = await host.recv();
    expect(models.t).toBe("botModels");
    expect(models.models.length).toBeGreaterThan(0);

    send(guest, { t: "addBot", model: models.models[0] });
    const denied = await guest.recv();
    expect(denied).toMatchObject({ t: "error", code: "notHost" });
    expect(spawned).toHaveLength(0);

    send(host, { t: "addBot", model: models.models[0], instructions: "play safe" });
    // no ack on success; wait for the guest's denial round-trip above to have
    // proven ordering, then assert the spawn request landed
    await new Promise((r) => setTimeout(r, 50));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({
      code: joined.code,
      model: models.models[0],
      instructions: "play safe",
      serverUrl: `ws://127.0.0.1:${PORT}`,
    });

    host.ws.close();
    guest.ws.close();
  });
});
