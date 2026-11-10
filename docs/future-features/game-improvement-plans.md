# Full bot run-through of all 16 games + improvement plans (Nov 10 2026)

`node test/playtest.js` (10× speed, human-like bot think times) at 4 and 6 players, on a quiet
machine (CPU contention inflates "idle": Campfire Wizards read 40 s while another test ran, 20 s
alone). Targets from `docs/design/party-game-design.md` §2: worst idle ≤ 25 s (tap games) /
≤ 45 s (writing/drawing), ≥ 3 decisions per player per minute, 3–8 minutes a game.

| Game | Min (4p / 6p) | Decisions/min | Worst idle (4p / 6p) | Where the idle is | Verdict |
|---|---|---|---|---|---|
| Campfire Quips | 2.9 / 4.1 | 3.6 / 3.9 | 35 / 29 s | voting → answering | ✅ writing game, within 45 s |
| Fish Tales | 3.7 / 4.6 | 3.2 / 3.1 | 46 / 51 s | reveal → next lie | ◐ just over 45 s |
| Lakeside Quiz | 2.5 / 2.5 | 4.2 / 4.1 | 18 / 21 s | — | ✅ |
| Closest Cast | 1.4 / 1.3 | 4.4 / 4.7 | 18 / 18 s | — | ◐ too short |
| Campfire Consensus | 3.6 / 3.6 | 3.3 / 3.1 | 53 / 56 s | fast answerers wait for slow ones | ✗ too much waiting |
| Cabin Superlatives | 1.3 / 1.3 | 4.6 / 4.5 | 17 / 17 s | — | ◐ too short |
| Odd Duck Out | 2.0 / 2.0 | 3.2 / 3.0 | 30 / 42 s | vote → next clue | ◐ over 25 s |
| Porch Confessions | 1.4 / 1.7 | 2.9 / 3.6 | 32 / 29 s | waiting for the subject's guessers | ◐ short, a bit idle |
| Message in a Bottle | 3.4 / 3.9 | 2.6 / 2.5 | 59 / 69 s | waiting for the slowest drawer | ✗ drawing waits |
| Cottage Olympics | 1.7 / 1.6 | 61 / 35 | 16 / 18 s | — | ◐ too short |
| Loon Call | 3.0 / 3.0 | 26 / 28 | 22 / 22 s | — | ✅ |
| Lantern Lake | 2.5 / 2.5 | 115 | 10 / 10 s | — | ✅ |
| Storm Watch | 3.3 / 2.8 (≈10–12 real) | 4.2 / 3.5 | 29 / 40 s | the talk phase (bots don't talk) | ✅ by design, see plan |
| Campfire Wizards | 1.2 / 1.8 | 4.1 / 2.9 | 20 / 32 s | everyone waits for the last caster | ◐ short; 6p idle |
| Cottage Crush | 5.3 / 6.1 | 6.3 / 5.8 | 35 / 51 s | mingle → pick at 6 players | ◐ 6p idle |
| Rainy Day Cards | 2.7 / 2.9 | 3.6 / 3.2 | 27 / 32 s | submit → czar | ◐ slightly over |

## Plans, most needed first

1. **Campfire Consensus (✗ 53–56 s).** Answers are one or two words, but the timer is 30 s plus an
   8 s bet window, and quick players sit through it all.
   - Answer timer 30 → 20 s.
   - Show live "answers in" avatars on the TV, so the room nudges stragglers.
   - While you wait, a one-tap **"guess the top answer"** pick from three earlier answers (+50).
   - Close the phase the moment everyone has answered and bet (this already happens; keep it).
2. **Message in a Bottle (✗ 59–69 s).** Drawing takes time by nature.
   - Default draw time 60 → 45 s, with a house-rule option for 60 s.
   - A **"Done!" button** so finished drawers end early; the step ends when everyone is done.
   - A waiting player gets a tiny **scribble pad** that the TV shows as a ticker ("doodles from the
     waiting room"): something to do, no pressure.
3. **Odd Duck Out (30–42 s).** Clue timer 40 → 25 s (it's one word) and vote 40 → 25 s. The
   suspicion meter already makes the vote watchable; a "lock in" end-early is already there.
4. **Cottage Crush (51 s at 6 players).** Mingle 45 → 35 s at 6+ players. Skip the reply phase
   entirely when nobody got notes. Add a TV "dock gossip" ticker (who winked at how many, never who)
   so the wait is watchable.
5. **Fish Tales (46–51 s).** Add the "still writing: Ann, Ben" row (as in Message in a Bottle), lie
   timer 45 → 40 s, reveal 10 → 8 s.
6. **Short games: Closest Cast, Cabin Superlatives, Cottage Olympics, Campfire Wizards (1.2–1.8 min).**
   Raise the defaults so a game hits the 3-minute floor:
   - Closest Cast 6 → 10 questions; Cabin Superlatives 6 → 10 prompts; Cottage Olympics 6 → 9 minis.
   - Campfire Wizards: 6 hearts (from 5) and a sudden-death "ember ring" only after round 8, so
     duels don't end in five rounds.
7. **Campfire Wizards at 6+ (32 s).** Pick timer 12 → 10 s at 6+ players. Show "ready ✓" sparkles
   on the circle as people lock in, so the last casters feel the pressure.
8. **Rainy Day Cards (27–32 s).** Non-czar players who already played could pre-vote a "room
   favourite" card (+50 to its author), mirroring the Fish Tales likes.
9. **Porch Confessions (29–32 s, short).** Two confessions each at 6+ players (more rounds). The
   subject sees guesses arrive live and can tap "I'm sweating 😅" reactions while they wait.
10. **Storm Watch.** Bots don't talk, so their numbers understate the game: the talk phase is where
    real players argue. Plan: a private **"hunch"** tap for non-leaders during the talk (mark one
    player you suspect; revealed in the Big Reveal for +50 if right). Everyone then has a phone
    action in every phase.

Lakeside Quiz, Loon Call, Lantern Lake and Campfire Quips meet every target: no changes planned.
Re-run with `GAMES=<id> PLAYERS=4|6 node test/playtest.js` after each change and update this table.
