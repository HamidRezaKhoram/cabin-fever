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
  Which prompts come up depends on what the house has played (`games/library.js`), except in replay
  mode: `RUMPUS_REPLAY=1 RUMPUS_SEED=<n>` ignores the history and seeds the draws too (debugging).
- **Game errors reach the TV**: `glitch`/`safely` in `core/rooms.js` → `room:event {type:'glitch'}`; a
  phase timer that throws stays pending (`guarded(..., retry)`), so Skip retries it.
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
  `docker build --target lite` (Raspberry Pi): only the uint8 model, no native runtime,
  `RUMPUS_SERVER_VOICE=0` → the TV speaks; ~0.7 GB image, ~40 MB idle.
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

## Feel on cheap devices (Cottage Lab, docs/future-features/feel-plan.md)

- **The TV is driven by a remote**: arrow keys move a big focus ring to the nearest control in that
  direction (`host.js` "TV remote"), OK presses it (and toggles switches), OK on the title screen
  starts. Every TV control must be a real `button`/`select`/`input` so the remote can reach it.
- **2022 Samsung TVs run Chromium 85**: `test/unit/tv-compat.test.js` fails on newer JS syntax/APIs or
  CSS (`inset`, `aspect-ratio`, `:has()`, …) in the TV page unless the line has a fallback and says
  `/* old TVs: … */` (or `/* phone only */`). Use top/right/bottom/left, not `inset`.
- **Don't make the TV re-fit for nothing**: `layoutStage()` skips the fit when the screen size, the
  element count and the big text are unchanged; `morph` keeps `data-fit` text's inline font size.
  Pass `layoutStage(true)` when something outside the text changed size.
- **Background (`bg.js`)**: set a fill colour once per group of rects, pre-render repeated shapes —
  per-pixel `fillStyle` strings were a top TV cost.
- **Flash safety**: `test/unit/flash-safety.test.js` — no CSS animation flashes > 3 times a second.
- **Fit text off-screen**: `Rumpus.fit` searches the size on a hidden copy in a `contain: strict` box
  (a layout root), and `fitAll` reads every size before writing any. Keep it that way: a search on the
  real element lays out the whole TV screen at every step.
- **Responsible play**: 🙈 `player:prefs {shy}` — a shy player is never a Most Likely answer and gets no
  Crush notes, winks or date picks (`BaseGame.targetIds()` / `targetable(id)`; new games that single
  people out must use them). 😴/🙂/🤩 `player:rate` at game over → `stats.rate` → /highlights Ratings tab.
  🕊 Calm (TV, `body.calm`, stored per TV) turns off shakes, wipes, confetti and the lightning flash.
  The title screen says when 18+ prompts are on. No filtering of what players type (user's call).
- **Calibrate the lab**: `/bench` times a fixed workload; `/bench?base=<lab ms>` on the real TV/phone shows
  the CPU factor to put in `test/lab/run.js` PROFILES (the lab report prints the lab's ms).
- **Lab**: `./scripts/lab.sh [games]` plays games on a simulated 2022 Samsung TV (CPU ÷6) + 3 Galaxy A15
  phones (CPU ÷4) and writes `test/lab/out/report.md` (per-screen tap latency, long tasks, worst frame,
  dead air, smallest text, phone frames, smallest tap target, tap→TV, sound peak/clipping).
  `LAB_PROFILE=1` adds the TV's and a phone's top CPU functions (it slows everything: don't read
  timings from a profiled run). `LAB_FLASH=1` screenshots the TV to count flashes. `LAB_STRICT=1`
  fails on the hard checks (text, tap targets, clipping, flashes, games finishing). Games in
  `./scripts/lab.sh trivia,trivia,trivia` run in that order, repeats allowed (memory: leak or cache?).
  Device factors are estimates until calibrated on real hardware. Runs nightly.
- **TV Back button**: the first press shows "Press BACK again to leave", a second within 3 s calls
  `history.back()` — a stray press mid-round must not end the night.

## Screen layout (10-foot UI)

- Design against 1080p and size relative to screen height: body ≥ 3.2vh (~35px), secondary ≥ 2.6vh,
  never below 28px on the TV. Few elements, big, centred vertically during play. Small labels go in
  the `calc(max(28px, …vh) / var(--unzoom))` rule in style.css so the stage zoom can't shrink them.
  The TV marks the screen it shows with `#phase-view[data-phase]`.
- Phones: everything tappable is ≥ 48px (`body.play #game-view button` etc.); the lab checks it.
- **TV menu** (Nov 13 redesign, retro): a console-style game select — "▶ CHOOSE A GAME", one shelf of
  old-console cartridges (`.shelf .cart`: grey shell, grip ridges, a label with art + name, nothing else),
  and a footer (control hints + ⚙ Settings). The picked cartridge comes forward and its description
  (`#game-detail`, from `data-blurb`/`data-min` + `GAME_TAGS`) sits under it (`placeDetail`). ◀ ▶ wrap
  round the shelf; locked games stay selectable (`aria-disabled`) and say why. No top bar on the menu:
  every setting (game, sound, screen, narrator, language, links) is in ⚙ Settings (`.settings-more`,
  `moreOpen`), and 🎉 Game night is one button with its own box (`nightOpen`); Back/Escape closes them.
  Dialogs are old-console boxes (`.retro-box`). The lab's remote-press budget is 8 (half the shelf).
- **Menu layout pattern**: every area has one place. Main column: title → shelf → description (a fixed
  box; only its pointer moves to the pick, `--arrow-x`) → command bar (`.cmd-bar`: the lineup on the
  left, every button together in `.cmd-group` on the right, one style and size). No "press OK to…"
  hints: the controls should be obvious from the screen itself.
  Right column: join card → players (✏️ Edit shows each player's small ✕, `editPlayers`). Top-right
  corner of the main column: 🏆 Stats (its own box: tonight, hall of fame) and ⚙ Settings (settings
  only). Lineup actions go in `.cmd-group`; menus go in the corner.
- **The lineup** (replaced game night's vote, Nov 13): ▼ from a cartridge → "＋ Add to the lineup"; the
  footer shows it as mini cartridges (`lineup` in host.js) and ▶ Play sends `host:startNight {games}`.
  The server (`room.night.list`, `nightNext` in core/rooms.js) plays them in order, skipping a game that
  needs more players; between games `NightGame` shows `night-next` (the next cartridge, "NEXT GAME") for
  `RUMPUS_NIGHT_NEXT_MS`. Cartridges come from one helper, `cartHtml(id, name, 'mini' | 'big')`.
- **Game starts**: the title card is the cartridge sliding in (`cart-insert`); every new game gets one,
  lineup games too (`startedGame`). The screen wipe is old-console "blinds" (fx.js).
- **Rocco** only comes out to talk (`#rocco.away` otherwise). The backdrop's life (ducks, the fox, the
  raccoon at the door, chimney smoke) is drawn in bg.js `life()` at a calm pace — no DOM walkers.
- **Phone join/lobby**: the join page is name + look + Join (sticky); the full character maker opens with
  "Customise" (`editor(..., { open: false })`). The lobby is one card plus two buttons; "Change my look"
  opens one panel with Character / Animal.
- Every image load refits the TV (debounced 50 ms) — even avatars: an unloaded `<img alt="">` takes no space, so a loading avatar does move the layout (tried skipping them: the snapshot test overflowed).
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

**CI/CD** (`.github/workflows/ci.yml`, plan in `docs/future-features/testing-plan.md`): `checks` (generated
files, mypy, tsc, eslint, ratchet, unit tests + coverage with `BOT_GAMES=all`) → `browser`
(`UI_ONLY=1 test-all.sh`) and `docker` (`scripts/docker-smoke.sh`: `docker compose up`, full + lite, pages
load, `test/smoke.js` plays a room, still up 10 s later) → `deploy` (Pages, main only). Older runs on a
branch are cancelled. `nightly.yml`: load-harsh, chaos with 3 fresh seeds (`SEED=<n>` replays one), and the
unit suite 3× to find flaky tests.

**Test kit** (`test/kit/`, README there): generic helpers meant to be copied into other projects:
`wait.js` (until/once/sleep), `process.js` (startApp), `browser.js` (suite/check/watch), `seeded.js`,
`golden.js`, `perf.js` (CDP device throttling + feel probes), `containers.sh` (`in_node` / `in_playwright`, node_modules cached per lockfile). Cabin
Fever's own helpers (`makeHost`, `makePlayer`, `makeRoom`, `startServer`) stay in `test/helpers.js`.
Keep the kit free of anything Cabin Fever-specific.

**Golden replays** (`test/unit/replays.test.js`, `test/replays/golden.json`): trivia, quiplash and storm
played in-process with seed 4242, bots and a fake clock must give the recorded phases and scores. A rule,
scoring or content-pool change that alters them is re-recorded on purpose: `RECORD=1 node --test
test/unit/replays.test.js` (say why in the commit).

## Future work

`docs/future-features/` holds researched designs that are too big for one change (teams +
minigames, the Cottage Crush dating game, playtest fix list, backlog). Check it before starting
new features and update it when something ships.

## Common tasks

- Play in a browser (no install): https://hamidrezakhoram.github.io/cabin-fever/ — the `deploy` job in
  `.github/workflows/ci.yml` publishes it from main, only after the browser and docker jobs pass. Build locally: `node tools/build-pages.js dist` (node container).
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
