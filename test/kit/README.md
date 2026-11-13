# Test kit

Small, dependency-free test helpers that know nothing about Cabin Fever. Copy the folder into the next
project (`cp -r test/kit ../new-project/test/`) and use what you need. Nothing to install apart from
what each file names. Node's built-in `node --test`, plus Playwright for `browser.js`.

| File | Use it for |
|---|---|
| `wait.js` | `until(fn, label, ms)` waits for a state; `once(emitter, event, ms)`; `sleep` (only for pacing, never for results) |
| `process.js` | `startApp('server.js', { env, ready: /listening on port (\d+)/ })` starts the real app in a child process and returns `{ port, log(), stop() }` |
| `browser.js` | `suite({ name, shots, diagnose })` gives `watch(page, who)` (collects page and console errors), `check(name, fn)` (on the first failure: screenshot of every page, your `diagnose(pages)`, exit 1) and `done()` |
| `seeded.js` | `seeded('chaos', 1000)` returns `{ seed, rng }`. `SEED=…` overrides the seed, and a failing run prints the seed so you can replay it |
| `perf.js` | `device(page, { cpu: 4, latencyMs: 30 })` makes a page act like a slower device (CDP); `probe` / `take` record long tasks, input delay (Event Timing) and the longest stretch with no screen change; `tapLatency(page, sel)` times a click until the change is painted; `stats` gives median/p95 |
| `golden.js` | `golden(file, key, value)` compares with a saved copy; `RECORD=1` saves a new one |
| `containers.sh` | `in_node <name> '<cmd>' [run args]` and `in_playwright <name> <dir> '<cmd>' [run args]`: podman or docker, with `node_modules` cached per lockfile, so the host needs no Node |
| `ci.yml.example` | the GitHub Actions shape: checks → browser + docker → deploy (main only, after both pass) |

## The habits that go with it

- **Test the real thing.** Start the real server (`process.js`) and real browsers (`browser.js`), and
  run the real container the way users do (see `scripts/docker-smoke.sh` in Cabin Fever).
- **Wait for state, never sleep.** A flaky test is a race: wait for the right state with `until`.
  No retries.
- **Randomness is seeded.** Everything random takes a seed. CI uses a fixed one, and a nightly run tries
  fresh ones and prints them.
- **Bots for breadth, golden replays for regressions.** Bots play every screen. A few recorded games
  catch scoring and rule changes nobody meant to make.
- **Slow and random checks run nightly** (bad network, fresh seeds, the suite 3× to find flakes). Every
  push gets the fast and stable ones.
- **One command runs everything locally** (here: `scripts/test-all.sh`), and CI runs the same scripts.
