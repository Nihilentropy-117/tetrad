# Tetrad bot-client

A standalone LLM player for Tetrad. It joins an existing room over WebSocket,
explains the rules to an LLM (via [OpenRouter](https://openrouter.ai)), shows it
the current board + its hand + the server-computed legal actions each turn, and
submits the action the model picks.

- **Fully separated** from the main codebase: not a workspace member, imports
  nothing from `packages/` or `apps/`. Wire types are mirrored in `src/types.ts`.
- **Token-lean live context**: each LLM call contains only the system prompt and
  the latest board state (plus one retry exchange on errors) — no history.
- **Full training logs**: every game writes `logs/<CODE>-<timestamp>.json` in the
  OpenAI chat format (`{"messages":[...]}`) with the system prompt and *every*
  user/assistant turn, unabridged.

## Setup

```sh
cd bot-client
npm install
```

## Run

1. Start the server (from the repo root): `npm start -w @tetrad/server`
2. Create a room from the regular client and note the 4-letter code.
3. Run the bot, then start the game from the host:

```sh
OPENROUTER_API_KEY=sk-or-... npm start -- --join ABCD --model openai/gpt-4o-mini
```

Flags:

| Flag | Default | Meaning |
|---|---|---|
| `--join <CODE>` | required | Room code to join |
| `--model <id>` | required | OpenRouter model id |
| `--name <name>` | `Bot` | Display name in the lobby |
| `--server <url>` | `ws://localhost:8080` | Server WebSocket URL |
| `--log-dir <dir>` | `./logs` | Where training logs are written |

If the LLM replies unusably or the server rejects its action, the bot retries
once with the error appended, then falls back to a safe default (decision
default / end turn / draw) so games never stall.
