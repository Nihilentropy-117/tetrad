// Bot spawning on behalf of the lobby host's "Add bot" button. Launches the
// same bot-client CLI process you'd start by hand from a terminal
// (`npm start -- --join CODE --model ...`), so logs and behavior are identical.
// The LLM API key lives in the server's environment — players never need it.
//
// Env: OPENROUTER_API_KEY (inherited by bots; without it addBot errors),
//      BOT_MODELS (comma-separated dropdown list override).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MODELS = [
  "openai/gpt-5.6-sol",
  "tencent/hy3:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
];

export const BOT_MODELS =
  process.env.BOT_MODELS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_MODELS;

// packages/server/src -> repo root -> bot-client
const botRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "bot-client");
const tsx = path.join(botRoot, "node_modules", ".bin", "tsx");

export interface SpawnBotRequest {
  code: string;
  model: string;
  instructions?: string;
  /** ws:// URL the bot should connect to (the server itself) */
  serverUrl: string;
}

export type SpawnBotFn = (req: SpawnBotRequest) => string | null;

/** Launch a bot-client process. Returns an error message, or null on success. */
export const spawnBot: SpawnBotFn = (req) => {
  if (!process.env.OPENROUTER_API_KEY) {
    return "bots are not configured on this server (OPENROUTER_API_KEY is not set)";
  }
  if (!existsSync(tsx)) {
    return "bot-client is not installed on this server (run `npm install` in bot-client/)";
  }
  const args = [
    path.join(botRoot, "src", "main.ts"),
    "--join",
    req.code,
    "--model",
    req.model,
    "--server",
    req.serverUrl,
  ];
  if (req.instructions) args.push("--instructions", req.instructions);

  console.log(`[bots] launching bot for ${req.code}: ${req.model}${req.instructions ? ` — "${req.instructions}"` : ""}`);
  const child = spawn(tsx, args, { cwd: botRoot, stdio: "inherit", env: process.env });
  child.on("exit", (codeNum) => console.log(`[bots] bot for ${req.code} exited (${codeNum ?? "signal"})`));
  child.on("error", (e) => console.error(`[bots] failed to launch: ${e.message}`));
  return null;
};
