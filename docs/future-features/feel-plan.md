# Game feel plan: menu to every game, measured on simulated cheap devices (Nov 12)

## Status (Nov 13)

**Done:**
- **Lab:** Cottage Lab (`scripts/lab.sh`, `test/lab/run.js`, `test/kit/perf.js`). Per screen it measures
  TV and phone frames, long tasks, tap latency, dead air, smallest TV text and smallest phone tap target,
  plus CPU profiles of the TV and a phone. It also calibrates with `/bench`. Runs nightly, report only.
- **Chromium 85:** the `tv-compat` test fixed `inset` on 13 full-screen layers, plus `aspect-ratio` and
  `:has()`.
- **TV remote:** arrow keys move a focus ring, OK presses. Browser test included.
- **TV CPU:**
  - no refit when nothing visible changed, and `morph` keeps fitted sizes
  - text is fitted on a hidden copy in a layout root, with all reads before all writes
  - the background batches its draws and pre-renders the glow
- **TV text:** round tag, category banner, category cards, podium points, hints and vote details are
  at least 28 px, and labels grow by 1/zoom so the stage zoom can't push them under 28 px.
- **Responsible play:**
  - 18+ notice on the title screen
  - 🙈 leave me out (Most Likely, Crush)
  - 😴/🙂/🤩 rating after each game, shown in the /highlights Ratings tab
  - 🕊 Calm TV setting
  - flash-safety test
  - privacy line on the website

**Measured** (trivia + quiplash, TV CPU ÷6; this box is shared, so expect ±30% noise):

| | first run | now |
|---|---|---|
| TV CPU: stage fit (`fits`) | 5.0–6.7 s | 3.2 s |
| TV CPU: text fit (`fit`) | 1.8–3.7 s | 2.2 s |
| TV CPU: background draw | 5.3–7.4 s | ~3.4 s, mostly the native `fillRect` |
| TV long tasks per screen | 3–15 | 1–5 |
| quiplash answering: worst TV frame | 100–200 ms | 33–50 ms |
| smallest TV text (most screens) | 10–17 px | 28 px |

**Lesson:** I tried starting the stage-zoom search from the overflow ratio to save layouts. The
snapshot test caught that it can't reach the real answer (gaps don't scale) and made Message in a Bottle
shrink to 52%. Reverted. Layout speed-ups must keep the snapshot test green.

**What we learned from the phone profile:** the phone is mostly idle. Its biggest cost is the native
WebSocket `send` of the Wi-Fi keep-warm (5×/s, about 4 ms each at CPU ÷4). That cost is deliberate
(`docs/design/networking.md`) and kept. The slow taps (p95 120–300 ms, median about 30 ms) happen when a
state update renders at the moment of the tap. On this box that's mostly CPU contention from 4 throttled
pages; calibrate with `/bench` before chasing it.

**Still over budget:**
- **Long tasks at screen changes (200–400 ms on the ÷6 TV):** the new screen's HTML, a full fit, music
  changes and the narrator all start in the same moment. Next: spread them over frames (narrator and
  music a frame after the screen).
- **The category-round screen:** one 12 px label from the menu is still visible during its wipe.

**Not doing:** family mode for player text (the user's call, Nov 13).

Goal: Cabin Fever should feel quick, clear and lively on the hardware people actually own: a
mid-range Samsung TV browser and a mid-range Samsung phone. We judge it with numbers, not hunches:
every screen gets measured against budgets taken from research, and the worst numbers get fixed first.
We also review whether it's responsible for a mixed group.

Builds on `docs/design/party-game-design.md` (pacing targets, 10-foot UI) and the bot playtest; this
plan adds devices, feel metrics and a safety review.

## 1. The "Cottage Lab": two simulated devices

Playwright plus the Chrome DevTools Protocol (CDP) in the same pinned container the tests already use.

| | **TV: "mid Samsung TV"** | **Phone: "mid Samsung phone"** |
|---|---|---|
| Model it stands for | 2022–2023 Crystal UHD (Tizen 6.5–7.0) | Galaxy A14 / A15 |
| Browser engine | Chromium **M85** (2022) / **M94** (2023), per [Samsung's table](https://developer.samsung.com/tv/develop/specifications/web-engine-specifications) | current Chrome and Samsung Internet |
| Screen | 1920×1080 CSS px, DPR 1 | about 384×832 CSS px, DPR 2.8, touch |
| CPU | throttled **6×** (to be calibrated, see below) | throttled **4×**. The A14/A15 are about 2.5–2.7× slower than a current Pixel on single-core Geekbench ([nanoreview](https://nanoreview.net/en/phone-compare/samsung-galaxy-a15-5g-vs-samsung-galaxy-a14), [Geekbench](https://browser.geekbench.com/mobile-benchmarks)), and our test box is faster than a Pixel |
| Network | 2.4 GHz Wi-Fi: 30 ms ± 15 ms, 1% loss (netem, as `load-harsh.sh` does) | same |
| Input | **a remote**: arrow keys plus Enter only, no mouse | taps through touch emulation |

**Calibration, so the numbers mean something:** a tiny `/bench` page (debug only) runs a fixed JS and
canvas workload and prints a score. Run it once on the real TV and the real phone, and once in the lab.
The throttle factor is then `lab score ÷ device score`, recorded in the profile. Until then we use the
estimates above and say so in every report.

**Old-engine check:** we can't run Chromium 85 itself, so we check the code against it statically:
- esbuild with `--target=chrome85` must build the TV bundle with no syntax errors
- a scan for APIs and CSS added after M85 (`structuredClone`, `:has()`, container queries, `aspect-ratio`,
  top-level await, …)

The scan fails the test, or the code needs a fallback.

## 2. What we measure, and the budgets

Each budget comes from research or from our existing design rules. Every screen of every game is
measured, from PRESS START to the final scoreboard: 5 runs, reported as median and p95.

| # | Metric | How | Budget | Why |
|---|---|---|---|---|
| M1 | **Tap feedback** (phone): tap → something visible changes | Event Timing API (`PerformanceEventTiming`) | p95 ≤ **80 ms** | People notice tap delay from about 82 ms, and button quality drops above 100 ms ([Kaaresoja](https://www.immersion.com/wp-content/uploads/2015/10/ux-impact_haptic-latency-in-auto_jul13v1.pdf), [Jota CHI'15](https://dcmpx.remotevs.com/com/tactuallabs/www/SL/papers/howMuchFasterIsFastEnoughCHI15.pdf)) |
| M2 | **Tap → TV reacts** (count, avatar tick) | timestamps on both pages, server clock | p95 ≤ **150 ms** | feels "live" to the room; 100 ms+ network delay hurts play |
| M3 | **Interaction delay** (INP-style, all inputs) | Event Timing | ≤ **200 ms** | Google's "good" INP line |
| M4 | **Frame pacing** at 30 fps | `Rumpus.clock` frame log | dropped frames < **2%**, longest frame < **100 ms** at p99 during wipes and reveals | our own 30 fps rule; one hitch at the reveal is the worst moment for it |
| M5 | **Long tasks** on the TV | `PerformanceObserver('longtask')` | ≤ **2 per screen change**, none > 200 ms | RAIL: work over 50 ms blocks input |
| M6 | **Loading**: TV cold start → PRESS START; phone scan → in the lobby | navigation timing | TV ≤ **5 s**, phone ≤ **4 s** | first impressions; people give up |
| M7 | **Menu to first question** | TV remote presses and seconds, scripted | ≤ **4 presses**, ≤ **30 s** with 4 players | the menu is the first "game" everyone plays |
| M8 | **Memory over a game night** (10 games) | `performance.memory`, CDP heap | growth ≤ **20%** | TV browsers kill tabs on low memory |
| M9 | **Dead air on the TV**: nothing changes on screen | screenshot diff every 500 ms | ≤ **8 s** in a row (except "thinking" screens with a visible timer) | the TV is a stage |
| M10 | **Pacing** (existing playtest) | bots, human-like timing | worst idle ≤ 25 s (tap) / 45 s (writing), ≥ 3 decisions per player per minute, a payoff every ~40 s, 3–8 min per game | `party-game-design.md` |
| M11 | **Readable from the couch** | DOM scan | text ≥ 28 px at 1080p, contrast ≥ 4.5:1, the main prompt ≥ 5% of screen height | 10-foot UI rules (partly tested already) |
| M12 | **Flash safety** | frame luminance from screenshots at 30 fps | ≤ **3 flashes per second**, no saturated red flash | WCAG [2.3.1 / 2.3.2](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) |
| M13 | **Sound** | Web Audio analyser on the TV | narrator ≥ 6 dB over the music; songs within ±2 LU of each other; no clipping | R128 is already measured for files; this checks the live mix |
| M14 | **Juice checklist** per phone action | static + runtime | every tap has haptic, visual and sound feedback; a reveal has a build-up beat | game-feel practice (rule of thumb, not a study) |
| M15 | **"What do I do now?"** | DOM | every phone screen has a status line that tells you; the TV names who it's waiting for | existing design rule, now checked on every screen |

**Output:** `test/lab/report.json` plus a readable scorecard (one row per game screen, one column per
metric, green / amber / red). The scorecard runs nightly so trends are visible, and every fix shows
before and after numbers.

## 3. The "feel" pass: what we'll probably find, from a quick look

- **The TV has no remote support.** `public/host.js` has no arrow-key or Enter handling. On a real
  Samsung TV you'd drive a slow on-screen pointer around the game menu. This is the biggest feel problem
  for the "TV hosts" setup. Fix: arrow-key focus on the game grid and every TV button, a visible focus
  ring, and Enter to press (M7).
- **The old engine:** anything newer than Chromium 85 breaks silently on a 2022 TV (section 1 check).
- **CPU on 6× throttle:** full-screen pixel scenes (`bg.js`) and `Rumpus.fit` on every update are the
  likely long tasks (M4, M5). Options: cache the static background layer, fit once per phase.
- Then fix by worst number: menu → lobby → each game's busiest screen.

The bots then replay each fixed screen, and the numbers have to improve without breaking the pacing
targets (M10).

## 4. Is it responsible? (review)

What's already good: offline at home (nothing leaves the house), no accounts, no ads or purchases,
scores never go below zero, comebacks exist, a benign-humour content filter, house-rule banned words,
`prefers-reduced-motion` is respected by `fx.js` and `bg.js`, timer speed can be slowed, no drinking
mechanics (some prompts mention drinking as a topic only).

What to improve:

| Area | Finding | Proposal |
|---|---|---|
| **18+ default** | Spicy is **on by default** (`RUMPUS_SPICY_DEFAULT` in compose, `core/rooms.js`). Fine for an adult cottage night, risky when kids or family drop in. | Keep it your choice, but put a clear **🌶 18+ ON** badge on the TV lobby and title screen, and add a one-press "family mode" in the lobby. Jackbox puts it under Content Control: [family-friendly + filter + moderation](https://www.jackboxgames.com/blog/safety-and-moderation-streaming-jackbox-games). |
| **Player-written text** | Only house banned words are masked; the 18+ toggle doesn't touch what players type (Jackbox has the same gap). | Family mode also masks a basic profanity list in player text, and the TV gets "hide this answer" (✕) on reveals. |
| **Games about real people** (Most Likely, Cottage Crush, Confessions) | They can single someone out or embarrass them. | A per-player "leave me out of who's-most-likely / crush pairings" switch on the phone; nobody is ever named as a target more than twice in a row; Crush stays opt-in. |
| **Flashing / motion** | No automated check today. | M12 in the lab, plus a "calm mode" TV setting (no shake, no wipes, softer flashes) that doesn't depend on the OS setting. |
| **Hearing** | Music plus narrator can get loud. | M13, and the TV's volume setting remembered per house. |
| **Accessibility** | Colour can be the only cue (teams); reading speed varies; timers stress some people. | Shapes or labels next to team colours; Rocco already reads prompts aloud; add a "no timers / relaxed" option next to timer speed (Jackbox added [extended and no timers](https://jackboxgames.com/streaming-moderation-accessibility-features-jackbox-party-pack-eight)). |
| **Privacy (website version)** | The PeerJS broker and the STUN servers (Google, Cloudflare) see players' IP addresses; drawings and answers stay in the TV's browser and `/highlights`. | Say so in one line on the website's landing page, and add a "clear tonight's highlights" button. Docker stays fully offline. |
| **Game-night length** | Fine as it is; it's a party game, not a slot machine (no streaks, rewards or nags to keep playing). | Nothing to add. Keep it free of engagement tricks. |

## 5. Order

1. **Lab + calibration** (`test/lab/`, a CDP perf helper in `test/kit/`, `/bench`): profiles, metrics
   M1–M15, the scorecard, and a baseline report on every screen.
2. **Remote control + old-engine fixes** on the TV, the biggest feel gap.
3. **Fix by worst number**, menu first, then each game; before and after numbers in
   `docs/future-features/playtest-findings.md`.
4. **Responsible changes**: badge + family mode, opt-outs, calm mode, relaxed timers, privacy line.
5. **One real playtest**: the `/bench` calibration on your TV and phone, plus a 1-tap "how was that?"
   (😴 / 🙂 / 🤩) after each game, stored locally, so we can check the lab numbers predict what people
   actually feel.

To make the simulation match your hardware, tell me your TV's model or year and your phone model.
