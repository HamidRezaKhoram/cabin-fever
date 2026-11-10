# Content enrichment from real sources — status: in progress

**Done:** Wikidata (CC0) facts for Closest Cast & Fish Tales with on-screen sources;
item telemetry that retires skipped items and items with no discrimination (IRT);
benign-violation filter; brutal quality cut (no OpenTDB "hard" items, no negatively
worded / all-of-the-above / long stems, OpenTriviaQA numbers dropped as too obscure).

Research used:
- Prakash et al., *Mining Interesting Trivia for Entities from Wikipedia*, IJCAI 2015 — https://arxiv.org/pdf/1510.03025
- Korn et al., *Automatically Generating Interesting Facts from Wikipedia Tables*, SIGMOD 2019 — https://research.google/pubs/automatically-generating-interesting-facts-from-wikipedia-tables/
- Item response theory (difficulty / discrimination) — https://en.wikipedia.org/wiki/Item_response_theory
- *The Impact of Item-Writing Flaws on Difficulty and Discrimination in IRT* (2025) — https://arxiv.org/html/2503.10533v3
- McGraw & Warren, *Benign Violations: Making Immoral Behavior Funny*, 2010 — https://leeds-faculty.colorado.edu/mcgrawp/pdf/mcgraw.warren.2010.pdf

# Original plan

Goal: every game's questions/prompts come from **sources** (open data, open-licensed text,
public-domain material), chosen and filtered using **research on what makes a good question**,
instead of being invented. Copyright rules: facts are free to use; copy text only from
CC0 / CC BY(-SA) / public-domain sources, with attribution in CREDITS.md; never scrape
copyrighted prompt lists from blogs or other games.

## Sources per game
| Game | Source (license) | How |
|---|---|---|
| Closest Cast | **Wikidata** (CC0) via SPARQL | numeric facts with real units: mountain heights, river lengths, city populations, founding years, record speeds, animal lifespans/weights. Template the question, keep the Wikidata item ID as provenance. |
| Fish Tales | Wikipedia **"Did you know…?"** hooks (CC BY-SA) + Wikidata | pick hooks with a short, blank-able surprising term; cite article URL per item. |
| Lakeside Quiz | Open Trivia DB (CC BY-SA, already used) + Wikidata-generated MC with plausible distractors (same class/type siblings) | |
| Campfire Consensus | **Small World of Words** free-association norms (CC BY-NC-SA) / Wikidata category members | "Name a ___" categories where the norms show a clear majority answer → ideal majority prompts. |
| Odd Duck Out | Wikidata class members (CC0) | categories with familiar members (sitelink count as a popularity proxy). |
| Cabin Superlatives / Campfire Quips / Rainy Day Cards | CAH (CC BY-NC-SA, already) + public-domain sources (e.g. old proverbs/idioms on Wikiquote CC BY-SA) | |
| Message in a Bottle | Wikidata/WordNet (WordNet license) concrete nouns × verbs | pick imageable concepts using **concreteness norms** (Brysbaert et al. 2014). |

## Research to apply (selection & filtering, not text)
- **Item difficulty / discrimination** (Item Response Theory): keep trivia that splits the room —
  aim for ~40–70% expected correct; drop items everyone or no one knows.
- **Familiarity/popularity proxies:** Wikipedia page views & sitelink counts predict how
  well-known an entity is → filter out obscure ones (fixes "Closers Online" type questions).
- **Concreteness & imageability norms** (Brysbaert, Warriner & Kuperman 2014) for drawing prompts.
- **Humour research** (incongruity–resolution, benign-violation theory — McGraw & Warren 2010)
  for choosing/grading open prompts: prompts that invite a *benign violation* score higher.
- **Free-association norms** (Small World of Words, De Deyne et al. 2019) for Campfire Consensus.
- Measure, don't guess: log per-item skip votes, answer spread and reactions (we already have
  skip votes) → auto-retire bad items over time.

## Plan
1. `tools/fetch-wikidata.py` (SPARQL, cached in content-src/vendor/, CC0) → closest/trivia/imposter.
2. `tools/fetch-dyk.py` (Wikipedia DYK archive) → fib, with per-item source URL.
3. Popularity filter (Wikimedia pageviews API, cached) in build-content.py.
4. Item-quality telemetry: `data/item-stats.json` from skip votes & answer spread; the library
   down-weights items with many skips.
5. Tests: provenance on every new item, license tag per pool, popularity threshold respected.
