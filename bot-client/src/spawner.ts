// Bot spawner: a tiny HTTP sidecar the human client's "Add bot" button talks
// to. Each request launches the exact same CLI process you'd start by hand
// (`npm start -- --join CODE --model ...`), so terminal output, colors, and
// training logs are identical to terminal-launched bots. Run it in its own
// terminal: `npm run spawner` (bots' output appears there).
//
//   GET  /models          -> { models: string[] }   (dropdown contents)
//   POST /spawn           -> { code, model, instructions?, server? }
//
// Env: OPENROUTER_API_KEY (required, inherited by bots),
//      SPAWNER_PORT (default 8090), BOT_MODELS (comma-separated dropdown list).

import { spawn } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.SPAWNER_PORT ?? 8090);
const MAX_BOTS_PER_ROOM = 3;

const DEFAULT_MODELS = [
  "openai/gpt-5.6-sol",
  "tencent/hy3:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
];
const MODELS = (process.env.BOT_MODELS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_MODELS);

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set — spawned bots will fail. Set it and restart.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsx = path.join(root, "node_modules", ".bin", "tsx");

/** live bot processes per room code */
const liveBots = new Map<string, number>();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  if (req.method === "GET" && req.url === "/models") return sendJson(res, 200, { models: MODELS });
  if (req.method !== "POST" || req.url !== "/spawn") return sendJson(res, 404, { error: "not found" });

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let msg: { code?: string; model?: string; instructions?: string; server?: string };
    try {
      msg = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: "bad JSON" });
    }
    const code = msg.code?.toUpperCase();
    if (!code || !/^[A-Z]{4}$/.test(code)) return sendJson(res, 400, { error: "bad room code" });
    if (!msg.model) return sendJson(res, 400, { error: "model is required" });
    if ((liveBots.get(code) ?? 0) >= MAX_BOTS_PER_ROOM) {
      return sendJson(res, 409, { error: `already ${MAX_BOTS_PER_ROOM} bots in room ${code}` });
    }

    const args = [path.join(root, "src", "main.ts"), "--join", code, "--model", msg.model];
    if (msg.server) args.push("--server", msg.server.replace(/^http/, "ws"));
    if (msg.instructions) args.push("--instructions", msg.instructions);

    console.log(`[spawner] launching bot for ${code}: ${msg.model}${msg.instructions ? ` — "${msg.instructions}"` : ""}`);
    const child = spawn(tsx, args, { cwd: root, stdio: "inherit", env: process.env });
    liveBots.set(code, (liveBots.get(code) ?? 0) + 1);
    child.on("exit", (codeNum) => {
      liveBots.set(code, Math.max(0, (liveBots.get(code) ?? 1) - 1));
      console.log(`[spawner] bot for ${code} exited (${codeNum ?? "signal"})`);
    });
    child.on("error", (e) => console.error(`[spawner] failed to launch: ${e.message}`));
    sendJson(res, 200, { ok: true });
  });
}).listen(PORT, () => {
  console.log(`Tetrad bot spawner on http://localhost:${PORT} — models: ${MODELS.join(", ")}`);
  console.log("Bots launched from the web client's \"Add bot\" button will print their output here.");
});
