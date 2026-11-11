# CLAUDE.md — Cabin Fever (Rumpus fork)

Self-hosted, **offline** Jackbox-style party game for the owner's cottage. The TV opens `/host`,
phones open `/play`. No internet at the cottage — everything must work fully offline.
**Always assume it runs on a local server** (LAN, one machine, a handful of players) — no auth,
no scaling concerns, plain HTTP is fine.

Repo: https://github.com/HamidRezaKhoram/cabin-fever (git remote `cabinfever`, branch `main`; renamed from homejack in Nov 2026).
`origin` is the upstream we forked (rodwilco/rumpus) — never push there.

## Hard rules (every session)

1. **Run the full test suite before and after every change** — `./scripts/test-all.sh`.
   Don't call work done until it passes. New features ship with new tests in the same change.
   If a test fails, report it honestly with the output; never weaken a test to make it pass.
2. **Offline only at runtime (Docker).** No CDN links, web fonts, remote APIs or downloads from the
   browser or server. Fonts/libs are vendored (`public/fonts`, npm deps baked into the image).
   The **GitHub Pages build** is the one exception: it needs internet to load and for PeerJS to
   introduce phones to the TV (the free broker; game traffic then goes TV↔phone directly). Never
   host anyone's game for them — each TV's browser is the server. Keep both ways working.
3. **Animations run at a fixed 30 fps.** Canvas/JS animation goes through the shared clock
   (`Rumpus.clock` in `public/clock.js`) — never a raw `requestAnimationFrame` loop or a bare
   `setInterval` for animation. CSS animations/transitions use `steps(N)` where
   N = duration_in_seconds × 30 (a test enforces this). Don't rebuild DOM that's already on screen;
   update it with `Rumpus.morph` so animations don't restart and stutter.
4. **Pixel-art style** throughout: Press Start 2P (headings/buttons) + VT323 (body), stepped
   pixel borders, sprites drawn as character grids in `public/sprites.js`. All art is original —
   never draw or name existing copyrighted characters/brands as sprites.
5. **Original games only.** Games may share genre mechanics with party games, but never copy a
   specific commercial game's name, art, text or look. Display names stay original
   (Campfire Quips, Fish Tales, Rainy Day Cards, …).
6. **Content rules: quality over quantity** (user's call; details in docs/design/content-guidelines.md) — only genuinely fun, well-written items;
   a few hundred great ones beat thousands of bland ones. **No repeats** across
   ≥10 games (enforced by `games/library.js` + `data/history.json`), and an **18+ mix** (~30% of
   draws when the 🌶 toggle is on; adult items flagged `a: true`). Boring/generic/everyday
   prompts are filtered out (see filters in `tools/build-content.py`). Only add content that's
   original or under an open license, and record the source in `CREDITS.md`.
7. **Licensing:** code is AGPL-3.0. Rainy Day Cards uses Cards Against Humanity official packs
   (CC BY-NC-SA 4.0) → the project is **non-commercial**. Open Trivia DB / OpenTriviaQA are
   CC BY-SA 4.0; The Trivia API is CC BY-NC 4.0. Keep `CREDITS.md` accurate.
   Trivia must work for an **international** group: no US-only (or any one country's) sports
   leagues, TV, states or charts — `LOCAL_RE` in build-content.py + a content test enforce it.
8. Commit/push only when asked (or when the user has asked for it in the current task).
   End commit messages with the attribution line the session tells you to use.

## Party-game design rules (research — read docs/design/ before designing)

Full research + checklist: `docs/design/party-game-design.md`; content: `docs/design/content-guidelines.md`;
testing tools: `docs/design/testing-and-bots.md`. The short version:
- **Private phone, public TV.** Phones = private info and decisions; TV = the shared moment. **The
  staged reveal is the product**; players are the content (prompts provoke, they don't replace).
- **Pacing targets (bot playtest):** worst idle ≤ 25 s (tap games) / ≤ 45 s (writing/drawing),
  ≥ 3 decisions per player per minute, a payoff every ~40 s, 3–8 min per game.
- **Never leave anyone waiting with nothing to do** — add likes, side bets, favourites, picks;
  end phases as soon as everyone's done; name who the room is waiting for; split big groups.
- **Stakes rise** (×1 → ×2 → ×3), **comebacks exist**, wagers are optional/once-per-game, and **a
  score never goes below zero**. Ties share the better placing.
- **Benign violations only**; low floor, high ceiling; room-controlled pace votes; original art/text.
- **Narrator:** games can give Rocco lines with a `narrate(state)` hook in their `public/games.js`
  renderer (called on every phase change; never talk over a rhythm song). The snapshot test calls it.
- Every new game or mechanic: teach `games/bot-brain.js`, run `test/playtest.js` at 4 and 6 players,
  compare with the targets, and record the result in `docs/future-features/playtest-findings.md`.

## Content rules (keep it fun)

- Quality over quantity; **specific beats generic**; make prompts about the people in the room.
- **International**: no single-country sports/TV/states/charts (`LOCAL_RE` + content test).
- Trivia splits the room (IRT ~40–70%); telemetry retires skipped / too-easy / too-hard items.
- ~30% 18+ when on (house-rule tunable), cheeky not crude; no repeats; sources + licences recorded;
  only stable, fact-checked facts with clearly wrong distractors; write French in French.

## Types (enforced)

- JavaScript is type-checked with `tsc --checkJs` (three configs: `tsconfig.json` server+games,
  `tsconfig.host.json` TV page, `tsconfig.play.json` phone page). Shared types live in
  `types/rumpus.d.ts` (Room, Player, GameLike, PoolItem, window.Rumpus…). Use JSDoc
  (`/** @type {HTMLInputElement} */ (el)`, `@param`, `@returns`) — don't silence errors with `any`
  unless the value really is untyped. Use `Rumpus.hit(e.target, sel)` for typed event delegation.
- Python tools pass `mypy --strict`. Annotate every function.
- **ESLint + typescript-eslint (type-aware)**: `npm run lint` (eslint.config.js) must report 0
  problems — no floating promises (`await`, `.catch()` or `void`), no unused vars, `===`, `const`.
- **Full `strict` mode is on** (tsconfig.base.json) for server, TV and phone code: 0 errors, kept at 0.
  Type every new function and module variable. Server JSON in renderers is genuinely untyped —
  annotate it as an explicit `/** @type {any} */` at that boundary, never leave it implicit.
  `tools/strict-ratchet.js` still runs (baseline 0 everywhere in `types/strict-baseline.json`).
- **Pre-commit hook** (`.githooks/pre-commit`, enabled by test-all via `core.hooksPath`): type check +
  lint + ratchet must pass before any commit. Don't bypass it with `--no-verify`.
- All of these run in `scripts/test-all.sh`; 0 errors is required.

## Test tools (bots)

- `games/bot-brain.js` decides what a player sends on any screen — **teach it every new mechanic**
  (a unit test makes bots finish every game).
- TV: `/host?debug=1` or `/host?bots=1` → lobby shows 🤖 +1 / +3 / +3 fast / Remove bots.
- CLI: `./scripts/bots.sh CODE [count] [speed] [url]` joins bot phones to a real room over the LAN.
- Pacing report: `GAMES=trivia PLAYERS=6 node test/playtest.js` (in the node container).

## Connection, randomness, feel (Nov 2026 playtest fixes)

- **Seats follow the phone**: `play.js` keeps a device id (`cf.device`, localStorage; per tab only
  with `?net=local`). Join/rejoin with it returns the same player from any tab; the old tab gets
  `player:replaced`. Seats are held 30 min (`PLAYER_GRACE_MS`); the TV can kick (✕ in the lobby).
- **Broadcasts are coalesced** (`core/rooms.js` `broadcast` → `flush`, ≤1 per `RUMPUS_BROADCAST_MS`=30 ms)
  and a socket whose view didn't change gets nothing. Tests must wait for state (`until`), never
  assume an update arrives synchronously. `player:submit` is acked `{ok}` (phones show "Sending…").
- **Speed**: phones get no `availableGames` (TV only) and send a `k` keep-warm every 200 ms in a
  game (Wi-Fi power save). `test/unit/load.test.js` is the budget (tap storm, 60/s tilt, reconnect
  storm; `LOAD_REPORT=1` prints numbers); `scripts/load-harsh.sh` reruns it on bad Wi-Fi and a ¼-CPU
  server. Research and numbers: `docs/design/networking.md`.
- **Rooms survive a restart** (`core/rooms.js` `snapshot`/`restoreRooms`): code, seats, scores,
  settings and game-night standings are saved through `fs` as they change (a file in Docker,
  localStorage in the browser build) and restored at start-up — a TV page reload or a container
  restart keeps the room; phones rejoin by themselves. The game in progress is NOT saved: the room
  returns to the lobby and the TV gets `room:event {type:'interrupted'}`. Browser build: one TV tab
  owns the saved room (Web Lock in `web/host-entry.js`); `/admin`, `/highlights` and a second TV
  tab set `CF_SECOND_TAB` (no save, no restore). `RUMPUS_ROOMS_SAVE=0` turns it off.
- **Pace votes in every game** (`games/flow.js`): `hurry` (cut the clock to 10 s), `wrap` (real-time
  games — `this.realtime = true` — end the round now), `ready` (intro/reveal/result screens), `skipq`.
  Every phase needs a timer (`setTimer`): that is what gives the TV its Skip button and the phones
  their vote; `bots.test.js` fails on a screen with neither.
- **Game menu** (`.game-menu` in `public/style.css`, `gamePicker` in `host.js`): a fixed one-screen
  grid sized in `vh` — it must never scroll (checked at 720p/768p/1080p with 12 players).
- **Seeds**: every game's own dice use `this.rng` (old games too; `rng.shuffleIn` shuffles in place).
  Which prompts come up is not seeded (it depends on what the house has played: `games/library.js`).
- **What's left**: `docs/future-features/todo.md` is the one list of open work; update it when you finish or find something.
- **Quick loop**: `scripts/quick.sh [unit test files]` = type check + lint (+ those tests) in seconds.
- **Fast channel** (`web/net.js` `fastChannel`): browser build only — a second, unordered,
  no-retransmit WebRTC channel per phone. `socket.volatile.emit` / `api.sendFast` use it (Lantern
  Lake steering, keep-warm); never put anything on it that must arrive. Steering carries a counter `n`.
- **Updates** (`web/offline.js`): when a new service worker takes over, an idle page reloads itself
  (a page with players shows "Update ready"); pages set `window.cfBusy`.
- **Narrator voice** (`public/host-character.js`): lines are cut into sentence/clause parts and
  played as each arrives (Web Audio); a new line cancels the old. Docker makes the voice on the
  server (`core/voice.js`, native fp32 Kokoro in a worker thread — needs the Debian image, not
  Alpine); otherwise the TV runs `public/tts-worker.js` (uint8). The TV page is cross-origin
  isolated (server.js / sw.js headers) so that worker gets threads. `Rumpus.host.voiceInfo()`.
- **Browser build links** (`web/net.js`): 2 s heartbeat; silent 7 s = asleep; the TV keeps a phone's
  WebRTC link 45 s so a short nap resumes without the broker (`net:resync`). JSON serialization.
- **Offline after first load** (`web/offline.js` + `sw-template.js`): the TV shows a progress bar
  while every game file is saved, then music + voice save in the background; phones save their
  own files. `test/ui/pages.js` reloads both pages with the network off.
- **Every random choice in a game comes from `this.rng`** (`games/rng.js`, seeded per game,
  `RUMPUS_SEED` replays one) and stays inside set bounds (`rng.int(lo, hi)`, `rng.range`).
- **Feel**: `Rumpus.haptic(ms | pattern)` on every tap (Android vibrate, iPhone switch-tick). Phones
  can't pinch/double-tap zoom or select text; the status line under the header always says what's
  happening; timers use server time (`Rumpus.time.now()`), never `Date.now()`.

## Screen layout (10-foot UI)

- Design against 1080p and size relative to screen height: body ≥ 3.2vh (~35px), secondary ≥ 2.6vh,
  never below 28px on the TV. Few elements, big, centred vertically during play.
- Main prompts/answers get `data-fit` and are grown by `Rumpus.fit()` to fill their box.
- A browser test asserts the TV prompt is ≥ 5% of the screen height.
- **The TV never scrolls in a game**: `host.js` `shrinkToStage()` zooms the screen's content down
  to fit; the snapshot test renders every recorded screen (bots play with 8 players) and fails on
  any overflow.

## Music

- 50+ procedural chiptunes in `public/music.js`, organised by cue: title, menu, intro, game:<id>,
  category, vote, reveal, final, victory, scoreboard. Round 2 plays the game theme faster and
  busier (`setIntensity`); the final ×3 question switches to the high-energy `final` cue.
- User tracks: `music/<scenario>/` (see music/README.md) override the chiptunes per scenario.
- After adding/changing a bundled track run `python3 tools/music-manifest.py` (needs ffmpeg):
  it records bitrate + EBU R128 loudness so the TV sets each song's level before it plays.
  Tests enforce a quality floor (≥128 kbps stereo / ≥96 kbps mono) and an up-to-date manifest.

## Game-flow rules (games/flow.js)

- **Escalating stakes** for every multi-question game: first half ×1, second half ×2, final
  question ×3 (`flow.stage`). Campfire Quips: round 1 ×1, later rounds ×2, last matchup ×3.
  TV shows ROUND 2 / FINAL QUESTION title cards; badges show the current multiplier.
- **Pace votes from phones** (majority of connected players): `skipq` replaces the current
  question (only games listing `skippablePhases`; never player-written games), `hurry` cuts the
  remaining time to 10 s, `ready` ends a reveal early. Votes reset whenever the phase/question changes.
- Profile pictures: the character maker (`public/avatar-maker.js`, counts in
  `games/avatar-schema.js`) or one of the 17 pixel animals. New options are **appended** (saved
  looks keep their indexes); `ORDER` controls display order. Keep it diverse (textured hair,
  braids/locs, headwear like hijab/turban/headwrap, 10+ skin tones) — a test checks every option
  renders distinctly.

## Debug mode

- Client: open `/host?debug=1` or `/play?debug=1` (or press Ctrl+Shift+D) → click-through panel with
  fps/frame timing, socket status + RTT, room/phase/round/timer/pace, players, and a verbose log of
  every socket event in/out, phase changes and errors. `window.Rumpus.debug.tail()` for tests.
- Server: `RUMPUS_DEBUG=1` → logs every socket event, phase change and timer; enables
  `GET /api/debug` (full room/game dump, no tokens). The test script runs the server this way.
- Browser-test failures print each page's debug log, errors and current DOM.

## Environment quirks

- **Node is not installed on the host.** Run node inside containers:
  `podman run --rm -v "$PWD":/app:Z -w /app docker.io/library/node:20-alpine …`
  The test script handles this. Python 3 is available on the host.
- Docker daemon is set up by the user; podman works rootless and is what we test with.
- Browser tests use `mcr.microsoft.com/playwright:v1.49.1-noble` (pulled once; cached).
- Host networking (`network_mode: host`) so the server sees the real LAN IP for the QR code.

## Layout

```
server.js              Express + Socket.IO + HTTP APIs (Docker); feeds sockets to core/rooms.js
core/rooms.js          Room server core (transport-agnostic): rooms, tokens, settings, bots, every socket event
core/admin.js          House rules + content editor API (server routes and the browser build share it)
web/                   GitHub Pages build sources: shims (fs/path/crypto), net.js (PeerJS / tab sockets),
                       host-entry.js (TV runs the server in the page), client-entry.js (phones), sw-template.js
tools/build-pages.js   Builds dist/ for Pages (esbuild bundles, relative paths, content-hashed service worker)
games/base.js          BaseGame: scaled timers, skip, final-round ×2, spicy(), views
games/library.js       Content pools: draw(pool, n, {spicy}), no-repeat history, custom content
games/*.js             One module per game (quiplash=Campfire Quips, fibbage=Fish Tales, cah=Rainy Day Cards, …)
games/data/pools/*.json  Built question pools (generated — don't hand-edit)
content-src/           Source text for pools (hand-written) + vendor/ downloads (OpenTDB, CAH)
tools/build-content.py Builds pools: merges, filters boring items, flags 18+, dedupes
content/               User drop-in extra prompts (mounted into the container)
music/                 Optional user MP3s (replace the chiptunes)
data/                  history.json (question history; gitignored)
public/                Client: host.* (TV), play.* (phone), common.js, clock.js, sprites.js,
                       bg.js (pixel scene), music.js (50-track chiptune engine), fx.js, games.js, draw.js
test/                  Test suites (see below)
scripts/test-all.sh    Runs everything
```

## Tests

`./scripts/test-all.sh` runs, in order:
1. Content checks (node): pool sizes, ids, flags, boring filters, grammar.
2. Unit + integration tests (`node --test test/unit`): HTTP routes, rooms/reconnect/kick/settings,
   avatars, reactions, every game's rules & scoring, library no-repeat/spicy, music catalog,
   static client checks (sprites, CSS 30 fps steps, registries in sync).
3. Browser tests (Playwright): TV + 3 phones play real rounds, reconnects, 30 fps frame pacing,
   no console errors, no horizontal scroll on phones.

**Test what the user touches:** request the exact URLs the client uses (a test scans every
link/fetch in `public/`), give every button/setting a handler (static test), and drive every page
(TV, phone, /admin, /highlights) in the browser test — server-side tests alone missed broken links.

Useful flags: `UI_ONLY=1` (just the browser tests), `SKIP_UI=1` (skip them), `BOT_GAMES=all`
(bots play every game; by default only games whose `games/<id>.js` changed since HEAD).
**Coverage ≥ 80%** is enforced for server/game code (c8, `.c8rc.json`) and client code (V8 coverage
in the browser test). New screens are covered by the recorded snapshots in `test/ui/snapshots/`
(re-recorded when bots play a changed game — commit them).
When a test is flaky, fix the race (wait for the right state) — don't add sleeps or retries.

## Future work

`docs/future-features/` holds researched designs that are too big for one change (teams +
minigames, the Cottage Crush dating game, playtest fix list, backlog). Check it before starting
new features and update it when something ships.

## Common tasks

- Play in a browser (no install): https://hamidrezakhoram.github.io/cabin-fever/ — `.github/workflows/pages.yml`
  deploys on every push to main. Build locally: `node tools/build-pages.js dist` (node container).
  `?net=local` uses tab-to-tab connections (tests, one-computer play) instead of PeerJS.
- Run locally: `docker compose up -d --build` → TV `http://<lan-ip>:8012/host`. The https twin
  (`RUMPUS_HTTPS_PORT`, default 8443 in compose, self-signed cert in `data/certs/`) exists for phone
  tilt sensors (Lantern Lake); everything else stays on plain http.
- Rebuild content pools after editing `content-src/`: `python3 tools/build-content.py`.
- Add a game: module in `games/` (extend `BaseGame`, `meta = {id,name,blurb,minPlayers}`),
  register in `server.js` list, renderer in `public/games.js`, icon in `sprites.js`, rules in
  `host.js` `RULES`, music style in `music.js` `GAME_STYLE`, scene in `bg.js` (THEMES + STATIC + ANIM),
  colour scheme in style.css, French rule/blurb lines in `i18n.js`, and teach `games/bot-brain.js` its
  screens — the static tests and the bots test check all of these.
