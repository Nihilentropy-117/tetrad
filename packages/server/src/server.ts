// WebSocket wiring: routes ClientMsg to rooms. All game logic is in the engine;
// all authority logic is in Room. This file only parses, routes, and persists.

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMsg, ServerMsg } from "./protocol.js";
import { Room, type Conn } from "./room.js";

export interface ServerOptions {
  port: number;
  /** directory for JSONL action logs; omit to disable persistence */
  logDir?: string;
  decisionTimeoutMs?: number;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"; // no I/L/O
function genCode(taken: Set<string>): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
}

function mkPersist(logDir: string | undefined, code: string): (line: string) => void {
  if (!logDir) return () => {};
  mkdirSync(logDir, { recursive: true });
  const file = join(logDir, `${code}-${Date.now()}.jsonl`);
  return (line) => {
    try {
      appendFileSync(file, line + "\n");
    } catch {
      // persistence is best-effort; never let it break the game
    }
  };
}

export function startServer(opts: ServerOptions): { wss: WebSocketServer; close(): void } {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ port: opts.port });

  wss.on("connection", (ws: WebSocket) => {
    let bound: { room: Room; token: string } | null = null;
    const conn: Conn = {
      send: (msg: ServerMsg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };

    ws.on("message", (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data)) as ClientMsg;
      } catch {
        conn.send({ t: "error", code: "badJson", message: "could not parse message" });
        return;
      }
      try {
        switch (msg.t) {
          case "create": {
            const code = genCode(new Set(rooms.keys()));
            const room = new Room({
              code,
              seed: randomUUID(),
              mode: msg.mode ?? "ffa",
              decisionTimeoutMs: opts.decisionTimeoutMs,
              persist: mkPersist(opts.logDir, code),
            });
            rooms.set(code, room);
            const joined = room.join(msg.name, conn);
            if (joined) bound = { room, token: joined.token };
            return;
          }
          case "join": {
            const room = rooms.get(msg.code.toUpperCase());
            if (!room) {
              conn.send({ t: "error", code: "noRoom", message: "no such room" });
              return;
            }
            const joined = room.join(msg.name, conn);
            if (joined) bound = { room, token: joined.token };
            return;
          }
          case "rejoin": {
            const room = rooms.get(msg.code.toUpperCase());
            if (!room) {
              conn.send({ t: "error", code: "noRoom", message: "no such room" });
              return;
            }
            if (room.rejoin(msg.token, conn)) bound = { room, token: msg.token };
            return;
          }
          case "start":
            bound?.room.start(bound.token);
            return;
          case "action":
            bound?.room.handleAction(bound.token, msg.action);
            return;
          case "ping":
            conn.send({ t: "pong" });
            return;
        }
      } catch (err) {
        conn.send({ t: "error", code: "internal", message: String(err) });
      }
    });

    ws.on("close", () => bound?.room.disconnect(conn));
  });

  return { wss, close: () => wss.close() };
}
