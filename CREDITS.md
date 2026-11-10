# Credits & licenses

Rumpus code is AGPL-3.0 (see LICENSE). Bundled content comes from:

| What | Source | License |
|---|---|---|
| Trivia questions (international bank: only questions tagged globally relevant, not niche) | [The Trivia API](https://the-trivia-api.com) by Trivia Services Ltd | CC BY-NC 4.0 |
| Trivia & Fish Tales questions (filtered: no US-only sports/TV/states, famous video games only) | [Open Trivia Database](https://opentdb.com) | CC BY-SA 4.0 |
| Closest Cast & Fish Tales facts (heights, lengths, years, populations, birth names, city nicknames) | [Wikidata](https://www.wikidata.org) — item ID shown on screen with each question | CC0 (public domain) |
| Rainy Day Cards cards + some Campfire Quips prompts | [Cards Against Humanity](https://cardsagainsthumanity.com) official packs, via [json-against-humanity](https://github.com/crhallberg/json-against-humanity) | CC BY-NC-SA 4.0 — **non-commercial use only** |
| Music in `music/` (52 tracks) | OpenGameArt.org "CC0 - Retro Music" collection — artists listed in `music/CREDITS.md` | CC0 (public domain) |
| Fonts: Press Start 2P, VT323 | Google Fonts | SIL Open Font License 1.1 (see public/fonts) |
| Everything else — Campfire Quips/Most Likely/Majority/Odd Duck Out/Doodle prompts, 18+ bar trivia, pixel art, the 50 chiptune tracks | Original to this project | AGPL-3.0 |

Because of the CC BY-NC-SA card content, this build is for personal, non-commercial use.
Rebuild the pools with `python3 tools/build-content.py` (sources in `content-src/`).
