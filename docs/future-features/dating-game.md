# Cottage Crush — a speed-dating party game (design doc)

> ✅ **Shipped** (games/crush.js): 4 evenings, notes/replies/picks, 6 agendas (Heartbreaker,
> Hopeless Romantic, Wallflower, Player, Matchmaker — once-per-game setup, +300 if they date;
> Gossip — hears who writes to whom, one couple bet a night, +200), leader exposed from evening 3;
> payoffs reveal who was pulling strings on the dock. Not built yet: a 3-player Mystery Guest bot,
> walking-pair animation on the dock.

## Research

The best-known example of the genre is *Monster Seeking Monster* (Jackbox Party Pack 4), a
3–7 player dating game ([Wikipedia](https://en.wikipedia.org/wiki/The_Jackbox_Party_Pack),
[Jackbox blog](https://jackboxgames.com/blog/the-best-2-player-jackbox-games-for-a-cheap-at-home-date-night)).
At the level of *mechanics* (which is all we borrow — never names, art, text or look):

- Each round is a "night": players get a **small, fixed budget of private messages** to send to
  other players, then each **secretly picks one person to date**.
- **Mutual picks score** for both; picking nobody costs you. Scarcity (few messages) makes every
  message a decision and creates gossip at the table.
- **Hidden powers** per player change scoring, and identities are **revealed over time**
  (the leader gets exposed), which is a built-in comeback/rubber-band mechanic.
- Fixed number of rounds; most points wins, with special win conditions for some powers.

Why it works (from the general party-game research in playtest-findings.md): private phone info
+ public TV reveals, players are the stars (their own messages), and constant small decisions.

## Original design: *Cottage Crush*

**Theme.** A summer cottage singles weekend. Each player is a pixel animal at the lake (uses our
avatars). The TV is the "cottage dock" where dates are announced like a reality show.

**Players.** 4–8 (with 3, a host-bot "Mystery Guest" joins so pairs work).

**Round = one evening (6 evenings):**
1. **Mingle (60 s):** each player has **3 notes** to slip to others. A note is either free text
   (≤ 80 chars) or a pick from 4 generated opener cards (content pool `crush-openers`, ≥1000,
   ~30% 18+). Notes arrive on the recipient's phone immediately; the TV only shows *who is
   writing to whom count-wise* ("Ann has 3 admirers 👀"), never the content.
2. **Reply (30 s):** you may answer each note you got with one reply card or emoji.
3. **Pick a date (15 s):** secretly choose one player (or "stay in").
4. **Dock reveal (TV):** dates are revealed pair by pair with drumroll. Mutual pick = ❤ +2 each,
   one-sided = 💔 (the picker gets +0, the picked gets +1 "ego boost"), stayed in = −1.

**Secret agendas (hidden role per player, dealt at start; original):**
| Agenda | Effect |
|---|---|
| **Heartbreaker** | +2 for every one-sided pick *on* you; −1 for every mutual date |
| **Wallflower** | Notes you send are anonymous; +3 if you get a mutual date on the last evening |
| **Matchmaker** | Once per game, secretly "set up" two other players: if they date, you get +3 |
| **Gossip** | Sees the note *counts* for everyone; +1 per correct "who will date who" prediction |
| **Hopeless Romantic** | Mutual dates score ×2, but staying in costs −3 |
| **Player** | Can send 5 notes instead of 3; −1 per mutual date after the first with the same person |

From evening 3 the **leader's agenda is revealed** on the TV (comeback mechanic). Final evening
uses our flow multiplier (×3) so late drama matters.

**Fun/engagement hooks:** private gossip on phones, public reveals, roles that reward lying,
a "Hot Seat" TV interlude between evenings showing the most-messaged player, reactions on dates.

## Implementation plan (fits current architecture)

- `games/crush.js` extends `BaseGame`; phases `cr-mingle`, `cr-reply`, `cr-pick`, `cr-reveal`.
  State: `notes: Map<to, {from, text, reply}[]>`, `budget: Map<id, n>`, `agendas: Map<id, agenda>`,
  `picks: Map<id, id|null>`. `skippablePhases = []` (player-written); `hurry` works as-is.
- Privacy: `playerOnly(id)` returns only that player's inbox/outbox; `hostView()` returns counts.
  Add a unit test that no player view contains another player's note text.
- Live messaging needs a new socket event `player:note {to, text|cardId}` (validated: budget,
  length, no self-notes) and an immediate targeted push to the recipient (add
  `room.sendTo(playerId)` helper in server.js instead of full broadcast).
- Content: `content-src/crush-openers.txt` + `crush-replies.txt`, built by
  `tools/build-content.py` with the same 1000+/18+ rules and "boring" filter; tests in
  content.test.js.
- Client: `public/games.js` renderer — phone inbox UI (chat bubbles), TV dock reveal with
  pairs walking to each other (sprite animation on the 30 fps clock).
- Music: `game:crush` theme (lydian, 100 bpm, bossa) + `music/game/crush/` folder.
- Art: icon in `tools/make-icons.py` (two avatars on a dock under a heart-shaped moon).
- Tests: rules/scoring per agenda, budget limits, privacy, reveal order, Matchmaker once-only,
  leader-reveal from evening 3; browser test sending a note phone→phone.

**Size:** large (~1,200 lines incl. tests and 2,000 content lines). Risks: needs ≥4 players to
shine; messaging UI must stay fast on phones (morph-based updates, no full re-render).
