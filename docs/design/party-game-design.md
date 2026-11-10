# What makes a good party game — Cabin Fever design rules

Distilled from the research and playtests done while building Cabin Fever (Nov 2026). Use this
as the checklist for every new game and every change to an existing one. The numbers come
from our bot playtests (`test/playtest.js`) — re-measure after a change, don't guess.

## 1. The core loop: private phone, public TV
- **Phones hold private information and decisions** (your answer, your lie, your secret word,
  your note to a crush). **The TV holds the shared moment** (prompt, reveal, scoreboard).
  Every screen should be obviously one or the other.
- **The reveal is the product.** Players don't remember scoring rules; they remember the
  moment the room saw the answers. Every round needs a reveal that is *staged*: one item at a
  time, a short build-up (drumroll, wipe, suspense order), then the payoff.
- **Players are the content.** The funniest material is what the people in the room write,
  draw or reveal about each other. Built-in prompts exist to *provoke* player content, not to
  replace it (Campfire Quips, Fish Tales, Porch Confessions, Telephone, Cottage Crush).

## 2. Pacing (measured, enforced by the playtest)
| Metric | Target | Why |
|---|---|---|
| Worst idle stretch per player | **≤ 25 s** for tap games, **≤ 45 s** for writing/drawing games | Dead air is where party games die; phones come out. |
| Decisions per player per minute | **≥ 3** | Agency keeps everyone in the game, not just the active player. |
| A reveal / payoff | **every ~40 s** | Laughter needs a regular beat. |
| One game | **3–8 minutes** | Long enough for an arc, short enough to rotate games. |

How we hit them (patterns that worked in the playtests):
- **Give waiting players something to do**: likes on lies (Fish Tales), side bets for the
  authors (Campfire Quips), match bets (Campfire Consensus), favourite-step votes (Telephone), the czar
  picks the next prompt (Rainy Day Cards), a suspicion meter to watch (Odd Duck Out).
- **Shorten timers to the playtested median**, not the worst case; let the room speed up the
  stragglers with **pace votes** (hurry / ready / skip) instead of long fixed timers.
- **End phases early** the moment everyone has acted; add a short grace window for optional
  second actions (e.g. Majority's 8 s bet window) instead of waiting for the full timer.
- **Name who you're waiting for** on the TV ("Still drawing: Ann, Ben") — social pressure is
  gentler and faster than a countdown.
- **Split big groups** so chains/rounds don't grow with player count (Telephone at 6+).

## 3. Stakes and comebacks
- **Escalating stakes** (round 1 ×1, round 2 ×2, final ×3 — `games/flow.js`) keep the end
  exciting and make early leads beatable. Show the stage on the TV (title cards, badges).
- **Comeback mechanics**: last place picks the category (Trivia), the leader's secret agenda
  is exposed (Cottage Crush), wagers/Double Down let trailing players swing.
- **Wagers feel great when they are optional, once-per-game and visible** (Double Down in
  Trivia/Closest, bets in Majority/Campfire Quips). Losses never take a score below zero — a party
  game should never make someone feel *worse* than when they arrived.
- **Ties share the better placing**; awards at the end (funniest, best liar, …) reward more
  than just the winner.

## 4. Social safety and fun
- **Benign violation** (McGraw & Warren 2010): humour needs a violation that still feels safe.
  Teasing a friend about being late = benign; real trauma = not. The content filters drop
  non-benign topics in every mode, including 18+.
- **Low floor, high ceiling**: anyone can play in 10 seconds (one rule line on the intro
  card), but clever players can shine (bluffing, wagers, agendas).
- **Majority-vote pace controls** (skip question, hurry, next) give the room control without a
  "host" having to police people.
- **No one is eliminated** for long; anyone who left is skipped gracefully; late joiners can
  jump in between games.
- **Original everything**: mechanics are genre-standard and shared; names, text, art and look
  are ours (CLAUDE.md rules 4–5).

## 5. The TV is a stage (10-foot UI)
- Big type (≥ 3.2vh body), few elements, prompt grown to fill its box (`Rumpus.fit`).
- One join card with a big QR + room code (title screen and lobby), nothing duplicated.
- Every phase change has a transition (pixel wipe) and a sound; reveals have a stinger;
  the narrator (Rocco) reads prompts and announces winners; music follows the moment.
- 30 fps everywhere, no re-rendering of what's already on screen (`Rumpus.morph`).

## 6. Checklist for a new game
1. Write the one-line pitch and the 3 rule lines for the intro card.
2. Draw the loop: what does every player *do* each minute? Where is the reveal?
3. Decide the waiting-player action for every phase where someone waits.
4. Stakes: rounds × stage multiplier; a comeback; an optional wager if it fits.
5. Content: does it need a pool? Follow `content-guidelines.md`.
6. Implement + teach `games/bot-brain.js` its screens; add renderer, icon, scene, colours,
   music style, rules, French lines (the static tests list every registry).
7. **Playtest with bots** (`GAMES=<id> PLAYERS=4 node test/playtest.js`, then 6) and compare
   against the table in §2. Iterate on timers and waiting actions until it meets the targets.
8. Play it for real with `/host?bots=1` + a phone, then with friends.

## Latest playtest (bots, human-like timing; real-time equivalents)
4 players unless noted. After the fixes in this round:

| Game | Min | Actions/min | Worst idle | Verdict |
|---|---|---|---|---|
| Campfire Quips | 3.4 | 3.3 | 39 s | ✅ good (writing game; side bets keep authors busy) |
| Fish Tales | 3.5 | 3.3 | 41 s | ✅ good (likes fill the wait) |
| Lakeside Quiz | 2.5 | 4.3 | 19 s | ✅ meets every target |
| Closest Cast | 1.3 | 4.5 | 16 s | ✅ meets every target |
| Campfire Consensus | 3.8 | 2.9 | 49 s | ◐ ok — write-time variance; bets add a decision |
| Cabin Superlatives | 1.3 | 4.7 | 17 s | ✅ meets every target |
| Odd Duck Out | 2.5 | 2.6 | 39 s | ◐ ok — suspicion meter makes the wait watchable |
| Porch Confessions | 1.2 | 3.3 | 30 s | ✅ good (was 58 s) |
| Message in a Bottle | 3.9 | 2.3 | 61 s | ◐ drawing takes time by nature; favourites + who's-left row help |
| Rainy Day Cards | 3.0 | 3.1 | 32 s | ✅ good (czar picks the next prompt) |
| Cottage Olympics | 1.5 | 36 | 17 s | ✅ meets every target (the old 53–78 s was a playtest bug: Quick Draw's wait wasn't scaled); results 4.5 s, firefly guesses lock in early |
| Campfire Wizards (spell duel) | 2.4–3.6 bots (≈5–7 real) | 3–4 | 21 s (4p) · 24 s (6p) · 32 s (8p) | ✅ everyone casts every round; reveal capped at ~8 steps |
| Storm Watch (strategy) | 2–3 with bots (≈10–12 with real talk) | 4 | 31–35 s | ✅ the 'idle' is the 60 s talk phase — people argue there; everyone votes every crew |
| Lantern Lake (tilt) | 2.5 | continuous | 10 s | ✅ always steering; short on purpose (arms tire) |
| Loon Call (rhythm) | 3.0 | 27 | 22 s | ✅ meets every target (the caller echoes too — was 33 s) |
| Cottage Crush | 6.2 | 6.0 | 34 s (42 s at 6p) | ✅ winks + Matchmaker/Gossip side actions fill the wait (was 53/73 s) |

Next ideas if a game still feels slow: Majority — show live "answers in" avatars; Telephone —
a 45 s draw timer option in house rules; Minigames — 8 minis by default (1.5 min is short).

The playtest prints `worstIdleAt` ("screen where that player last acted → where they next
could"), so fix the screen it names instead of guessing.

## 7. Art direction: cosy and retro (research, Nov 2026)
Sources: cosy-game art analyses (Stardew-style warm light), lighting guides (warm key light vs cool
shadow), pixel-art tutorials (hue shifting, limited palettes, dithering used sparingly), and the
"Juice it or lose it" game-feel talk (short shakes, squash/stretch, particles).
- **Warm light inside, cool night outside.** Every scene has a lit cottage (log walls, framed warm
  windows, a light seam at the door, a porch lantern) whose light spills onto the shore, plus a
  small campfire with a round dithered glow and its reflection.
- **Hue-shift, don't just darken.** Moonlit rims on hills and pines are mixed toward the moon's
  colour (`mix()` in bg.js); roof shadows lean purple.
- **Dither only gradients and glows** (sky band edges, light spill) — never flat areas.
- **Juice with restraint:** a 0.3 s screen shake (`fx.shake`) only on big hits (a knockout, a
  ruined chore), confetti on wins; games opt in with a `moment(state)` hook. Respects
  prefers-reduced-motion.
