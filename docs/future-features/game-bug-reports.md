# Game bug reports (Nov 11 2026)

One read-only review per game. Only HIGH-severity bugs were fixed (owner's call); everything else is
listed here to decide on. Severity is the reviewer's; line numbers are as of Nov 11 2026.

**Nov 13 2026: every MEDIUM and LOW below is fixed** (owner: "work on all of the bugs"), each checked in
`test/unit/bug-reports.test.js` (all of them fail on the old code). Two judgement calls:
- Fish Tales "liking the truth pays nothing": kept the 👍 on the truth — hiding it would tell the player
  which one is true before the reveal. The phone now says likes pay "if it's a lie".
- Closest Cast Double Down: it now pays only in the top half (rank < ⌊n/2⌋, at least 1st place), so
  it's a real risk with 2–3 players; the phone text says so.
Other choices worth knowing: Most Likely needs 2+ votes on a name to score (an even split scores
nobody); Fish Tales probing the truth costs your truth points that round; Porch Confessions replays a
round with fewer than 2 confessions once (and says so); Campfire Consensus merges nothing on a herd-vote
tie; Storm Watch tells nobody (phones, board, narrator) a chore's fate until the cards have flipped;
Loon Call's tune-up waits for the title card and plays no jingle or narrator over its clicks;
"End this round" in Cottage Olympics ends the minigame and keeps Dock Balance / Woodpile Stack progress;
standings share placings on ties (podium, phone, narrator).

## Cabin Superlatives (games/mostlikely.js) — no high
- MEDIUM: phone always says "+100" (public/games.js:411); server awards 100×stakes (×2/×3 later). Send real gain in `you`.
- LOW: an even split (1/1/1) scores every voter; self-votes allowed → all pick themselves = points every round (mostlikely.js:96). Award only when max ≥ 2.
- LOW: a disconnected voter's vote is wiped when their target leaves (mostlikely.js:122); timer still ends the round.
- LOW: TV highlights winners by nickname, not id (games.js:397) — latent.

## Closest Cast (games/closest.js) — no high
- MEDIUM: a skipped question still uses up your one Double Down (closest.js:92; `doubled` not undone on skipq).
- MEDIUM: a lost Double Down shows "+-200" on TV and phone (public/games.js:498, :516).
- MEDIUM: Double Down is risk-free with 2–3 players (every guess "places"; ranks 0–2 score), contradicting "−200 if not".
- LOW: guesses of players who left still take podium places (closest.js:99) → present players pushed down, can lose a Double Down to a ghost.
- LOW (plausible): equal-distance guesses may not tie because of float maths; round the distance.

## Cottage Crush (games/crush.js) — no high
- **(fixed)** MEDIUM (privacy wording): the phone tells senders "they won't know who sent it until they reply", but the recipient sees the sender's name at once (only Wallflowers are anonymous) — games.js:721 vs crush.js:267. Fix the hint, or make notes anonymous (design change).
- MEDIUM: the result screen can show the wrong outcome — `pairs.find` returns the first pair with you, so someone's one-sided pick can hide your own mutual date (crush.js:269).
- LOW–MED: if the last pending player leaves during Mingle/Reply, the room waits out the timer (onPlayerLeft only re-checks Pick).
- LOW: reveal timer too short when there are 3+ bonus lines (crush.js:220).
- LOW: replies aren't checked against the offered cards/emoji.
- LOW: the TV bonus line shows the bonus, not the net (zero-clamped) change.

## Lantern Lake (games/lantern.js) — no high
- MEDIUM: boats of players who left/were kicked stay in the simulation, invisible on the TV, still steering on their last tilt — eat fireflies, take "it" in Tag, knock people off in Sumo (onPlayerLeft is empty, lantern.js:429).
- MEDIUM: a phone that drops/locks keeps steering forever with its last tilt (and in Raft Run keeps pulling the raft and earning paddle points). Expire tilts older than ~1 s or from disconnected players.
- LOW: 2-player Shrinking Pad — if one player is removed the other wins at once (lantern.js:329).
- LOW: ties aren't shared on the result screen (only row 0 highlighted/announced).
- LOW (plausible, visual): the raft can be pushed past the shore for one frame by a rock.

## Trivia (games/trivia.js) — no high
- MEDIUM: a skipped question still uses up your one Double Down (trivia.js:228; `doubled` not undone in skipQuestion).
- LOW: a disconnected (asleep) player can be picked as category chooser → everyone waits out the 12 s pick.
- LOW: a player who didn't answer (timed out or joined late) is told "Nope ✗" (play.js:418).
- LOW (plausible): the category banner can name the chosen category above a fallback question from another category.
- LOW (shared, all games): tied players get different placings on the podium/phone (standings() has no shared place) — contradicts "ties share the better placing".
- LOW: stale header comment ("final question worth double") and an unused isFinal().

## Fish Tales (games/fibbage.js) — no high
- **(fixed)** MEDIUM: with only one lie in play (2 players, or someone times out), the author's phone shows just the truth → a guaranteed 1000×stakes; if nobody lies, everyone scores. Add house decoy lies.
- MEDIUM-LOW: unlimited free tries at finding the truth — a lie matching the truth is rejected with a hint, so players can probe ("Audi? Toyota?…").
- LOW: a liar loses the points they earned if the fooled player leaves before the reveal.
- LOW: no 1.2 s submit grace like BaseGame, and the reveal pause is scaled by timer speed (16 s+ on slow settings).
- LOW: liking the truth is accepted but pays nothing; phone/bot offer it.

## Campfire Quips (games/quiplash.js) — no high
- **(fixed)** MEDIUM: side-bet wins are multiplied (×2/×3) but losses aren't, and the buttons show ×1 amounts → late bets are nearly free (quiplash.js:181).
- LOW: a lost bet shows "+-50" / "lost -50".
- LOW: the TV's "SHUTOUT! +250" ignores the multiplier.
- LOW: a forfeit (missing answer) counts as a real shutout with real votes (bonus, stat, highlight).
- LOW (plausible): the `stage` field (music) doesn't match Quips' own multiplier.
- LOW: rules promise a shutout that 3-player games can never get (needs 2+ voters).

## Porch Confessions (games/twotruths.js) — no high
- MEDIUM-LOW: a round with fewer than 2 confessions is silently thrown away — final round included (twotruths.js:101).
- LOW: answers/calls of players who left still count on the TV ("3 / 2 in") and show "(left) +100".
- LOW: "Lie instead" can make everyone a liar (switchToLie has no limit), against the code's own rule.

## Rainy Day Cards (games/cah.js) — no high
- MEDIUM: if everyone but the Czar leaves, the Czar sits on an empty judging screen for ~70 s.
- MEDIUM: a departed player's card stays in the reveal and can still win or take the favourite (points go to nobody); their own favourite vote still counts.
- LOW: the Czar leaving throws away played cards (hands drop to 6), can cut the reveal short, shows "prompt chosen by ???".
- LOW: the "favourites in" counter counts cards, not eligible voters (new code).
- LOW: a player can be skipped as Czar after someone leaves.
- LOW: Skip question keeps the old "prompt chosen by X" label.
- LOW: phones never show the room-favourite result (new code; only the TV does).

## Message in a Bottle (games/telephone.js + morph) — no high
- (fixed, new code from today) old doodles replayed every step; keyed morph moved every survivor (restarting drift); double-tap sent a doodle twice.
- LOW: duplicate data-key / unkeyed-before-keyed edge cases in morph (not reachable today).

## Odd Duck Out (games/imposter.js) — no high
- **(fixed)** MEDIUM: the game keeps going below 3 players; a lone player is always the imposter, can't be voted, and gets 300×stakes every round.
- LOW-MED: TV/phones say "+300"/"+200" whatever the stakes (games.js:596).
- LOW: a leaver's own vote/clue still counts; TV can show "3/3 votes in" while someone hasn't voted.
- LOW: when the imposter leaves, the rebuilt round looks like the same screen (no skipSeq bump) → an old typed clue can be sent for the new word; half-done pace votes carry over.
- LOW (plausible): the built-in fallback word list always uses the first word as the secret.

## Cottage Olympics (games/minigames.js) — 1 HIGH (fixed)
- HIGH (fixed): Campfire Sequence colour buttons did nothing on real phones — the "watch" → "go" switch patched the screen without re-binding, so no listeners. Now listens on the screen container.
- MEDIUM: "End this round" / TV Skip during Dock Balance or Woodpile Stack wipes everyone's result (phones only send near the end).
- LOW-MED: teams mode gives everyone 100×stakes when nobody has a valid result (solo gives 0).
- LOW: Skip Stones waits out the timer after a player leaves.
- LOW: "End this round" during a watch/wait step only advances the step; pace key doesn't include the sub-step.
- Test gap: the UI test accepts NOBODY as a simon result, which is how the HIGH bug slipped through.

## Loon Call (games/looncall.js) — 1 HIGH (fixed)
- HIGH (fixed): Skip / "end the round" mid-song left the whole song playing (it's booked on the audio clock up front) — under the result and into the next round's count-in. Rhythm sounds now go through stoppable gains.
- MEDIUM: wrap/Skip marks unplayed bars as all-miss → everyone "Off the beat" (points unaffected).
- MEDIUM: narrator, intro card and jingle play over the tune-up's calibration clicks (breaks "never talk over a rhythm song").
- LOW (plausible): a result-screen line can run into the next song's count-in.
- LOW: a disconnected or kicked player can be picked as caller.
- LOW: Your Call ignores 3/4 metre.

## Campfire Consensus (games/majority.js) — no high
- MEDIUM: with no majority, every tied answer merges into one herd → everyone voting only for their own answer all "match" (400 each).
- LOW-MED: normalize splits -se/-oe plurals (shoes→"sho" vs shoe).
- LOW: a leave doesn't start the short bet window → waits out 30 s.
- LOW: "hurry" is offered during the 8 s bet window but does nothing.
- LOW: players who left still get "(left) +300" rows.
- LOW: rules text "loners get nothing / match the herd" undersells (any pair scores).

## Storm Watch (games/storm.js) — no high
- MEDIUM: the reveal is spoiled before the cards flip (narrator says done/ruined at once; phones get reveal.ok).
- MEDIUM: Big Chore says "two sabotages" but crews of 2 need only one (4-player games).
- LOW-MED: the leader's phone can get stuck with a departed player in its pick.
- LOW: raccoons' accusations cancel their own allies' UNSEEN bonus.
- LOW: Bonfire can show the leader their own card and overwrites the Snoop's result.
- LOW: the Lookout's sighting becomes a certainty if the decoy leaves.
- LOW (plausible): the unmask "majority" counts a tie / only raccoons who answered.
- LOW: crafted payloads ({toString:1}) can trigger the glitch banner.
- LOW (fixed, new code): a rejected hunch left the phone's buttons disabled.
- LOW: Lucky Loon points are missing from the end screen's +gained.
