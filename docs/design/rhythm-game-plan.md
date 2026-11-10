# Loon Call — a call-and-response rhythm party game (research + game plan)

Status: ✅ **shipped** (Nov 10 2026) — `games/looncall.js`. Playtest: 3 min, 27 decisions/min, worst idle 22 s. Original game: our own name, characters (cottage
loons), music and look. Mechanics are genre-standard (call and response, tap on the beat).

## 1. Research: what makes this kind of rhythm game fun
Sources: Iwata Asks interviews on *Rhythm Heaven* / *Fever*; Wikipedia's series overview; previews
of *Rhythm Heaven Groove* (2026); rhythm-game timing articles; Android audio-latency data;
TV latency tests; group-drumming studies (Gordon et al., *Sci. Rep.* 2020).

1. **Sound first, picture second.** The series' founding idea is a rhythm game you can play by ear:
   audio cues carry the timing, visuals are the joke. → Every cue in Loon Call is audible; the
   TV is for comedy and feedback, not a note highway.
2. **Call and response.** Almost every minigame is "the game shows a pattern, you answer it".
   It teaches itself: you never read instructions, you copy what you just heard.
3. **One button, simple rules, low floor.** The design priorities were simplicity, easy
   controls and not leaning on characters. → One big tap button on the phone. (Holds later.)
4. **Fun to watch, harder to do.** Watching someone play looks easy and trying it is harder, and
   that's what makes the room laugh. → Show every player's loon on the TV reacting to each tap,
   so misses are visible and funny, never humiliating.
5. **Moving together feels good.** In group-drumming studies, drumming in sync increases felt
   cohesion, and even drumming out of sync builds trust. → A cooperative **IN SYNC!** bonus
   when the whole room nails a phrase, on top of individual scores.
6. **Clear feedback:** early / late / perfect, readable at a glance.

## 2. Technical constraints (the make-or-break part)
| Source of delay | Typical | Notes |
|---|---|---|
| Phone touch → browser event | 10–35 ms (Android native ~20), up to 200 ms on cheap phones | varies per phone, constant per phone |
| Wi-Fi socket one-way | 2–20 ms, jitter | we time-stamp on the phone, so jitter doesn't matter |
| Phone ↔ server clock | unknown | NTP-style sync over the socket (min-RTT of several pings) |
| TV audio out (HDMI, soundbar, Bluetooth) | ~10 ms to 300 ms | the same for every player in the room |

Decisions:
- **Phones timestamp taps** with a synced server clock (`Rumpus.time.now()`), so network jitter
  never affects judging.
- **Tune-up calibration** at the start: everyone taps along to 8 clicks from the TV. Each phone's
  median offset absorbs TV audio delay + touch delay + residual clock error; judging subtracts it.
  (Rhythm-game devs treat calibration as essential; ours is automatic and takes ~10 s.)
- **Party-sized timing windows** (after calibration): Perfect ±70 ms, Good ±140 ms, nearest-note
  matching within ±220 ms. Tighter than this would punish phones, not players.
- **Anti-mash:** extra taps that match no note cost points, so hammering never wins.
- TV audio is scheduled with Web Audio at exact server times (no `setTimeout` drift); animation
  runs on the shared 30 fps clock (CLAUDE.md rule 3).

## 3. The game
**Pitch:** "The lake's loon choir needs new voices. Listen to the call, then echo it back —
together."

**Intro card (3 lines):** Listen to the loon's call · Tap the same rhythm back on your phone ·
Nail it together for IN SYNC bonuses.

**Loop (≈4 min, every player plays all the time, nobody waits):**
1. **Tune-up** (~12 s): tap along with 8 clicks → calibration (no points). TV: "Tuning the choir…".
2. **Song 1, "Dawn Chorus"** (×1, ~92 bpm, ~30 s): 6 phrases. Each phrase = the lead loon calls a
   1-bar pattern (8th-note grid), then everyone echoes it in the next bar. Patterns ramp from
   quarter notes to simple syncopation.
   *Change after playtest:* the caller echoes their own call too (sitting out left them idle 33 s).
3. **Result flash** (~5 s): per-player hit %, grade (*Nailed it!* / *Close enough* / *Off the
   beat*), IN SYNC count — the staged reveal.
4. **Your Call** (players are the content): the trailing player (comeback) taps their own 1-bar
   pattern on the phone over a count-in; it's quantised to the 8th grid. Then the room echoes it
   3 times. The caller earns `notes × fraction of the room that echoed them right` — tricky but
   fair patterns score best; random noise scores nothing.
5. **Song 2, "Paddle Groove"** (×2, ~108 bpm): syncopation, rests, triplet-free 8ths.
6. **Your Call** again (new trailing player).
7. **Final, "Moonlight Remix"** (×3, ~120 bpm): mixes everything; TV says FINAL SONG.
8. Game over → standard podium and awards.

**Scoring per echoed note:** Perfect 30, Good 15, miss 0; extra tap −5 (never below 0 per
phrase); clean phrase (every note hit, no extras) +20; **IN SYNC** (whole room clean) +10 each.
Stage multiplier ×1/×2/×3. Scores never go below zero.

**Pacing check vs §2 targets:** every player acts in every phrase (≈ 20+ decisions a minute);
worst idle is the result flash + tune-up (≤ 15 s), or watching someone write a Call (≤ 10 s);
payoff every phrase (instant feedback) plus a staged result per song; ~4 min total.

**TV (10-foot UI):** a lake scene; the lead loon on the left, every player's avatar in a row as a
choir. Call notes make the lead loon sing (bounce + note glyph); each player's tap makes their
avatar bob, with a gold / green / grey ring for perfect / good / miss and an EARLY / LATE tag.
A big beat counter "CALL · · · ·" / "ECHO · · · ·" shows whose turn it is.

**Phone:** one giant button (≥ 46 vh, like the minigames), labelled LISTEN… during calls and
ECHO! during responses, with a local tap sound + short vibration. Results show your % and grade.

**Bots:** the bot brain echoes the pattern of a finished response bar with human-like ±40 ms
noise and an occasional miss (taps are sent as a batch with timestamps).

## 4. Build checklist (CLAUDE.md "add a game")
- `games/looncall.js` (BaseGame; pure `judge()`, `calibrate()`, `quantise()` exported for tests),
  registry in `server.js`, `noPaceVotes`.
- Clock sync: `time:ping` ack on the server; `Rumpus.time` in `common.js` (min-RTT of 6 pings,
  resync every 20 s).
- TV renderer + Web Audio sequencer in `public/games.js`; music engine yields during songs.
- Icon (`sprites.js`), scene (`bg.js`), colours (`style.css`), music style (`music.js`
  `GAME_STYLE`), rules (`host.js` `RULES`), French blurb/rules (`i18n.js`), bot brain.
- Tests: judging windows/anti-mash/clean bonus; calibration median & clamps; quantise; full
  game with bots; Your Call scoring; static registries (existing tests); browser: a real phone
  tap lands on the TV during a song. Playtest at 4 and 6 players.
