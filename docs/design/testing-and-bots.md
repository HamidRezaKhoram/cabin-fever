# Testing tools: suites, bots and playtests

## The suite (run before and after every change)
`./scripts/test-all.sh` — content build check, mypy, tsc + type-aware ESLint + strict ratchet,
unit/integration (`node --test test/unit`), legacy e2e, browser tests (Playwright: TV + 3
phones). Flags: `UI_ONLY=1`, `SKIP_UI=1`. The pre-commit hook runs the type/lint part.

## Bots — one brain, three uses
`games/bot-brain.js` decides what a player sends on any phone screen (every game, every
mechanic). Teach it every new screen; `test/unit/bots.test.js` makes bots finish every game.

| Tool | Use it for | How |
|---|---|---|
| **TV bots** | Try a game alone, fill a room to test 4+ player games, demo | Open `/host?bots=1` (or `?debug=1`) → lobby shows 🤖 **+1 / +3 / +3 fast / Remove bots** |
| **CLI bot phones** | Real network clients against a running server (e.g. the cottage box) | `./scripts/bots.sh ABCD 5` (code, count, speed, url) |
| **Playtest report** | Pacing numbers per game vs the design targets | `GAMES=trivia,crush PLAYERS=6 node test/playtest.js` inside the node container |

Bots use human-like think times (taps 2–7 s, writing 8–25 s, drawing 20–50 s); `speed`
divides them (TV "+3 fast" = ×8). Bots never collect stats or achievements.

## Other helpers
- `/host?debug=1`, `/play?debug=1` — debug panel (fps, socket, room, verbose event log).
- `RUMPUS_DEBUG=1` — server logs + `GET /api/debug`.
- `node tools/strict-ratchet.js --explain` — which strict type errors are new since HEAD.
- `test/unit/load.test.js` — 12 real sockets, fan-out latency and memory budget.
- Music: `python3 tools/music-manifest.py` after adding tracks (bitrate/loudness checks).

## Playtest procedure for a change
1. `./scripts/test-all.sh` (green).
2. `GAMES=<id> PLAYERS=4 node test/playtest.js` and `PLAYERS=6`; compare with
   `docs/design/party-game-design.md` §2 and the latest table.
3. Play it on the TV with `?bots=1` and one real phone; then with people.
4. Write the numbers and what you changed into `docs/future-features/playtest-findings.md`.
