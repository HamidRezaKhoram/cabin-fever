# Storm Watch — a hidden-role strategy game for the cottage (research + plan)

Status: ✅ **shipped** (Nov 10 2026) — `games/storm.js`. 4–12 players, 10–15 minutes, random secret roles.
Original story, names, roles, events and art; the mission-vote structure is a genre staple.

## Research
- **Information asymmetry is the engine** (Secret Hitler designer's write-up): the fun is a
  majority with little information vs. a hidden minority with a lot. The best special roles
  *change who knows what* (a seer-type role), not who has more power.
- **Replayability comes from randomness:** random roles and setups, and decks that change each
  game (Secret Hitler's policy deck; One Night Werewolf's random role mix). Fixed content goes
  stale (Spyfall's location list). → random roles from a pool + an **event deck** that bends each
  round's rules, so no two games play the same.
- **No player elimination:** eliminated players disengage (Werewolf/Mafia); The Resistance and
  Secret Hitler keep everyone in to the end. → nobody is ever out.
- **Structure beats shouting:** unstructured talk lets the loudest player dominate; alternating
  *discussion* and *secret simultaneous action* phases give every vote weight. → secret phone
  votes, revealed together on the TV.
- **Short and tense:** Coup shows a 10–15 minute hidden-role game can carry real tension.

## Story
A storm is rolling in over the lake. The cottage needs five chores done before it hits — but some
of the "guests" are **raccoons in disguise** who'd love the place to fall apart (more garbage for
them). Each chore is a little scene (stack the woodpile, pull in the canoes, fix the generator…),
and the event deck adds weather and mischief, so the story is told differently every game.

## Rules (3 lines on the intro card)
1. Secret roles: most of you are Cottagers — a few are Raccoons.
2. The chore leader picks a crew; everyone votes yes/no; the crew secretly helps — or sabotages.
3. Three chores done: Cottagers win. Three ruined (or three crews voted down): Raccoons win.

**Raccoons:** 1 (4–5 players), 2 (6–8), 3 (9–12). Raccoons know each other.

**Roles** (dealt at random from the pool for the player count):
| Role | Side | Power |
|---|---|---|
| Cottager | Cottagers | — |
| Lookout | Cottagers | Sees one raccoon at the start (not which one is Sly). |
| Handyman | Cottagers (5+) | Once per game, on a crew: "Fix it" cancels one sabotage. |
| Snoop | Cottagers (6+) | Once per game, after a chore: learns one crew member's card. |
| Raccoon | Raccoons | Knows the other raccoons; may Help or Sabotage. |
| Sly Raccoon | Raccoons (6+) | Hidden from the Lookout. |

**A chore:** the leader (rotates) gets a crew size and an **event**; the room talks; the leader picks
the crew on their phone; everyone votes ✔/✘ secretly; all votes flip on the TV at once. Majority
✔ → the crew plays Help/Sabotage secretly; the cards are shuffled and flipped one by one on the TV
(drumroll). Majority ✘ → the storm meter rises; 3 rejections in a row and the storm wins it for the
raccoons; the leader passes on.

**Events (one per chore, from a shuffled deck of 10):** Big Chore (needs 2 sabotages to fail),
Thunder (crew +1), Power Outage (votes are only shown as totals), Bonfire (the leader secretly
sees one crew card), Bear Sighting (nobody from the last crew), Lucky Loon (a done chore gives the
crew +100), Leaky Canoe (a ruined chore also raises the storm meter), Calm Evening (nothing
special), Second Wind (a voted-down crew doesn't raise the storm meter), Cold Snap (a third less
time to talk).

**End:** the side that wins gets +500 each. Then the **Big Reveal** — everyone accuses one player
on their phone; correct accusations of a raccoon +100; each raccoon nobody accused +200. All roles
flip on the TV.

## Look and feel (the user asked for a whole different screen)
- Selecting it plays a **storm transition**: the TV darkens, rain sweeps across, a lightning flash
  and thunder, then the title card.
- The TV switches to its own layout (`body.mode-storm`): a wooden cottage-window frame, rain on a
  30 fps canvas, a chore track of five cards (✔/✘), the storm meter, the leader's lantern.
- Phones: a role card you **press and hold** to peek (so neighbours can't see), then big
  vote/crew buttons.
- **No joining mid-game** (the server already refuses joins while any game is running; the TV
  shows "Storm Watch is on — wait for the next game").

## Pacing
Talk timer 60 s (40 s on Cold Snap), votes 20 s, crew 20 s, reveals ~8 s → ≈ 2 min per chore,
5 chores max ≈ 10–12 min plus the Big Reveal. Waiting players always have something: everyone
votes on every crew, everyone accuses at the end, the talk phase is the room arguing.

## Tests
Role dealing per player count, raccoons know each other, Lookout sees exactly one non-Sly raccoon,
cottagers can't sabotage, events change the rules, Handyman/Snoop once-only, three rejections →
raccoons, win/lose scoring + accusations, privacy (no phone or TV state leaks roles/cards), bots
finish the game, browser: the storm transition and the mode class.
