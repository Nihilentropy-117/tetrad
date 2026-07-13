// CLI entrypoint: join a Tetrad room and let an LLM play the seat.
//
//   OPENROUTER_API_KEY=... npm start -- --join ABCD --model openai/gpt-4o-mini
//
// Flags: --join <CODE> (required), --model <openrouter id> (required),
//        --name <display name>, --server <ws url>, --log-dir <dir>.

import { Agent } from "./agent.js";
import { blue, green } from "./colors.js";
import { GameLog } from "./gamelog.js";
import { chat } from "./llm.js";
import { Session } from "./net.js";
import { SYSTEM_PROMPT } from "./rules.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function fail(msg: string): never {
  console.error(msg);
  console.error(
    '\nUsage: OPENROUTER_API_KEY=... npm start -- --join <CODE> --model <openrouter-model-id> [--name Bot] [--server ws://localhost:8080] [--log-dir ./logs] [--llm-timeout 120] [--instructions "always pick priest"]'
  );
  process.exit(1);
}

const code = arg("join") ?? fail("Missing --join <ROOMCODE> (host a room from the regular client first).");
const model = arg("model") ?? fail("Missing --model <openrouter-model-id> (no default; e.g. openai/gpt-4o-mini).");
const apiKey = process.env.OPENROUTER_API_KEY ?? fail("OPENROUTER_API_KEY environment variable is not set.");
const server = arg("server") ?? "ws://localhost:8080";
const llmTimeout = Number(arg("llm-timeout") ?? 120) * 1000;
if (!Number.isFinite(llmTimeout) || llmTimeout <= 0) fail("--llm-timeout must be a positive number of seconds.");
const instructions = arg("instructions");
const systemPrompt = instructions
  ? `${SYSTEM_PROMPT}\n\n# Operator instructions (follow these above all strategy advice)\n${instructions}`
  : SYSTEM_PROMPT;
const logDir = arg("log-dir") ?? new URL("../logs", import.meta.url).pathname;

/** Ask the model to invent its own handle for this game; sci-fi flavored. */
async function makeGamertag(): Promise<string> {
  const prompt =
    "Invent ONE cool gamertag for yourself — you are an AI about to play a competitive card-battle game. " +
    "Draw on classic or modern sci-fi (novels, films, games): think along the lines of HAL9000, Roy_Batty, " +
    "Wintermute, Shodan, Cortana — but invent your own, don't copy these examples. " +
    "3-16 characters, letters/digits/underscores only. Reply with ONLY the gamertag, nothing else.";
  try {
    const r = await chat({ apiKey, model }, [{ role: "user", content: prompt }], 30_000);
    const tag = r.content.trim().split(/\s+/).at(-1)?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
    if (tag && tag.length >= 3) return tag;
    console.error(`[gamertag] unusable reply ${JSON.stringify(r.content.slice(0, 80))}; using fallback`);
  } catch (e) {
    console.error(`[gamertag] ${(e as Error).message}; using fallback`);
  }
  return `Unit_${Math.floor(1000 + Math.random() * 9000)}`;
}

const name = arg("name") ?? (await makeGamertag());
console.log(blue(`Gamertag: ${name}`));

const log = new GameLog(logDir);
let agent: Agent | null = null;

const session: Session = new Session(server, code, name, {
  onState: (msg) => {
    if (!agent) {
      log.begin(session.code ?? code, systemPrompt);
      console.log(`Game log: ${log.path}`);
      agent = new Agent(session, { apiKey, model, timeoutMs: llmTimeout }, log, systemPrompt);
      void agent.finished.then(() => {
        console.log("Game finished — closing.");
        session.close();
        process.exit(0);
      });
    }
    agent.onState(msg);
  },
  onLobby: (players) => console.log(green(`Lobby [${session.code ?? code}]: ${players.join(", ")} (waiting for host to start)`)),
  onError: (c, m) => {
    if (agent) agent.onServerError(c, m);
    else fail(`Server error while joining: ${c}: ${m}`);
  },
  onClose: () => {
    console.error("Connection closed.");
    process.exit(agent ? 0 : 1);
  },
});

console.log(`Joining room ${code.toUpperCase()} at ${server} as "${name}" (model: ${model})`);
session.connect();
