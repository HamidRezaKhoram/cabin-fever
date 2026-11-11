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
| 2.1 | **A reload/restart loses the game in progress** (room, seats, scores, game night are kept). | Per-game `save()` / `resume()`: timers are closures today, so each game needs its phases restartable. Start with the simple ones (trivia, Closest Cast). | L |
| 2.2 | **Website version needs internet to join** (free PeerJS service introduces phone and TV). | Bundle a tiny PeerJS server in Docker for LAN use, or QR-code signalling (phone scans TV, TV scans phone) for a fully offline join. | L |
| 2.3 | **Weak TVs can't run the natural voice in the browser** (2 cores: 5–7 s per line → robot voice). | Try WebGPU (`device: 'webgpu'`, fp16 model) and pick whichever is faster at start-up; needs a real GPU to test. | M |
| 2.4 | **Natural voices are English only**; French rooms get the robot. | Another model for French (Piper has French voices) behind the same `speak` interface. | M |
| 2.5 | **Docker image is ~1.4 GB and uses ~1 GB of memory** (full-size voice model). Too much for a small Raspberry Pi. | Ship a "lite" image tag without the server voice (`RUMPUS_SERVER_VOICE=0` already makes the TV do it). | S |
| 2.6 | **Docker phones have no fast channel** (WebSocket = TCP). | WebTransport needs HTTP/3 and real certificates; only worth it if 1.4 shows a clear win. | L |
| 2.7 | **Locked phones disconnect.** Browsers don't allow background connections. | Nothing in a web page; a wrapped app (Capacitor) could. Out of scope unless it hurts. | L |
| 2.8 | **Second TV tab in one browser** gets its own unsaved room (by design, so it can't take the first one's). | Show a line on that tab: "another tab is hosting". | S |
| 2.9 | **A game error is logged, not shown.** The game may sit until its timer or Skip. | Send the TV a `room:event {type:'glitch'}` from the guarded timer and show "Something went wrong — press Skip". | S |
| 2.10 | **No login anywhere** (admin page, kicking). Fine on cottage Wi-Fi; never expose to the internet. | Optional host PIN for `/admin`. | S |
| 2.11 | **Phones are trusted for some results** (hold time, balance, tap times). Accepted for friends. | — | — |

## 3. Features not built yet

| # | Feature | Notes | Size |
|---|---|---|---|
| 3.1 | **Message in a Bottle: scribble pad** for players waiting on others. | Doodles could float across the TV. | M |
| 3.2 | **Rainy Day Cards: room-favourite vote** before the Czar picks (bonus points). | Fills the Czar's thinking time. | M |
| 3.3 | **Storm Watch: private "hunch" tap** during the talk (who do you suspect?), revealed at the end. | Gives quiet players something to do. | M |
| 3.4 | **Join mid-game** (today: only between games). | Easy for trivia-style games; role games need a "next round" queue. | M |
| 3.5 | **Wake-lock failure hint** on the phone ("your screen may sleep — turn off low-power mode"). | `keepAwake()` already knows when both methods fail. | S |
| 3.6 | **Cottage Crush: remaining agendas** (see `dating-game.md`). | | M |
| 3.7 | **More French content**: trivia, Fish Tales, Closest Cast and Rainy Day Cards are English only (marked EN). | Needs sourced French packs (`content-research.md`). | L |
| 3.8 | **Send only what changed** in state updates (~2 KB → a few hundred bytes). | Not needed on a LAN; revisit only if 1.3/1.4 show lag. | M |

## 4. Tests and tooling

| # | What | Size |
|---|---|---|
| 4.1 | **Speed test for the website version** with real browser-to-browser links (today only the Docker server is timed). | M |
| 4.2 | **Put `scripts/load-harsh.sh` in CI** (bad Wi-Fi + ¼-CPU server; ~2 min) — nightly rather than per push. | S |
| 4.3 | **TV-fit check tolerance**: it now waits up to 1.5 s for a screen to settle; a screen that overflows briefly then fits passes. Tighten once the cause of the late re-fit (fonts? images?) is found. | S |
| 4.4 | **Real-broker test** for 1.1 (two browsers through the PeerJS service; needs internet, so keep it out of the default suite). | M |
| 4.5 | **Bots don't misbehave**: they always answer sensibly and never vote. Add a "chaos bot" (late, empty, repeated, wrong-phase input; random pace votes). | M |
| 4.6 | **Strict TypeScript ratchet** to zero (`types/strict-baseline.json`). | M |
| 4.7 | **Seeded replays end to end**: prompts come from what the house has already played, so a seed fixes the dice but not the questions. A `RUMPUS_SEED` mode that also ignores history would replay a whole game for debugging. | S |

## 5. Housekeeping

- **Content licences**: card packs and one trivia source are non-commercial. Personal use is fine; list them in the README before sharing the repo widely.
- **Unknown container** `c63a6ec77669` (node:20-alpine, up since Nov 10) on the dev machine: not from this work — check it.
- **Docs to refresh** after the next playtest: `playtest-findings.md`, `game-improvement-plans.md`.
