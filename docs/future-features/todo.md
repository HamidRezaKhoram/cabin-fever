# To do — everything still open (as of Nov 11 2026)

One list of what is not done, not verified, or knowingly limited. Sizes: **S** an hour or two,
**M** a day, **L** several days. "Where" is the first file to open.

## 1. Check on real devices (nothing here has been, only simulated phones and a headless browser)

| # | What to check | How | Where it lives |
|---|---|---|---|
| 1.1 | **TV reload with real phones (website version).** The room is restored, but the TV must take its room name back at the PeerJS service; retries are in place, untested against the real service. | Start a room on the website, join with 2 phones, reload the TV page mid-game. Phones should be back within ~10 s. | `web/host-entry.js` `listen` |
| 1.2 | **Sleeping phones.** How fast a phone that slept 10 s / 1 min / 10 min gets its seat back, on iPhone and Android. | Lock the phone, wait, unlock; watch the dot in the phone header. | `public/play.js`, `web/net.js` `heartbeat` |
| 1.3 | **Wi-Fi keep-awake ping** (a tiny message every 200 ms): does it actually cut lag on the cottage router? Battery cost over an evening? | Compare a game with and without (`WARM_MS` in `public/play.js`). | `public/play.js` |
| 1.4 | **Fast WebRTC channel** on real Wi-Fi: does Lantern Lake steer more smoothly on the website version than in Docker? | Play both; look for boats that stutter or drift. | `web/net.js` `fastChannel` |
| 1.5 | **Narrator voices by ear.** Timed, never listened to. Is UK female right? Does the server voice (Docker) sound better than the browser one? | Pick each voice in the lobby. | `public/host-character.js`, `core/voice.js` |
| 1.6 | **Australian option.** Only appears when the TV's browser has its own Australian voice (macOS, Windows, Edge). | Open the 🎙 list on the real TV device. | `public/host-character.js` `voiceList` |
| 1.7 | **Storm Watch balance** with people (bots play randomly): raccoon count, Double Trouble, the Lookout's two names, the unmask steal. | Three real games at 5, 6 and 8 players; note who wins. | `games/storm.js` |
| 1.8 | **Loon Call feel.** Timing judgement and the PERFECT / EARLY / LATE buzz on real phones, Bluetooth speakers included (they add delay). | Play the tune-up and one song per tier. | `games/looncall.js` |
| 1.9 | **Tilt controls** (need https; self-signed warning in Docker). | Lantern Lake → "Use tilt" on iPhone and Android. | `public/games.js` |
| 1.10 | **Game menu on the real TV** (checked at 720p, 768p, 1080p in a test browser). | Look at it with a full room; try 4K and browser zoom. | `.game-menu` in `public/style.css` |
| 1.11 | **Majority votes in real-time games.** "End this round" needs over half the room — too easy to grief, or fine? | Play Cottage Olympics with 4+. | `games/flow.js` |
| 1.12 | **Haptics on iPhone** (iOS 17.4+). | Tap around; feel for the tick. | `public/common.js` `haptic` |

## 2. Known limits (decide: fix, or live with)

| # | Limit | Idea | Size |
|---|---|---|---|
| 2.1 | **A reload/restart picks up trivia and Closest Cast; other games are still cut short.** | Add `save()`/`resume(data)` to each game (see `games/trivia.js`, `games/closest.js`): resume restarts the current phase with a fresh clock. Next: Cabin Superlatives, Campfire Consensus, Fish Tales. | L |
| 2.2 | **Website version needs internet to join** (free PeerJS service introduces phone and TV). | Bundle a tiny PeerJS server in Docker for LAN use, or QR-code signalling (phone scans TV, TV scans phone) for a fully offline join. | L |
| 2.3 | **Weak TVs can't run the natural voice in the browser** (2 cores: 5–7 s per line → robot voice). | Try WebGPU (`device: 'webgpu'`, fp16 model) and pick whichever is faster at start-up; needs a real GPU to test. | M |
| 2.6 | **Docker phones have no fast channel** (WebSocket = TCP). | WebTransport needs HTTP/3 and real certificates; only worth it if 1.4 shows a clear win. | L |
| 2.7 | **Locked phones disconnect.** Browsers don't allow background connections. | Nothing in a web page; a wrapped app (Capacitor) could. Out of scope unless it hurts. | L |
| 2.11 | **Phones are trusted for some results** (hold time, balance, tap times). Accepted for friends. | — | — |

## 3. Features not built yet

| # | Feature | Notes | Size |
|---|---|---|---|
| 3.1 | **Message in a Bottle: scribble pad** for players waiting on others. | Doodles could float across the TV. | M |
| 3.6 | **Cottage Crush: remaining agendas** (see `dating-game.md`). | | M |
| 3.8 | **Send only what changed** in state updates (~2 KB → a few hundred bytes). | Not needed on a LAN; revisit only if 1.3/1.4 show lag. | M |

## 4. Tests and tooling

| # | What | Size |
|---|---|---|
| 4.4 | **Real-broker test** for 1.1 (two browsers through the PeerJS service; needs internet, so keep it out of the default suite). | M |

## 4b. Game bug reports

- **Per-game review findings** (Nov 11 2026): `game-bug-reports.md` — the medium/low ones are not fixed yet; pick which to do. Shared: tied players don't share placings on the podium/phones (`standings()`).

## 5. Housekeeping

- **Content licences**: card packs and one trivia source are non-commercial. Personal use is fine; list them in the README before sharing the repo widely.
- **Hung test container** `c63a6ec77669` (node:20-alpine, up since Nov 10): it is ours — a `node --test test/unit/lantern.test.js` run from this repo that never exited (its output piped through `head`). Stop it with `podman rm -f c63a6ec77669`; worth checking whether the lantern test leaves a handle open when run alone.
- **Docs to refresh** after the next playtest: `playtest-findings.md`, `game-improvement-plans.md`.

## Not doing / on hold (owner's call, Nov 11 2026)

- **2.10 Admin PIN**: not needed.
- **2.2 offline PeerJS** and **2.3 WebGPU voice**: judged not high priority (Docker already works offline; WebGPU needs a real GPU to test). Still open above.
- **French** (2.4 French voice, 3.7 French content packs): on hold for now. New screens still get their few French UI lines.

## Done

- **Website save: memory, slow Wi-Fi, small fixes** (Nov 13 2026, review): downloads stream into the cache
  (the 169 MB voice model used to sit in memory twice, ~340 MB: a TV/phone could crash); saved copies drop
  Content-Encoding/Length; a failed response's body is cancelled. Files > 20 MB download alone in 8 MB Range
  pieces saved as they come, so a worker stopped after ~5 min carries on from the last piece instead of
  starting the model over for ever (then the pieces are joined). "No room to save" shows once per device.
  Website `fs`: write-then-rename is one localStorage write; `cf.tonight` is only rewritten when the stats or
  the room's highlights changed. Lab: sets the fewest rounds in ⚙ Settings again (it was playing full games).
- **Fix: website loading stuck at 97%** (Nov 13 2026, reported at the cottage): the service worker had no
  timeout on a download, so one stalled file (music, the voice model) never finished; and the browser stops a
  worker after ~5 min on one job, which left the save short of 100%. Now each download times out (20 s game
  files, 90 s media; skipped files are fetched on first use), the TV re-asks after 20 s of no progress (a
  stopped worker restarts and skips what's saved), gives up quietly after 5 tries, and the 60 s fail-safe
  stays hidden. `test/unit/offline-sw.test.js` runs the worker with a download that never ends.
- **Flake fixed: game-night bot test** (Nov 13 2026): failed when every bot scored 0 in a random game (no night
  points, as designed). It now checks the rule exactly: night points > 0 ⇔ someone has scored.
- **Cottage Lab pass 2** (Nov 13 2026): TV labels ≥ 28 px even when the stage zooms (`--unzoom` rule),
  phone tap targets ≥ 48 px, crowded screens (6+ results) get a smaller headline and Closest's results
  go in two columns, the TV marks the screen it shows (`#phase-view[data-phase]`), Back twice leaves via
  `history.back()`. Lab fixes: number boxes get numbers, timed-out taps aren't counted, stale screens
  aren't measured, `LAB_GAMES` keeps order and repeats.

- **2.9 Game errors are shown** (Nov 11 2026): a throw in a game's timer, answer, skip or bot move sends the TV `room:event {type:'glitch'}` (at most one per 5 s) → banner "Something went wrong — press Skip, or End if it stays stuck". `glitch`/`safely` in `core/rooms.js`, `guarded(fn, what, game)` in `games/base.js`; `/api/debug/glitch` (debug only) fakes one for tests.
- **2.5 Lite image** (Nov 11 2026): `docker build --target lite` (or `target: lite` in compose.yaml) leaves out the voice model and sets `RUMPUS_SERVER_VOICE=0`; the default build is unchanged (`full`).
- **2.8 Second TV tab says so** (Nov 11 2026): `secondTabNote()` in `web/host-entry.js`; checked in `test/ui/pages.js` (offline check opens a second TV tab).
- **3.5 Wake-lock hint** (Nov 11 2026): when neither the Wake Lock nor the silent video works, the phone shows a one-time "turn off low-power mode" line (`wakeHint` in `public/play.js`; browser test in `test/ui/run.js`).
- **4.2 Harsh load nightly** (Nov 11 2026): `.github/workflows/nightly.yml` runs `scripts/load-harsh.sh` every night and on demand.
- **Fix: "Now playing" toast blocked clicks** (Nov 11 2026): it sat over the lobby's bottom-left buttons (+1 bot); with short tracks it never left. Now `pointer-events: none`.
- **3.2 Rainy Day Cards room favourite** (Nov 11 2026): everyone but the Czar ❤ one card (not their own) while the Czar judges; most-liked card(s) +200 × stakes, shown on the reveal. Playtest: 2.9 → 4.5 actions/min.
- **3.3 Storm Watch hunch** (Nov 11 2026): a private, changeable "who's a raccoon?" tap during the talk (not the leader), revealed with ✔/✘ on the final screen. No points.
- **4.5 Chaos bots** (Nov 11 2026): `test/unit/chaos.test.js` — 3 chaos phones (late, repeated, empty, junk, wrong-screen input, random pace votes) + 2 bots play the changed games (all in CI); fails on any game error or a screen that lasts > 90 s.
- **Testing + CI/CD overhaul** (Nov 12 2026, `docs/future-features/testing-plan.md`): one `ci.yml` (checks → browser + docker compose smoke → Pages deploy only after both pass; cancels stale runs), nightly chaos seeds + flake runs, reusable `test/kit/`, golden replays, trivia/fibbage/cah moved onto `BaseGame` (−200 lines), shared `makeRoom` test helper.
- **Feel on cheap devices + responsible play** (Nov 13 2026, `docs/future-features/feel-plan.md`): Cottage Lab (simulated 2022 Samsung TV + Galaxy A15 phones, per-screen scorecard, `/bench` calibration), Chromium 85 fixes + test, TV remote control, faster TV fitting, 28 px TV text, 🙈 leave me out, 😴/🙂/🤩 ratings, 🕊 Calm, flash-safety test, 18+ notice, website privacy line.
- **4.6 Strict TypeScript** (Nov 11 2026): already at 0 everywhere (`types/strict-baseline.json`).
- **4.7 Seeded replays** (Nov 11 2026): `RUMPUS_REPLAY=1 RUMPUS_SEED=<n>` ignores (and never writes) question history and telemetry, and draws prompts from the seed, reset at each game start.
- **Review fixes** (Nov 11 2026): a timer that throws stays pending, so Skip / the phones' vote retry it; `hurry` undoes the house per-game timer multiplier (and keeps unscaled timers unscaled); game start, skip-question, hurry and player-left are guarded too; `host:startGame` with `constructor`/`toString` no longer throws; trivia's speed bonus uses the real (scaled) clock; the wake hint shows only on a real refusal after a tap; the second-tab note goes away after 15 s.
- **3.4 Join mid-game (trivia-style)** (Nov 11 2026): `lateJoin: true` in trivia, Closest Cast, Cabin Superlatives, Campfire Consensus and the game-night vote; the newcomer plays the current screen at once.
- **Fix: Campfire Sequence buttons dead on real phones** and **Loon Call song kept playing after Skip** (Nov 11 2026): the two HIGH findings from the per-game reviews.
- **Connection fixes** (Nov 11 2026): saved rooms re-stamped while in use (no 30-min expiry of a quiet lobby); no orphaned drop/close timers; the TV keeps retrying its room name after a crash and says so; a replaced TV tab keeps the saved key; a phone with no internet is told so; reload lock wait; boot flag; kicked phones see the message; TV grace 5 → 30 min.
- **2.1 Resume after a reload/restart (first games)** (Nov 11 2026): rooms save the game's `save()` state; when the TV is back the game's `resume()` restarts the current question/category pick (TV: "WE'RE BACK! … picks up where it left off"). Trivia and Closest Cast; the rest still report "cut short".
- **3.4 Join queue for role games** (Nov 11 2026): a phone joining mid-Quips/Storm Watch/… gets "You're next!" and is dealt in when the game ends (`room.queue`, `admitQueue`; `hostPayload.queued` lists who's waiting).
- **4.1 Website speed test** (Nov 11 2026): `?net=rtc-local` = real WebRTC data channels between tabs (offer/answer over a BroadcastChannel, no broker); `test/ui/pages.js` times 3 phones' round trips (p50 < 25 ms, p95 < 80 ms).
- **4.3 TV-fit check without grace** (Nov 11 2026): the late re-fit came from images/fonts loading (host.js re-fits 50 ms after each image `load`). The TV now reports `cfLayoutIdle()` (no re-fit pending, fonts and images in, no wipe); the snapshot test measures once then, with no "wait until it fits" window.
