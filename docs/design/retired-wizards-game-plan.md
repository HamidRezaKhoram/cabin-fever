# Campfire Wizards — a spell-duel strategy party game (research + plan)

Status: ✅ **shipped** (Nov 10 2026) — `games/wizards.js`. Playtest: worst idle 21 s (4p) / 24 s (6p). 3–12 players, ≈ 6–8 minutes. Original story, spells, names and
art. Not a voting game: everyone acts every round and the TV stages the fight.

## Research
- **Simultaneous action selection** keeps a many-player fight fast: everyone picks at once, so
  nobody waits for turns, and the reveal is a shared moment (Wikipedia on SAS; designer essays).
- **Soft counters beat pure rock-paper-scissors:** Yomi has an explicit triangle; BattleCON's
  *implicit*, uneven payoffs are found more enjoyable — guessing with unequal stakes is where the
  depth is. → spells that usually beat others, with costs and gambles, not a strict triangle.
- **Free-for-all fights need anti-dogpile and catch-up valves:** King of Tokyo lets everyone gang up
  only on the current "king", and the king can step out when hurt. → a **Bounty** on the leader
  (bonus for hitting them) and a Mirror spell that punishes focused attacks.
- **Never knock anyone out of the game** (hidden-role research): knocked-out wizards become
  **Ghosts** who still act every round and still score.

## Story
The last night at the cottage. In the attic everyone found an old wand; the lake spirits declare a
friendly wizard tournament around the campfire. Each round the fire changes mood (an arena event),
and the spirits narrate (Rocco's voice).

## Rules (3 lines on the intro card)
1. Every round, everyone secretly picks a spell and a target.
2. All spells go off together — shields first, then mirrors, bolts, heals.
3. Knocked out? You become a ghost: haunt or bless the living. Most points wins.

**Wizard:** 5 hearts, sparks (start 2, +1 per round, max 5).
| Spell | Cost | Effect |
|---|---|---|
| Firebolt | 1 | 2 damage to a target |
| Frost Shard | 2 | 1 damage, and the target's next spell costs +1 |
| Shield | 0 | Blocks all damage to you this round (not twice in a row) |
| Mirror | 1 | Attacks from the wizard you name bounce back to them |
| Mend | 1 | +2 hearts to anyone (yourself or a friend) |
| Charge | 0 | +2 sparks (but you're open) |
| Meteor | 4 | 2 damage to every other wizard |

**Ghost actions** (free): Haunt (a living wizard loses 1 spark) or Bless (+1 heart to a living one).
Ghosts earn points for each bless/haunt that lands, so they stay in.

**Arena events** (one per round, random): Full Moon (Mend heals 3), Gale (Firebolts +1 damage),
Fireflies (+1 spark for everyone), Still Night (nothing), Mist (Mirrors cost 0), Ember Rain (each
wizard takes 1 damage unless shielded).

**Scoring:** +20 per damage dealt, +20 per heart mended on someone else, +150 per knockout,
+50 bonus for hitting the Bounty (the current points leader), survival bonus at the end: last
standing +400, second +200, third +100; ghosts +15 per landed action. ×1 / ×2 / ×3 stakes by
thirds of the game. Ends when one wizard remains or after 10 rounds.

## Pacing
Pick 12 s (ends early when everyone picked), reveal 0.9 s per spell, the whole reveal capped at
≈ 8 steps (bigger fights play faster) — playtest-tuned from 15 s / 1.2 s (30 s idle at 6p). ≈ 20–25 s a
round, 8–10 rounds ≈ 5–7 min. Everyone acts every round (ghosts too) → no idle players; a payoff
(the reveal) every ~30 s.

## TV
The campfire in the middle, wizards around it in a circle (avatars + hearts + sparks); spells fly
as pixel projectiles from caster to target on the 30 fps clock (bolt, frost, meteor rain, shield
bubble, mirror flash, mend sparkles); the narrator calls the big moments.

## Tests
Spell resolution order (shield blocks, mirror reflects, frost cost, meteor hits all), sparks and
costs, no double shield, ghosts act and score, bounty, events, end conditions, privacy of picks
until the reveal, bots finish, playtest.
