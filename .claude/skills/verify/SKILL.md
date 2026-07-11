---
name: verify
description: Launch and drive Tetrad (server + Expo web client) end-to-end with Playwright to verify changes at the real surfaces.
---

# Verifying Tetrad changes

## Launch

```bash
# game server (ws://localhost:8080)
cd packages/server && npm start &

# web client — 8081 is often taken by another project; use 8082
cd apps/client && CI=1 npx expo start --web --port 8082 &
```

Wait for `curl -s http://localhost:8082` → 200.

## Gotcha: Metro serves stale bundles

Metro in this environment does NOT reliably pick up file edits made
while it's running, even across fresh page loads. After editing client
source, **restart Expo with `--clear`** and confirm the new code is in
the bundle before trusting a browser run:

```bash
B="/apps/client/index.ts.bundle?platform=web&dev=true&hot=false&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable"
curl -s "http://localhost:8082$B" | grep -c "someNewIdentifier"   # must be ≥1
```

## Drive

Playwright (chromium) with two browser contexts = two players. Working
flow (see git history for full scripts):

1. Page A: fill `getByPlaceholder("name")`, click `Create game`, read the
   4-letter room code via `getByText(/^[A-Z0-9]{4}$/)`.
2. Page B: fill name + `getByPlaceholder("ABCD")` with the code, `Join game`.
3. A clicks `Start game`; both land on class select. Pick a class via the
   card's `Pick` button (`locator("div").filter({ hasText: /Scout.*Calculated Risk/s })`).
4. Table reached when `text=COMBAT LOG` appears.

Notes:
- Seeds are random per room — card-in-hand probes (e.g. "has an
  Inspiration") need a retry loop over fresh rooms.
- Hand cards are ~62×88px divs; find them by bounding-box size
  (55–75 × 80–100) since RN-web has no useful test ids.
- Playing a Scout + clicking `Draw` reliably produces a decision prompt
  (scoutReturn) — good for testing decision UI/countdown.
- Both players picking Scout is legal (duplicates allowed).
- The server logs replayable JSONL under `packages/server/games/`.
