# Credits & licenses

Rumpus code is AGPL-3.0 (see LICENSE). Bundled content comes from:

| What | Source | License |
|---|---|---|
| Trivia questions (international bank: only questions tagged globally relevant, not niche) | [The Trivia API](https://the-trivia-api.com) by Trivia Services Ltd | CC BY-NC 4.0 |
| Trivia & Fish Tales questions (filtered: no US-only sports/TV/states, famous video games only) | [Open Trivia Database](https://opentdb.com) | CC BY-SA 4.0 |
| Closest Cast & Fish Tales facts (heights, lengths, years, populations, birth names, city nicknames) | [Wikidata](https://www.wikidata.org) — item ID shown on screen with each question | CC0 (public domain) |
| The Deep End: extra answers per category and how well known each is (number of Wikipedia language editions with an article) | [Wikidata](https://www.wikidata.org) via `tools/fetch-deepend.py` (cached in `content-src/vendor/deepend-wikidata.json`) | CC0 (public domain) |
| The Deep End: the deeper answers of the word categories (slang for money, the toilet, the police…) and how rare each is (Wiktionary's own labels: slang, archaic…) | [Wiktionary](https://en.wiktionary.org) thesaurus pages via `tools/fetch-wiktionary.py` (cached in `content-src/vendor/deepend-wiktionary.json`; offensive and slur entries dropped) | CC BY-SA 4.0 |
| The Deep End: birds and insects, and how often each is recorded | [GBIF](https://www.gbif.org) — GBIF Backbone Taxonomy names, via `tools/fetch-gbif.py` (cached in `content-src/vendor/deepend-gbif.json`) | CC BY 4.0 |
| The Deep End: islands, lakes, volcanoes, rivers (and how many languages their names are written in) | [OpenStreetMap](https://www.openstreetmap.org/copyright) © OpenStreetMap contributors, via `tools/fetch-osm.py` (cached in `content-src/vendor/deepend-osm.json`) | ODbL 1.0 — the place answers in `games/data/pools/deepend.json` are a derived database under the ODbL |
| Closest Cast: life expectancy, population, median age, CO₂, fertility, calories, internet use and meat supply by country (the year is in each question) | [Our World in Data](https://ourworldindata.org) via `tools/fetch-owid.py` (cached in `content-src/vendor/owid.json`) | CC BY 4.0 |
| Fish Tales "First lines": the opening sentences of classics (titles and first lines checked by hand in `content-src/gutenberg-ok.txt`) | [Project Gutenberg](https://www.gutenberg.org) ebooks, via `tools/fetch-gutenberg.py` from the PGLAF mirror (cached in `content-src/vendor/gutenberg.json`) | Public domain in the USA |
| Fish Tales "Curious words": real words and their meanings | [Wiktionary](https://en.wiktionary.org) Words of the Day, via `tools/fetch-wotd.py` (cached in `content-src/vendor/wotd.json`) | CC BY-SA 4.0 |
| Rainy Day Cards cards + some Campfire Quips prompts | [Cards Against Humanity](https://cardsagainsthumanity.com) official packs, via [json-against-humanity](https://github.com/crhallberg/json-against-humanity) | CC BY-NC-SA 4.0 — **non-commercial use only** |
| Music in `music/` (52 tracks) | OpenGameArt.org "CC0 - Retro Music" collection — artists listed in `music/CREDITS.md` | CC0 (public domain) |
| Narrator voice (4 voices: US/UK × female/male) | [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via [kokoro-js](https://www.npmjs.com/package/kokoro-js) + [onnxruntime-web](https://github.com/microsoft/onnxruntime) — downloaded by `tools/fetch-kokoro.js` | Apache-2.0 (model, kokoro-js); MIT (onnxruntime) |
| Browser version networking | [PeerJS](https://peerjs.com) (WebRTC); its free public broker only introduces phones to the TV | MIT |
| QR codes | [node-qrcode](https://github.com/soldair/node-qrcode) | MIT |
| Fonts: Press Start 2P, VT323 | Google Fonts | SIL Open Font License 1.1 (see public/fonts) |
| Everything else — Campfire Quips/Most Likely/Majority/Odd Duck Out/Doodle prompts, The Deep End's categories and answer charts (`content-src/deepend.txt`), 18+ bar trivia, pixel art, the 50 chiptune tracks | Original to this project | AGPL-3.0 |

Because of the CC BY-NC-SA card content, this build is for personal, non-commercial use.
Rebuild the pools with `python3 tools/build-content.py` (sources in `content-src/`).
