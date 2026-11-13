# Testing + CI/CD plan (Nov 12)

**Status: all four phases done (Nov 12).** What changed compared with the plan:
- The browser runner still stops at the first failure. Its checks build on each other (same TV,
  same phones), so carrying on would only show follow-on failures. It screenshots and dumps every page
  first, as before.
- The `docker` job plays a room with `test/smoke.js` (TV makes a room, 2 phones join, trivia starts),
  not a full bot game. The full bot games already run in `checks`.
- `GameLike` stays. It's the contract `core/rooms.js` types games against, and `BaseGame` implements it.
- The `node_modules` cache volumes (`cabin-fever-nm-<hash>`) pile up when the lockfile changes; prune
  them now and then.

Goal: tests that catch real problems at the cottage, a CI that's quick and only deploys good builds,
a test kit we can copy into the next project, and less code. Keep it a hobby project: no paid services,
no new frameworks, nothing that needs looking after.

## Where we are

We already do most of what game studios recommend:

| Practice (what studios do) | Here |
|---|---|
| Scripted bots play whole games | `test/unit/bots.test.js`, `games/bot-brain.js` |
| Several bots at once to stress networking | chaos bots (`chaos.test.js`), load test |
| Seeded RNG so a failing run can be replayed | `games/rng.js`, `RUMPUS_REPLAY=1 RUMPUS_SEED=…` |
| Bad-network testing (latency, loss, reconnects) | `scripts/load-harsh.sh` (nightly), robustness tests |
| Real clients end to end | Playwright TV + 3 phones (`test/ui/run.js`), Pages build (`pages.js`) |
| Gates: types, lint, coverage | tsc strict, ESLint, strict ratchet, c8 ≥ 80% |

What's weak:

1. **Pages can deploy a broken build.** `pages.yml` runs on every push to main, separate from the tests.
2. **CI does the same work twice.** The `lint` and `coverage` jobs run, then `test-all` runs type checks,
   lint and every unit test again. Locally, `test-all.sh` runs `npm install` from scratch twice (steps 3 and 6),
   and the pre-commit hook does it a third time.
3. **Nobody tests Docker the way you run it.** The tests use podman and our own `run` command, never
   `docker compose up`. That's exactly the setup that broke at the cottage (open issue: container not running).
4. **Old pushes keep running.** There's no `concurrency` on `ci.yml`, so a quick second push runs two full
   suites at once.
5. **Failures are hard to read.** The browser runner stops at the first failure, and its `check()` helper is
   copied in two files.
6. **Flaky tests go unnoticed.** One run per push. A test that fails 1 time in 20 shows up as random red CI.
7. **No replay regression tests.** We can replay a seed, but we never check that a recorded game still ends the
   same way after a change.

## Research summary (kept to what fits us)

- **Bots for breadth, replays for specific bugs.** Studios run scripted bots for broad coverage and keep a few
  recorded replays (seed + inputs → hash of the final state, checked into the repo) for regressions.
  Replays break whenever game rules change, so keep only a handful and re-record on purpose.
  [ixie](https://www.ixiegaming.com/blog/automated-game-testing-that-delivers-bots-toolchains-and-ci-cd/),
  [tessl replay notes](https://tessl.io/registry/testland/gameplay-recording-replay/files/references/engine-record-replay-apis.md),
  [bugnet](https://bugnet.io/blog/setting-up-automated-regression-tests-for-game-builds)
- **Model the network on purpose:** latency, packet loss, reconnects.
  [ixie](https://www.ixiegaming.com/ai-game-testing-that-teams-actually-trust-how-to-design-signal-not-flake/)
- **CI basics:** cancel superseded runs, give every job a timeout, set minimal `permissions`, cache dependencies,
  never cancel a deploy halfway, run slow or flaky checks on a schedule rather than every push, and don't hide
  flakes with blanket retries.
  [oneuptime](https://oneuptime.com/blog/post/2025-12-20-concurrency-control-github-actions/markdown),
  [ashishb](https://ashishb.net/tech/common-pitfalls-of-github-actions)
- **Screenshot comparison** only pays off once a screen stops changing, and it needs a pinned browser and OS
  (we already run Playwright in a pinned container). Mask anything animated.
  [argos](https://argos-ci.com/blog/playwright-visual-regression-testing-ci)
  For us: maybe later, for the lobby and title screens only. Not now.

## Plan

### Phase 1: CI/CD that only ships good builds (small, do first)

- One workflow, `ci.yml`, with these jobs:
  1. `checks` (about 5 min): `npm ci` (cached), typecheck, lint, ratchet, unit tests with coverage
     (`BOT_GAMES=all`), and the coverage summary.
  2. `browser` (needs `checks`): build the image, then run the UI tests and the Pages tests. Runs
     `test-all.sh` with `SKIP_UNIT=1`, so nothing runs twice.
  3. `docker` (needs `checks`): `docker compose up -d --build`, wait for `/api/info`, check the join address,
     run 2 bots through one game, then `docker compose down`. The same again for `--target lite`.
     This covers how you actually run it.
  4. `deploy` (main only, needs `browser`): the current Pages build and deploy, moved here. Delete
     `pages.yml`.
- `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: ${{ github.ref != 'refs/heads/main' }} }`.
  This cancels old runs on branches and never cancels main mid-deploy.
- `permissions: contents: read` at the top. Only `deploy` gets `pages: write` and `id-token: write`.
- Nightly: `load-harsh`; chaos with 3 fresh random seeds, printing each seed so a failure can be replayed;
  and the whole unit suite 3 times to catch flakes. A flake gets fixed, or marked and tracked in
  `docs/future-features/todo.md`. Never a silent retry.

### Phase 2: a reusable test kit (`test/kit/`)

Plain files you copy into a new project. Not an npm package. They know nothing about Cabin Fever:

| File | What it does |
|---|---|
| `kit/process.js` | `startApp(cmd, {env, ready: /listening on port (\d+)/})` forks a server and waits for it; `stop()` |
| `kit/wait.js` | `until(fn, label, ms)`, `once(emitter, event, ms)`, `sleep` (moved out of `test/helpers.js`) |
| `kit/browser.js` | `suite({ base, shots, diagnose })` → `check(name, fn)`; collects page errors and console errors, takes screenshots on failure, keeps going and prints a summary (one copy instead of two) |
| `kit/seeded.js` | run a test with `SEED` from env or random, print the seed on failure ("replay with SEED=…") |
| `kit/containers.sh` | `in_node <cmd>` / `in_playwright <cmd>`: podman or docker, with node_modules cached in a volume, so `npm install` runs once |
| `kit/ci.yml.example` | the Phase 1 workflow shape, with the game-specific parts marked |
| `kit/README.md` | how to drop it into a new project in 10 minutes |

Cabin Fever-specific helpers (`makeHost`, `makePlayer`, the new `makeRoom`) stay in `test/helpers.js`,
built on the kit.

### Phase 3: less code (refactors, each one behind a green `test-all.sh`)

The copy-paste detector found only **1.1% duplicated lines** (249 of 21,797), so the code is already fairly
tight. The real duplication is in the shape of the code, not copied text:

| # | What | Saves | Notes |
|---|---|---|---|
| R1 | **trivia, fibbage and cah don't extend `BaseGame`**: they each re-implement `destroy`, `setTimer`, `skip`, `skipQuestion`, `mult`, `isFinal`, `spicy`, `gameOver` and `standings` | about 150 lines | These copies have drifted: no 1.2 s grace for late phone submits, and `gameOver` doesn't clear `timerFn`. Moving them onto `BaseGame` fixes that drift too. Medium risk; the bots and game tests cover all three. |
| R2 | `room(names, settings)` test helper copied in 5 test files | about 35 lines | → `makeRoom()` in `test/helpers.js` |
| R3 | browser `check()` and failure dump in `run.js` and `pages.js` | about 30 lines | → `kit/browser.js` |
| R4 | container + `npm install` boilerplate in `test-all.sh`, `quick.sh` and `.githooks/pre-commit` | about 20 lines, plus a minute or more per run | → `kit/containers.sh`, one cached `node_modules` volume |
| R5 | `GameLike` in `types/rumpus.d.ts` | small | once every game extends `BaseGame`, see if the interface can just be `BaseGame` |

Not worth doing: splitting `public/games.js` (1,515 lines) or `core/rooms.js` (927). Splitting doesn't remove
code. Only split a file when we're working in it anyway. The two font licence files and the shared
`<head>` in host.html and play.html stay as they are.

### Phase 4: a few golden replays (optional, after 1–3)

- `test/replays/*.json`: game id, seed, the bot inputs, and a hash of the final scores and phase log.
  Start with 3 (trivia, quiplash, storm).
- A test replays each one and compares the hash. When a rule change is on purpose, re-record with
  `RECORD=1`. Note in the commit why it changed.

## Order and size

| Phase | Effort | Risk |
|---|---|---|
| 1 CI/CD | short | low (no game code touched) |
| 2 test kit | medium | low (moves test code, the suite proves it) |
| 3 less code | medium | R1 medium, rest low |
| 4 replays | short | low |

Every step: `./scripts/test-all.sh` before and after; never weaken a test.
