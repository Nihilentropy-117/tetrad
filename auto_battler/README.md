# Tetrad auto-battler

Headless LLM-vs-LLM self-play harness for automated development cycles. It
spawns the real Tetrad server as a subprocess, connects two LLM players (both
driven by the unmodified `bot-client` agent over the normal WebSocket
protocol), plays N games, logs everything, and then surveys both players about
their game experience.

**No game code is touched.** This folder only *imports* `../bot-client/src`
read-only and talks to `packages/server` as a black-box subprocess.

## Setup

```sh
npm install               # at the repo root (server deps, incl. tsx + ws)
cd auto_battler && npm install
```

## Usage

```sh
OPENROUTER_API_KEY=sk-or-... npm start -- \
  --questions "How clear were the rules?|Did any card feel overpowered?|What was your strategy?" \
  --games 3
```

| Flag | Default | Meaning |
|---|---|---|
| `--questions <string>` | (required) | Questions separated by `\|` or newlines. |
| `--games <n>` | `1` | Games to play back-to-back. |
| `--model-a <id>` | `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter model for player A (room host). |
| `--model-b <id>` | `openai/gpt-oss-120b:free` | OpenRouter model for player B. |
| `--survey-model <id>` | (players' own models) | Have a (smarter) model answer the survey from each player's transcript instead. |
| `--server <ws url>` | (spawns its own) | Use an already-running server instead of spawning one. |
| `--llm-timeout <s>` | `120` | Per-LLM-call budget (game moves and survey). |
| `--game-timeout <min>` | `30` | Watchdog: abort a game that hasn't finished by then (survey skipped, run continues). |

Env: `OPENROUTER_API_KEY` (required), `OPENROUTER_BASE_URL` (optional override).

## Output

- `logs/log_game_XX` — full console log of game XX (both players' views,
  events, model reasoning, survey Q&A). Numbering persists across runs.
- `results.jsonl` — master survey file, appended after every completed game:
  one line per player per question:
  `{"modelSlug": "<player model>", "gameNumber": XX, "question": "...", "answer": "...", "surveyModel": "..."?}`
  (`surveyModel` only present when `--survey-model` overrode the answerer;
  `modelSlug` is always the model that *played*.)
- `logs/transcripts/` — per-player full chat transcripts (bot-client GameLog
  format); these are what the survey call feeds back to the model.
- `logs/actions/` — the server's replayable per-room action JSONL logs.

The survey asks all questions in **one** LLM call per player, using OpenRouter
structured outputs (`response_format: json_schema`, strict) to force
`{"answers": [...]}` with exactly one answer per question, with a
plain-instructions retry for models that don't support structured outputs.
Failed surveys still emit lines with `"(no answer: ...)"` so every
game/player/question triple exists in `results.jsonl`.

Exit code is non-zero if any game failed or timed out.
