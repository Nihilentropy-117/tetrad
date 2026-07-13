// CLI entrypoint: join a Tetrad room and let an LLM play the seat.
//
//   OPENROUTER_API_KEY=... npm start -- --join ABCD --model openai/gpt-4o-mini
//
// Flags: --join <CODE> (required), --model <openrouter id> (required),
//        --name <display name>, --server <ws url>, --log-dir <dir>.

import { Agent } from "./agent.js";
import { green } from "./colors.js";
import { GameLog } from "./gamelog.js";
import { Session } from "./net.js";
import { SYSTEM_PROMPT } from "./rules.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function fail(msg: string): never {
  console.error(msg);
  console.error(
    "\nUsage: OPENROUTER_API_KEY=... npm start -- --join <CODE> --model <openrouter-model-id> [--name Bot] [--server ws://localhost:8080] [--log-dir ./logs]"
  );
  process.exit(1);
}

const code = arg("join") ?? fail("Missing --join <ROOMCODE> (host a room from the regular client first).");
const model = arg("model") ?? fail("Missing --model <openrouter-model-id> (no default; e.g. openai/gpt-4o-mini).");
const apiKey = process.env.OPENROUTER_API_KEY ?? fail("OPENROUTER_API_KEY environment variable is not set.");
const name = arg("name") ?? "Bot";
const server = arg("server") ?? "ws://localhost:8080";
const logDir = arg("log-dir") ?? new URL("../logs", import.meta.url).pathname;

const log = new GameLog(logDir);
let agent: Agent | null = null;

const session: Session = new Session(server, code, name, {
  onState: (msg) => {
    if (!agent) {
      log.begin(session.code ?? code, SYSTEM_PROMPT);
      console.log(`Game log: ${log.path}`);
      agent = new Agent(session, { apiKey, model }, log);
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
