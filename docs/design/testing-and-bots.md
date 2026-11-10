# Testing tools: suites, bots and playtests

## The suite (run before and after every change)
`./scripts/test-all.sh` — content build check, mypy, tsc + type-aware ESLint + strict ratchet,
unit/integration (`node --test test/unit`), browser tests (Playwright: TV + 3
phones, plus /admin and /highlights driven through the real links). Flags: `UI_ONLY=1`, `SKIP_UI=1`. The pre-commit hook runs the type/lint part.

## Lessons: why bugs slipped past (Nov 2026)
- `/admin` and `/highlights` 404'd while tests passed: the tests fetched `/admin.html` and nobody
  clicked the TV link. Now `http.test.js` scans every URL literal in `public/` and requests it,
  a static test checks every `data-act` button and `set-*` control has a handler, and the browser
  test clicks the links and uses both pages (save → reload → still saved; add → delete a prompt).
- Rule: a feature isn't tested until a test does what the user does — same URL, same click.
- Removed `test/e2e-new.js` (duplicated the unit tests; its two unique checks moved into
  `games.test.js`).

- Cottage Olympics's "53–78 s idle" was fake: the 10× playtest didn't scale Quick Draw's wait.
  A static test now requires every `RUMPUS_*_MS/MIN/MAX/WINDOW` timer to be scaled in
  `test/playtest.js`, and the report names where the worst idle happens (`worstIdleAt`).

## Coverage (enforced, ≥ 80%)
- Server + game code: `c8` around the unit tests (`.c8rc.json`: lines, branches, functions,
  statements ≥ 80%). Report in `coverage/` (gitignored). Now ≈ 96% lines.
- Client code: the browser test collects Chrome's V8 coverage on every TV/phone page and fails
  under 80% (`CLIENT_COVERAGE_MIN`). Now ≈ 90%.
- **Screen snapshots** (`test/ui/snapshots/<game>.json`): while bots play a game, every distinct
  TV/phone screen is recorded from `/api/debug/views`; the browser test pushes every snapshot of
  every game through the real page code. Commit refreshed snapshots with the change.

## Which games the bots play
`test-all.sh` plays only the games whose module (`games/<id>.js`) changed or was added since the
last commit — `BOT_GAMES=all ./scripts/test-all.sh` plays every game (CI does), `BOT_GAMES=trivia,crush`
picks some. Their snapshots are re-recorded as they play.

## The GitHub Pages build
- `test/ui/pages.js` (test-all step 6): builds `dist/`, serves it under `/cabin-fever/` like Pages,
  and plays a round with **no server** (the TV page hosts; tab-to-tab transport, no internet);
  checks seat rejoin, /admin, and that a new deploy downloads only the changed file.
- `./scripts/test-live.sh [url]`: the live site over the real PeerJS broker, TV + 2 phones as separate
  browsers (needs internet; not in test-all).

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
