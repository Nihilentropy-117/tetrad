# Tetrad

UNO-style color/number matching meets class-based dice combat. 2–8 players by
the rules, up to 4 over the network. **`DESIGN.md` is the rules canon** — it
contains every designer ruling; the original docx is ambiguous without it.

## Layout

```
packages/engine   pure, deterministic rules engine (no I/O, RNG lives in state)
packages/server   authoritative WebSocket server (rooms, redaction, timeouts, logs)
apps/client       React + Expo client, web-first (renders views, sends actions)
```

## Run it

```sh
npm install

# 1. start the server (ws://0.0.0.0:8080; JSONL action logs in ./games)
npm start -w @tetrad/server

# 2. start the web client (open the printed URL, default http://localhost:8081)
npm run web -w @tetrad/client
```

In the client: enter the server address (`ws://<host>:8080`), a name, and
Create — share the 4-letter room code; friends Join over the LAN. The host
starts the game once 2–4 players are in.

## Development

```sh
npm test          # engine (44) + server (7) suites, incl. fuzz + replay determinism
npm run typecheck
```

Every game is fully reproducible from `(seed, config, action log)` — the
server writes exactly that as JSONL per room, and replaying it through the
engine is byte-identical (see `packages/engine/tests/fuzz.test.ts`).

Adding a class or card = adding a data file under
`packages/engine/src/classes/` (and, for new mechanics, a named handler in
`src/effects.ts`). The client needs no changes — legality, targets, and
prompts all arrive from the server.
