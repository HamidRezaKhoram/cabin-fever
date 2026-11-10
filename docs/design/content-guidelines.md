# Keeping the content fun — Cabin Fever content rules

Lessons from building and pruning ~15,000 prompts (Nov 2026). Content is half the game:
a great mechanic with bland prompts is a bland game.

## The rules
1. **Quality over quantity.** A few hundred great items beat thousands of bland ones (the
   owner's call). Cut ruthlessly; the build prints counts but never pads.
2. **Specific beats generic.** "Name a fruit" is dead; "Name something you'd find at the bottom
   of a cottage cooler" is alive. Prompts should invite a *particular* picture, a person in the
   room, or a story. Generic/everyday stems are filtered (`DRY_RE`, boring filters).
3. **Make it about the people in the room** wherever the game allows (Most Likely, Two
   Truths, Crush notes, Campfire Quips) — player-generated content is the funniest content.
4. **International by default.** The group is from different countries. No US-only (or any
   one country's) sports leagues, TV networks, states, chart positions or celebrities
   (`LOCAL_RE` in `tools/build-content.py` + a content test). Prefer globally known films,
   music, science, geography, food. Trivia's main bank is The Trivia API filtered to
   `regions == []` and `isNiche == false`.
5. **Fair trivia.** Item response theory: keep questions that split the room (~40–70% expected
   correct). No "hard" OpenTDB items, no negatively worded stems, no all/none-of-the-above,
   no "which of the following", stems ≤ 130 chars. Telemetry retires items a majority skipped
   and items almost everyone (> 95%) or no one (< 5%) gets right after 8+ answers.
6. **Benign violations only** (McGraw & Warren 2010). Edgy is welcome, cruelty isn't:
   `NON_BENIGN` drops abuse, tragedy and hate topics from every pool, 18+ included.
7. **18+ is a mix, not a mode.** ~30% of draws when the 🌶 toggle is on (house rules can tune
   it 0–60%), items flagged `a: true`; every pool should have both sides. Spicy items should be
   cheeky and funny, not explicit for its own sake.
8. **No repeats.** The library remembers what was played (`data/history.json`) across games
   and restarts until a pool is exhausted; then least-recently-used first.
9. **Sources and licences.** Only original text or open licences (CC0, CC BY, CC BY-SA, and
   CC BY-NC(-SA) because Cabin Fever is non-commercial). Record the source in `CREDITS.md` and
   on the item (`src`), show it on screen. Never copy prompt lists from other games or blogs.
10. **Fact-check what you write.** Only stable facts (no "current" records or rankings that
    change yearly); distractors must be clearly wrong (e.g. don't offer Herculaneum next to
    Pompeii).
11. **Write per language, don't machine-translate.** The French pack is written in French
    for French speakers (cottage-weekend flavour), not translated line by line.
12. **Let the room curate.** `/admin` lets the owner disable prompts, add house prompts and ban
    words; skip votes retire bad items automatically.

## Writing checklist for a new prompt
- Would it make *this* group laugh, argue or reveal something? If it's merely "fine", cut it.
- Can someone answer in 10 seconds without Googling? (Trivia: can 40–70% get it?)
- Does it need local knowledge? → rewrite or drop.
- Is it a benign violation? Would anyone at the table feel bad? → drop.
- Is it original or open-licensed, with the source recorded?
- Run `python3 tools/build-content.py` and the content tests.

## Where things live
- Hand-written sources: `content-src/*.txt` (English), `content-src/fr/*.txt` (French).
- Downloads: `content-src/vendor/` (OpenTDB, The Trivia API, CAH official packs, Wikidata).
- Built pools: `games/data/pools/*.json` (generated — don't edit).
- Filters: `tools/build-content.py` (`DRY_RE`, `FLAWED`, `NON_BENIGN`, `LOCAL_RE`, `FAMOUS_GAMES`).
- Runtime curation: `/admin` (house rules), `data/item-stats.json` (telemetry).
