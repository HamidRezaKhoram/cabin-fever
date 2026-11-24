#!/usr/bin/env python3
"""
Fetch animals for The Deep End from GBIF, the Global Biodiversity Information Facility (species names
from the GBIF Backbone Taxonomy, CC BY 4.0; occurrence counts are facts): the most-recorded species of a
group worldwide, with their English names, and how many times each has been recorded — a measure of
how familiar it is. tools/build-content.py places them under the hand-tiered answers of
content-src/deepend.txt, calibrated like the Wikidata answers.

Writes content-src/vendor/deepend-gbif.json (rows shaped like deepend-wikidata.json's: label, aliases,
and the count as `sl`). Needs the internet; the game never does.
    python3 tools/fetch-gbif.py
"""
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'content-src' / 'vendor' / 'deepend-gbif.json'
API = 'https://api.gbif.org/v1'
UA = 'Cabin Fever/1.0 (offline party game, personal use; content builder)'

# Category (exactly as in deepend.txt) → GBIF taxon key of the group.
SOURCES: dict[str, int] = {
    'Name a bird': 212,                       # Aves
    'Name an insect or creepy-crawly': 216,   # Insecta
}
TOP = 400


def get(url: str) -> Any:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 — retry a hiccup
            print(f'{url[:80]}: {e} (retry {attempt + 1})', file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    return None


def english(key: str) -> list[str]:
    data = get(f'{API}/species/{key}/vernacularNames?limit=100') or {}
    names: list[str] = []
    for v in data.get('results', []):
        n = str(v.get('vernacularName', '')).strip()
        if v.get('language') == 'eng' and n and n.lower() not in [x.lower() for x in names]:
            names.append(n)
    return names[:4]


def main() -> None:
    old: dict[str, Any] = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    out: dict[str, Any] = {}
    for cat, taxon in SOURCES.items():
        facets = (get(f'{API}/occurrence/search?taxonKey={taxon}&limit=0&facet=speciesKey&facetLimit={TOP}') or {}).get('facets', [])
        counts = facets[0]['counts'] if facets else []
        rows: list[dict[str, Any]] = []
        for c in counts:
            names = english(c['name'])
            if names:
                rows.append({'qid': f"gbif:{c['name']}", 'label': names[0], 'aliases': names[1:], 'sl': int(c['count'])})
            time.sleep(0.25)
        out[cat] = rows or old.get(cat, [])
        print(f'{cat:36s} {len(out[cat])} species', file=sys.stderr)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf-8')
    print(f'wrote {OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
