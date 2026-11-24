#!/usr/bin/env python3
"""
How common each English word is, for The Deep End's off-chart answers: an answer the chart doesn't
know but the room accepts dives by how rare its words are (games/rarity.js). From wordfreq (Robyn
Speer; data CC BY-SA 4.0 — see CREDITS.md), as Zipf values (log10 of uses per billion words):
    common  Zipf ≥ 4   (house, guitar, eagle …)
    known   3 ≤ Zipf < 4 (beagle, kayak, lychee …)
    anything else (not listed) is rare.
Writes games/data/wordfreq.json. Needs `pip install wordfreq` (build time only; the game never does).
    python3 tools/build-wordfreq.py
"""
import json
import math
import re
import unicodedata
from pathlib import Path

from wordfreq import get_frequency_dict  # type: ignore[import-untyped,import-not-found,unused-ignore]  # build time only

OUT = Path(__file__).resolve().parent.parent / 'games' / 'data' / 'wordfreq.json'


def plain(word: str) -> str:
    """Lower case, no accents (games/rarity.js looks words up the same way)."""
    return ''.join(c for c in unicodedata.normalize('NFD', word.lower()) if not unicodedata.combining(c))


def main() -> None:
    common: set[str] = set()
    known: set[str] = set()
    for word, freq in get_frequency_dict('en', 'large').items():
        z = math.log10(freq * 1e9)
        w = plain(word)
        if z < 3 or not re.fullmatch(r'[a-z]{2,}', w):
            continue
        (common if z >= 4 else known).add(w)
    known -= common
    OUT.write_text(json.dumps({'source': 'wordfreq 3.1 (CC BY-SA 4.0), English, Zipf', 'common': ' '.join(sorted(common)), 'known': ' '.join(sorted(known))}, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'wrote {OUT}: {len(common)} common, {len(known)} known words')


if __name__ == '__main__':
    main()
