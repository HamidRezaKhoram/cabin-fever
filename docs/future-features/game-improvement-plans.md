# Game improvements — status after the Nov 11 2026 real playtest

The bot run-through (Nov 10) and a real play session of every game (Nov 11) led to the changes
below. Re-run `GAMES=<id> PLAYERS=4|6|8 node test/playtest.js` after changes; bots now play every
game with **8 players** in the test suite, and every recorded TV screen must fit without scrolling.

## Shipped (Nov 11 2026)

**Stability, latency, feel (all games)**
- Same phone = same character: device id, any tab, 30-minute seat hold, "playing in another tab" screen.
- Coalesced, deduplicated state updates (≤ 1 per 30 ms per screen); acked taps ("Sending…" / "tap again").
- Browser build: heartbeats, fast wake-up reconnect, short naps resume on the same Wi-Fi link,
  JSON data channels, relay (internet) links flagged 🌐 on the TV; whole game saved for offline use
  with a progress bar.
- Docker: WebSocket-first, 5 s pings. Server-synced countdowns on every phone.
- Screen wake lock (https) / silent video (http); no zoom / selection / copy menu on phones.
- Kick from the TV lobby; clearer Leave; phone status line; TV loading card; TV screens shrink to fit.
- Haptics on every tap (Android + iPhone fallback).

**Games**
- Campfire Wizards removed (not fun).
- Lakeside Quiz: max 4 questions per franchise/title in the pool; never two on one topic per game.
- Campfire Consensus: a **herd call** — players vote which answers count as the same.
- Loon Call: 8 songs (waltz, swing triplets, 16ths…), one easy/medium/hard per game by seed;
  best-alignment judging; continuous per-phone calibration; instant on-phone PERFECT/EARLY/LATE + buzz;
  a rhythm lane on the TV.
- Storm Watch: more raccoons (1 at 4p, 2 at 5–7, 3 at 8+), the Lookout sees a pair (one is a raccoon),
  raccoon Double Trouble, and the raccoons can steal a lost game by unmasking the Lookout.
- Cottage Crush: phone redesign — step bar, people tiles, folded agenda/inbox/winks.
- Cottage Olympics: 11 minis (+ Skip Stones, Loon Spotting, Mosquito Swat, Dock Balance, Canoe Sprint,
  Campfire Sequence, Woodpile Stack); Roast has a random 2–6 s target and no clock; all seeded; 9 per game.
- Porch Confessions: new format — a prompt per round, secret TRUTH/LIE roles, everyone calls everyone.
- Lantern Lake: + Lily Pad Tag, Shrinking Pad, Duckling Herding; 4 scenes per game by seed.
- Timers: Odd Duck Out 25 s clue/vote; Fish Tales 40 s lie / 8 s reveal; Message in a Bottle 45 s draw;
  Closest Cast and Cabin Superlatives 10 questions.

## Still open
- Message in a Bottle: waiting-room scribble ticker.
- Rainy Day Cards: room-favourite pre-vote.
- Storm Watch: a private "hunch" tap during the talk phase.
- Real-play balance check of Storm Watch with the new raccoon powers (bots play randomly).
