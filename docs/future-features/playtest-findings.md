# Bot playtest findings (test/playtest.js)

4 bots with human-like think time (2–7 s to tap, 8–25 s to write) played every game with the
default settings. Real-time equivalents:

| Game | Minutes | Actions / player | Actions / min | Worst idle (s) | Reveals |
|---|---|---|---|---|---|
| Punchline | 3.2 | 8 | 2.5 | 44 | 8 |
| Fib Finder | 3.6 | 10 | 2.8 | 53 | 5 |
| Trivia Blast | 2.6 | 10.8 | 4.1 | 22 | 10 |
| Closest Guess | 1.3 | 6 | 4.5 | 17 | 6 |
| Majority Rules | 3.2 | 6 | 1.9 | 46 | 6 |
| Most Likely To | 1.4 | 6 | 4.4 | 18 | 6 |
| Odd One Out | 1.8 | 6.3 | 3.4 | 32 | 3 |
| Two Truths & a Lie | 1.7 | 4 | 2.4 | 58 | 4 |
| Doodle Telephone | 2.9 | 5 | 1.7 | 81 | 1 |
| Card Chaos | 2.8 | 8 | 2.9 | 29 | 8 |

Targets from the research (TV-show pacing, no dead air, players are the stars):
**worst idle ≤ 25 s, ≥ 3 actions/min, a reveal at least every ~40 s.**
Bots don't laugh, so this measures pacing, not jokes — but pacing is where party games die.

## What's already good
Trivia, Closest Guess and Most Likely To hit every target. The pace votes (hurry/next/skip)
shipped in this round directly attack the idle numbers below once real players use them.

## Fix list (ordered by impact)
1. **Doodle Telephone (81 s idle, 1 reveal).** ✅ Draw time cut to 60 s; ✅ the TV names who it's
   still waiting on; ✅ reveal entries actually show now (they were invisible — CSS bug).
   ✅ After each chain, everyone taps a favourite step (+50 to its author).
   ✅ 6+ players: two groups with shorter chains.
2. **Two Truths (58 s).** ✅ Write phase cut to 90 s and the TV names who's still writing. Next step if still slow: split it — write *one*
   statement per mini-phase (truth, truth, lie) with 30 s each, and show a teaser on the TV
   ("Ben is lying about something…"). Add a bonus for guessing *which truth* surprised people most.
3. **Fib Finder (53 s).** ✅ Done: likes (+50 each) after you've guessed. Was: fast liars wait for slow ones: add **"likes"** (tap lies you find funny
   during the choose phase, +50 each) so everyone has something to do; hurry vote helps.
4. **Majority Rules (46 s, 1.9 actions/min).** ✅ Done: "how many will match you?" bet (+150 exact, +50 for "nobody"). Was: Only one action per round. Add a second tap:
   **"How many will match you?"** wager (0–N) for bonus points — doubles the decisions.
5. **Punchline (44 s).** ✅ Authors place a side bet (I'll win / Landslide) while the room votes. Was: Authors sit out their own matchup. Let authors place a **side bet**
   ("I'll win by a landslide" ×2 / "I'll lose" ×0.5) and give 3-player games a final
   **everyone-answers-one-prompt** round so all three vote each time.
6. **Odd One Out (3 reveals).** ✅ Suspicion meter + clues popping in one by one. Was: Add a mid-round "suspicion meter" on the TV that fills as votes
   come in, and reveal clues one at a time with a drumroll.
7. **Card Chaos.** ✅ The czar picks next round's prompt from three while cards come in. Was: The czar idles while cards come in: let the czar pre-rank black-card
   "vibes" (spicy/clean) to pick the next prompt — gives them a job.
8. **Global:** ✅ Trivia has a once-per-game Double Down (×2 / −300); Majority has match bets. Still open: wagering ("double down" on your confidence) in Trivia/Closest — the research
   calls it out as one of the most satisfying mechanics; audience voting (see backlog).

Re-run after each fix: `node test/playtest.js` (inside the node container) and compare.
