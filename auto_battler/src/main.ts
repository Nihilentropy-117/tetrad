// Auto-battler CLI: spawns the Tetrad server, pits two LLM players (both
// driven by the unmodified bot-client Agent) against each other for N games,
// tees full logs to logs/log_game_XX, then surveys both players and appends
// one JSONL line per player per question to results.jsonl.
//
//   OPENROUTER_API_KEY=... npm start -- --questions "Q1|Q2" [--games 1]
//     [--model-a <id>] [--model-b <id>] [--survey-model <id>]
//     [--server ws://...] [--llm-timeout 120] [--game-timeout 30]

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../../bot-client/src/agent.js";
import { GameLog } from "../../bot-client/src/gamelog.js";
import type { Session } from "../../bot-client/src/net.js";
import { Session as JoinSession } from "../../bot-client/src/net.js";
import { SYSTEM_PROMPT } from "../../bot-client/src/rules.js";
import { HostSession } from "./hostSession.js";
import { spawnServer, type SpawnedServer } from "./server.js";
import { surveyPlayer, type SurveyTarget } from "./survey.js";
import { Tee } from "./tee.js";

const AB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGS_DIR = path.join(AB_ROOT, "logs");
const TRANSCRIPTS_DIR = path.join(LOGS_DIR, "transcripts");
const ACTIONS_DIR = path.join(LOGS_DIR, "actions");
const RESULTS_PATH = path.join(AB_ROOT, "results.jsonl");

const DEFAULT_MODEL_A = "nvidia/nemotron-3-super-120b-a12b:free";
const DEFAULT_MODEL_B = "openai/gpt-oss-120b:free";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function fail(msg: string): never {
  console.error(msg);
  console.error(
    '\nUsage: OPENROUTER_API_KEY=... npm start -- --questions "How clear were the rules?|Did any card feel overpowered?"' +
      "\n  [--games 1] [--model-a <openrouter-id>] [--model-b <openrouter-id>] [--survey-model <openrouter-id>]" +
      "\n  [--server ws://host:port] [--llm-timeout 120] [--game-timeout 30]"
  );
  process.exit(1);
}

const questionsRaw = arg("questions") ?? fail("Missing --questions <string> (questions separated by | or newlines).");
const questions = questionsRaw
  .split(/\r?\n|\|/)
  .map((q) => q.trim())
  .filter(Boolean);
if (questions.length === 0) fail("--questions contained no questions after splitting on | / newlines.");

const apiKey = process.env.OPENROUTER_API_KEY ?? fail("OPENROUTER_API_KEY environment variable is not set.");
const games = Number(arg("games") ?? 1);
if (!Number.isInteger(games) || games < 1) fail("--games must be a positive integer.");
const modelA = arg("model-a") ?? DEFAULT_MODEL_A;
const modelB = arg("model-b") ?? DEFAULT_MODEL_B;
const surveyModel = arg("survey-model");
const llmTimeoutMs = Number(arg("llm-timeout") ?? 120) * 1000;
if (!Number.isFinite(llmTimeoutMs) || llmTimeoutMs <= 0) fail("--llm-timeout must be a positive number of seconds.");
const gameTimeoutMs = Number(arg("game-timeout") ?? 30) * 60_000;
if (!Number.isFinite(gameTimeoutMs) || gameTimeoutMs <= 0) fail("--game-timeout must be a positive number of minutes.");
const externalServer = arg("server");

/** Next game number: one past the highest existing logs/log_game_XX. */
function nextGameNumber(): number {
  let max = 0;
  if (fs.existsSync(LOGS_DIR)) {
    for (const f of fs.readdirSync(LOGS_DIR)) {
      const m = f.match(/^log_game_(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

/** "A_nemotron-3-supe" — short display name derived from the model slug. */
function playerName(prefix: string, slug: string): string {
  const bare = (slug.split("/").pop() ?? slug).split(":")[0] ?? slug;
  return `${prefix}_${bare.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 16);
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

interface GameResult {
  completed: boolean;
  transcripts: SurveyTarget[];
}

async function playGame(serverUrl: string): Promise<GameResult> {
  const logA = new GameLog(TRANSCRIPTS_DIR);
  const logB = new GameLog(TRANSCRIPTS_DIR);
  const nameA = playerName("A", modelA);
  const nameB = playerName("B", modelB);
  const agentAReady = deferred<Agent>();
  const agentBReady = deferred<Agent>();
  let agentA: Agent | null = null;
  let agentB: Agent | null = null;

  const host = new HostSession(serverUrl, nameA, {
    onState: (msg) => {
      if (!agentA) {
        logA.begin(host.code ?? "GAME", SYSTEM_PROMPT);
        console.log(`Player A transcript: ${logA.path}`);
        // structurally identical to bot-client's Session for everything Agent
        // touches (name, sendAction); the cast bridges the private fields
        agentA = new Agent(host as unknown as Session, { apiKey, model: modelA, timeoutMs: llmTimeoutMs }, logA, SYSTEM_PROMPT);
        agentAReady.resolve(agentA);
      }
      agentA.onState(msg);
    },
    onLobby: (players) => {
      console.log(`[lobby] ${players.map((p) => `${p.playerId} "${p.name}"`).join(", ")}`);
      if (players.length >= 2) host.start();
    },
    onError: (c, m) => {
      if (agentA) agentA.onServerError(c, m);
      else console.error(`[A] server error: ${c}: ${m}`);
    },
    onClose: () => console.log(`[A] connection closed`),
  });

  console.log(`Player A: "${nameA}" (${modelA}) creating room on ${serverUrl}...`);
  host.connect();
  const code = await host.codeReady;
  console.log(`Room ${code} created; Player B: "${nameB}" (${modelB}) joining...`);

  const joiner = new JoinSession(serverUrl, code, nameB, {
    onState: (msg) => {
      if (!agentB) {
        logB.begin(code, SYSTEM_PROMPT);
        console.log(`Player B transcript: ${logB.path}`);
        agentB = new Agent(joiner, { apiKey, model: modelB, timeoutMs: llmTimeoutMs }, logB, SYSTEM_PROMPT);
        agentBReady.resolve(agentB);
      }
      agentB.onState(msg);
    },
    onLobby: () => {}, // the host session already prints the lobby
    onError: (c, m) => {
      if (agentB) agentB.onServerError(c, m);
      else console.error(`[B] server error: ${c}: ${m}`);
    },
    onClose: () => console.log(`[B] connection closed`),
  });
  joiner.connect();

  const bothFinished = Promise.all([
    agentAReady.promise.then((a) => a.finished),
    agentBReady.promise.then((b) => b.finished),
  ]).then(() => "done" as const);
  let watchdog: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((res) => (watchdog = setTimeout(() => res("timeout"), gameTimeoutMs)));

  try {
    const outcome = await Promise.race([bothFinished, timedOut]);
    if (outcome === "timeout") {
      console.error(`[watchdog] game exceeded ${Math.round(gameTimeoutMs / 60_000)} minutes — aborting.`);
      return { completed: false, transcripts: [] };
    }
    return {
      completed: true,
      transcripts: [
        { modelSlug: modelA, transcriptPath: logA.path },
        { modelSlug: modelB, transcriptPath: logB.path },
      ],
    };
  } finally {
    clearTimeout(watchdog);
    host.close();
    joiner.close();
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  let server: SpawnedServer | null = null;
  const serverUrl = externalServer ?? (server = await spawnServer(ACTIONS_DIR)).url;
  const shutdown = () => {
    server?.stop();
    process.exit(130);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  let failures = 0;
  for (let i = 0; i < games; i++) {
    const gameNumber = nextGameNumber();
    const logFile = path.join(LOGS_DIR, `log_game_${String(gameNumber).padStart(2, "0")}`);
    const tee = new Tee(logFile);
    try {
      console.log(`=== Game ${gameNumber} (${i + 1}/${games}) — ${new Date().toISOString()} ===`);
      console.log(`Models: A=${modelA} vs B=${modelB}${surveyModel ? ` (survey: ${surveyModel})` : ""}`);
      console.log(`Log file: ${logFile}`);
      const result = await playGame(serverUrl);
      if (result.completed) {
        for (const target of result.transcripts) {
          await surveyPlayer(
            { apiKey, questions, gameNumber, surveyModel, resultsPath: RESULTS_PATH, timeoutMs: llmTimeoutMs },
            target
          );
        }
        console.log(`Game ${gameNumber} complete; survey appended to ${RESULTS_PATH}`);
      } else {
        failures++;
        console.error(`Game ${gameNumber} did not finish; survey skipped.`);
      }
    } catch (e) {
      failures++;
      console.error(`Game ${gameNumber} failed: ${(e as Error).message}`);
    } finally {
      tee.close();
    }
  }

  server?.stop();
  process.exit(failures > 0 ? 1 : 0);
}

void main();
