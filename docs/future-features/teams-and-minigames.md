# Teams + Minigame Mayhem (design doc) — requested, next up

## Research summary
Board-game-style party video games mix a main "board" with **short, simple minigames**
(10–30 s, one verb: tap, time, remember, balance), often **team vs team** (2v2, 1v3, 2v2v...).
What makes them work: instant rules (one sentence), physical/real-time input, constant
re-shuffling of who's allied with whom, and comeback opportunities that still need skill
([comeback design](https://bugnet.io/blog/how-to-design-a-comeback-mechanic)).

## Part 1 — Team mode for existing games
- Lobby toggle **Teams: off / 2 teams / auto-balance**. Teams 🔴 Red vs 🔵 Blue, assigned by
  snake draft on current scores (or random), players can swap in the lobby.
- Scores stay per player; **team score = sum** (shown as two big bars on the TV + sidebar badges).
- Game-specific team twists (cheap, high value):
  - **Trivia/Closest:** team answer = majority/average of the team (huddle on phones).
  - **Punchline:** matchups are always Red vs Blue; voters can't vote for their own team.
  - **Odd One Out:** the imposter's team wins if they escape.
- Server: `room.settings.teams`, `player.team`, `teamScores()` in broadcast; flow unchanged.
- Tests: balancing, swaps, team totals, no-own-team voting in Punchline.

## Part 2 — new game: *Minigame Mayhem* (original)
A best-of-N series of 15–25 s real-time minigames; teams re-shuffle every 3 games
(2v2, 1v3 "underdog" with ×2 points, free-for-all). Ideas (all original, phone-only input):

| Minigame | Verb | Rules |
|---|---|---|
| **Paddle Race** | tap fast | tap alternating left/right buttons to paddle your team's canoe across the lake (TV shows canoes). |
| **Tug of Lake** | tap fast | both teams tap; the rope moves by tap difference; first to pull 10 m wins. |
| **Quick Draw** | reaction | screen says WAIT… then GO! First tap wins; early tap = splash. |
| **Firefly Count** | estimate | fireflies flash on the TV for 5 s; closest count wins. |
| **Loon Call** | memory | TV plays 3–7 pitch notes; repeat them on 4 phone buttons. |
| **Steady Paddle** | timing | stop a sliding marker in the green zone (3 tries, best counts). |
| **Marshmallow Roast** | hold | hold the button to roast; release in the golden window, too long = burnt. |
| **Mosquito Swat** | tap targets | bugs pop up on your phone for 15 s; most swats wins. |

Tech notes:
- Real-time input: `player:input {seq, t}` events at up to 20/s per phone; server
  authoritative (rate-limited, validated); latency tolerance via server timestamps
  (local server ⇒ low RTT; our debug panel shows RTT).
- TV rendering on the 30 fps clock (canvas, pixel sprites) — reuse bg.js style.
- No content pool needed (mechanics, not questions) → the 1000-item rule doesn't apply.
- Tests: deterministic simulation of each minigame with scripted inputs (unit), anti-spam rate
  limit, browser test for Tug of Lake with 4 phones tapping.

**Size:** Part 1 medium (~400 lines + tests), Part 2 large (~1,500 lines + tests).
