# CLAUDE.md — HomeJack (Rumpus fork)

Self-hosted, **offline** Jackbox-style party game for the owner's cottage. The TV opens `/host`,
phones open `/play`. No internet at the cottage — everything must work fully offline.
**Always assume it runs on a local server** (LAN, one machine, a handful of players) — no auth,
no scaling concerns, plain HTTP is fine.

Repo: https://github.com/HamidRezaKhoram/homejack (git remote `homejack`, branch `main`).
`origin` is the upstream we forked (rodwilco/rumpus) — never push there.

## Hard rules (every session)

1. **Run the full test suite before and after every change** — `./scripts/test-all.sh`.
   Don't call work done until it passes. New features ship with new tests in the same change.
   If a test fails, report it honestly with the output; never weaken a test to make it pass.
2. **Offline only at runtime.** No CDN links, web fonts, remote APIs or downloads from the
   browser or server. Fonts/libs are vendored (`public/fonts`, npm deps baked into the image).
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
   (Punchline, Fib Finder, Card Chaos, …).
6. **Content rules: quality over quantity** (user's call) — only genuinely fun, well-written items;
   a few hundred great ones beat thousands of bland ones. **No repeats** across
   ≥10 games (enforced by `games/library.js` + `data/history.json`), and an **18+ mix** (~30% of
   draws when the 🌶 toggle is on; adult items flagged `a: true`). Boring/generic/everyday
   prompts are filtered out (see filters in `tools/build-content.py`). Only add content that's
   original or under an open license, and record the source in `CREDITS.md`.
7. **Licensing:** code is AGPL-3.0. Card Chaos uses Cards Against Humanity official packs
   (CC BY-NC-SA 4.0) → the project is **non-commercial**. Open Trivia DB / OpenTriviaQA are
   CC BY-SA 4.0. Keep `CREDITS.md` accurate.
8. Commit/push only when asked (or when the user has asked for it in the current task).
   End commit messages with the attribution line the session tells you to use.

## Types (enforced)

- JavaScript is type-checked with `tsc --checkJs` (three configs: `tsconfig.json` server+games,
  `tsconfig.host.json` TV page, `tsconfig.play.json` phone page). Shared types live in
  `types/rumpus.d.ts` (Room, Player, GameLike, PoolItem, window.Rumpus…). Use JSDoc
  (`/** @type {HTMLInputElement} */ (el)`, `@param`, `@returns`) — don't silence errors with `any`
  unless the value really is untyped. Use `Rumpus.hit(e.target, sel)` for typed event delegation.
- Python tools pass `mypy --strict`. Annotate every function.
- Both run in `scripts/test-all.sh`; 0 errors is required.

## Screen layout (10-foot UI)

- Design against 1080p and size relative to screen height: body ≥ 3.2vh (~35px), secondary ≥ 2.6vh,
  never below 28px on the TV. Few elements, big, centred vertically during play.
- Main prompts/answers get `data-fit` and are grown by `Rumpus.fit()` to fill their box.
- A browser test asserts the TV prompt is ≥ 5% of the screen height.

## Music

- 50+ procedural chiptunes in `public/music.js`, organised by cue: title, menu, intro, game:<id>,
  category, vote, reveal, final, victory, scoreboard. Round 2 plays the game theme faster and
  busier (`setIntensity`); the final ×3 question switches to the high-energy `final` cue.
- User tracks: `music/<scenario>/` (see music/README.md) override the chiptunes per scenario.

## Game-flow rules (games/flow.js)

- **Escalating stakes** for every multi-question game: first half ×1, second half ×2, final
  question ×3 (`flow.stage`). Punchline: round 1 ×1, later rounds ×2, last matchup ×3.
  TV shows ROUND 2 / FINAL QUESTION title cards; badges show the current multiplier.
- **Pace votes from phones** (majority of connected players): `skipq` replaces the current
  question (only games listing `skippablePhases`; never player-written games), `hurry` cuts the
  remaining time to 10 s, `ready` ends a reveal early. Votes reset whenever the phase/question changes.
- Profile pictures: players draw their own by default (`player:drawAvatar`, served at
  `/avatar/:code/:id`), or pick one of the 17 pixel animals.

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
server.js              Express + Socket.IO: rooms, reconnect tokens, settings, avatars, reactions, APIs
games/base.js          BaseGame: scaled timers, skip, final-round ×2, spicy(), views
games/library.js       Content pools: draw(pool, n, {spicy}), no-repeat history, custom content
games/*.js             One module per game (quiplash=Punchline, fibbage=Fib Finder, cah=Card Chaos, …)
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
3. Legacy end-to-end smoke scripts (`test/e2e*.js`).
4. Browser tests (Playwright): TV + 3 phones play real rounds, reconnects, 30 fps frame pacing,
   no console errors, no horizontal scroll on phones.

Useful flags: `UI_ONLY=1` (just the browser tests), `SKIP_UI=1` (skip them).
When a test is flaky, fix the race (wait for the right state) — don't add sleeps or retries.

## Future work

`docs/future-features/` holds researched designs that are too big for one change (teams +
minigames, the Cottage Crush dating game, playtest fix list, backlog). Check it before starting
new features and update it when something ships.

## Common tasks

- Run locally: `docker compose up -d --build` → TV `http://<lan-ip>:8012/host`.
- Rebuild content pools after editing `content-src/`: `python3 tools/build-content.py`.
- Add a game: module in `games/` (extend `BaseGame`, `meta = {id,name,blurb,minPlayers}`),
  register in `server.js` list, renderer in `public/games.js`, icon in `sprites.js`, rules in
  `host.js` `RULES`, music style in `music.js` `GAME_STYLE` — the static tests check all of these.
