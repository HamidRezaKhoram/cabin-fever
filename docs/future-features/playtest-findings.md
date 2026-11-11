# Bot playtest findings (test/playtest.js)

> **Latest run (after the fix list):** see the table in `docs/design/party-game-design.md`.
> Headline: Porch Confessions idle 58 → 30 s, Telephone 81 → 61 s, Fish Tales 53 → 41 s, Campfire Quips
> 44 → 39 s; Majority 1.9 → 2.9 actions/min; new games Cottage Crush (3.9/min) and Cottage Olympics.
> The table below is the original (first) run.


4 bots with human-like think time (2–7 s to tap, 8–25 s to write) played every game with the
default settings. Real-time equivalents:

| Game | Minutes | Actions / player | Actions / min | Worst idle (s) | Reveals |
|---|---|---|---|---|---|
| Campfire Quips | 3.2 | 8 | 2.5 | 44 | 8 |
| Fish Tales | 3.6 | 10 | 2.8 | 53 | 5 |
| Lakeside Quiz | 2.6 | 10.8 | 4.1 | 22 | 10 |
| Closest Cast | 1.3 | 6 | 4.5 | 17 | 6 |
| Campfire Consensus | 3.2 | 6 | 1.9 | 46 | 6 |
| Cabin Superlatives | 1.4 | 6 | 4.4 | 18 | 6 |
| Odd Duck Out | 1.8 | 6.3 | 3.4 | 32 | 3 |
| Porch Confessions | 1.7 | 4 | 2.4 | 58 | 4 |
| Message in a Bottle | 2.9 | 5 | 1.7 | 81 | 1 |
| Rainy Day Cards | 2.8 | 8 | 2.9 | 29 | 8 |

Targets from the research (TV-show pacing, no dead air, players are the stars):
**worst idle ≤ 25 s, ≥ 3 actions/min, a reveal at least every ~40 s.**
Bots don't laugh, so this measures pacing, not jokes — but pacing is where party games die.

## What's already good
Trivia, Closest Cast and Cabin Superlatives hit every target. The pace votes (hurry/next/skip)
shipped in this round directly attack the idle numbers below once real players use them.

## Fix list (ordered by impact)
1. **Message in a Bottle (81 s idle, 1 reveal).** ✅ Draw time cut to 60 s; ✅ the TV names who it's
   still waiting on; ✅ reveal entries actually show now (they were invisible — CSS bug).
   ✅ After each chain, everyone taps a favourite step (+50 to its author).
   ✅ 6+ players: two groups with shorter chains.
2. **Porch Confessions (58 s).** ✅ Write phase cut to 90 s and the TV names who's still writing. Next step if still slow: split it — write *one*
   statement per mini-phase (truth, truth, lie) with 30 s each, and show a teaser on the TV
   ("Ben is lying about something…"). Add a bonus for guessing *which truth* surprised people most.
3. **Fish Tales (53 s).** ✅ Done: likes (+50 each) after you've guessed. Was: fast liars wait for slow ones: add **"likes"** (tap lies you find funny
   during the choose phase, +50 each) so everyone has something to do; hurry vote helps.
4. **Campfire Consensus (46 s, 1.9 actions/min).** ✅ Done: "how many will match you?" bet (+150 exact, +50 for "nobody"). Was: Only one action per round. Add a second tap:
   **"How many will match you?"** wager (0–N) for bonus points — doubles the decisions.
5. **Campfire Quips (44 s).** ✅ Authors place a side bet (I'll win / Landslide) while the room votes. Was: Authors sit out their own matchup. Let authors place a **side bet**
   ("I'll win by a landslide" ×2 / "I'll lose" ×0.5) and give 3-player games a final
   **everyone-answers-one-prompt** round so all three vote each time.
6. **Odd Duck Out (3 reveals).** ✅ Suspicion meter + clues popping in one by one. Was: Add a mid-round "suspicion meter" on the TV that fills as votes
   come in, and reveal clues one at a time with a drumroll.
7. **Rainy Day Cards.** ✅ The czar picks next round's prompt from three while cards come in. Was: The czar idles while cards come in: let the czar pre-rank black-card
   "vibes" (spicy/clean) to pick the next prompt — gives them a job.
8. **Global:** ✅ Trivia has a once-per-game Double Down (×2 / −300); Majority has match bets. Still open: wagering ("double down" on your confidence) in Trivia/Closest — the research
   calls it out as one of the most satisfying mechanics; audience voting (see backlog).

Re-run after each fix: `node test/playtest.js` (inside the node container) and compare.

## Round 3 (Nov 10 2026)
| Game | Before | After | What changed |
|---|---|---|---|
| Cottage Olympics | 53–78 s idle | 16–17 s, 36 actions/min | The big idle was a playtest bug (Quick Draw's 2–5 s wait wasn't scaled at 10×). Also: results 6 → 4.5 s, firefly guesses can lock in while they're still on screen, bots react in 0.2–0.5 s. |
| Cottage Crush | 53 s (73 s at 6p), 3.2–3.9 actions/min | 34 s (42 s at 6p), 6.0 actions/min | One free anonymous **wink** a night (+50 if it becomes a date), Matchmaker + Gossip agendas give two players side actions. |

Tooling: `worstIdleAt` in the report names the stretch; a static test forces every game timer to be scaled.
| Loon Call (new) | 33 s idle (caller sat out their call) | 22 s, 27 actions/min | The caller echoes their own call with everyone. |
| Lantern Lake (new) | — | 2.5 min, worst idle 10 s | Continuous steering; phones' arrows/scores push 2×/s. |
| Storm Watch (new) | — | bots: 2–3 min, 4 actions/min, worst idle 31–35 s (the talk phase) | Real play ≈ 10–12 min: talk 60 s × 5 chores. |
| Campfire Wizards (new) | 28–30 s idle (1.2 s per spell) | 21 s (4p), 24 s (6p), 32 s (8p) | 0.9 s per spell, reveal capped at ~8 steps, 12 s picks. |

## Round 4 (Nov 11 2026)
| Game | Before | After | What changed |
|---|---|---|---|
| Rainy Day Cards | 2.9 actions/min, worst idle 29 s | 4.5 actions/min, 23 s (4p); 4.2 actions/min, 25 s (6p) | **Room favourite**: while the Czar judges, everyone else ❤ one card (not their own); the most-liked card(s) get +200 × stakes. Shown on the reveal. |
| Storm Watch | worst idle 31–35 s (the talk phase) | 30 s (5p), 33 s (8p), 3.6–4.1 actions/min; worst stretch is now the vote | **Private hunch**: during the talk everyone but the leader taps who they suspect (changeable), shown with ✔/✘ on the final role reveal. |
