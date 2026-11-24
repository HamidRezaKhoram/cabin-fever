#!/usr/bin/env python3
"""
Fetch extra answers for The Deep End from Wikidata (CC0, public domain): every known member of a
category (cheeses, dog breeds, capitals, elements…) with its English name, a few English aliases and
its sitelink count — how many Wikipedias have an article on it, a good measure of how well known it
is. tools/build-content.py adds them to the hand-written charts (content-src/deepend.txt) and sets
their depth from that count, calibrated on the hand-tiered answers it matches.

Writes content-src/vendor/deepend-wikidata.json (cached; rerun to refresh). Needs the internet; the
game itself never does.
    python3 tools/fetch-deepend.py                  # every category
    FETCH_MISSING=1 python3 tools/fetch-deepend.py  # only the ones a rate-limited run skipped
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'content-src' / 'vendor' / 'deepend-wikidata.json'
ENDPOINT = 'https://query.wikidata.org/sparql'
API = 'https://www.wikidata.org/w/api.php'
UA = 'Cabin Fever/1.0 (offline party game, personal use; content builder)'
# Seconds between queries: the public endpoint allows bursts normally, but only 1 a minute when it is
# struggling — a fetch that waits always finishes (FETCH_PAUSE_S=2 to go faster on a good day).
PAUSE_S = float(os.environ.get('FETCH_PAUSE_S', '62'))

# Category (exactly as in deepend.txt) → the graph pattern that finds its members, and the fewest
# Wikipedias an item needs (a floor against obscure database entries nobody could know).
# (Capitals, painters and scientists stay hand-written: Wikidata's lists of those are too noisy — see
# DD_SKIP_WIKIDATA in build-content.py.)
SOURCES: dict[str, tuple[str, int]] = {
    'Name a dog breed': ('?item wdt:P31 wd:Q39367.', 8),
    'Name a cheese': ('?item wdt:P31/wdt:P279* wd:Q10943.', 6),
    'Name a type of pasta': ('?item wdt:P279|wdt:P31 wd:Q178.', 4),
    'Name a musical instrument': ('?item wdt:P31|wdt:P279 wd:Q34379.', 12),
    'Name an element on the periodic table': ('?item wdt:P31 wd:Q11344.', 20),
    'Name a language': ('?item wdt:P31 wd:Q34770.', 60),
    'Name a dance': ('?item wdt:P31|wdt:P279 wd:Q11639.', 12),
    'Name a type of bread': ('?item wdt:P31|wdt:P279 wd:Q7802.', 8),
    'Name a soup': ('?item wdt:P31|wdt:P279 wd:Q41415.', 8),
    'Name a dessert': ('?item wdt:P31|wdt:P279 wd:Q182940.', 10),
    'Name a sauce or condiment': ('VALUES ?k { wd:Q178359 wd:Q2596997 } ?item wdt:P31|wdt:P279 ?k.', 8),
    'Name a mythical creature': ('?item wdt:P31|wdt:P279 wd:Q2239243.', 12),
    'Name a martial art': ('?item wdt:P31|wdt:P279 wd:Q11417.', 8),
    'Name a gemstone': ('?item wdt:P31|wdt:P279 wd:Q83437.', 8),
    'Name a cookie or biscuit': ('VALUES ?k { wd:Q13266 wd:Q13270 } ?item wdt:P31|wdt:P279 ?k.', 6),
    'Name a constellation': ('?item wdt:P31 wd:Q8928.', 10),
    'Name a sport': ('?item wdt:P31 wd:Q31629.', 25),
    'Name a board game': ('?item wdt:P31 wd:Q131436.', 10),
    'Name a currency': ('?item wdt:P31 wd:Q8142. FILTER NOT EXISTS { ?item wdt:P576 [] }', 15),
    'Name a god or goddess from Greek mythology': ('VALUES ?k { wd:Q22989102 wd:Q178885 } ?item wdt:P31 ?k.', 12),
    'Name a planet, moon or dwarf planet in our solar system': ('VALUES ?k { wd:Q2537 wd:Q634 wd:Q1055 } ?item wdt:P31 ?k. ?item wdt:P361|wdt:P397 ?p.', 15),
    'Name a hat': ('?item wdt:P31|wdt:P279 wd:Q80151.', 8),
    'Name a fabric': ('VALUES ?k { wd:Q28823 wd:Q1314278 } ?item wdt:P31|wdt:P279 ?k.', 10),
    'Name a type of boat': ('VALUES ?k { wd:Q35872 wd:Q11446 } ?item wdt:P279 ?k.', 10),
    'Name a famous mountain': ('?item wdt:P31 wd:Q8502.', 45),
    'Name a famous painting': ('?item wdt:P31 wd:Q3305213.', 40),
    'Name an ocean or sea': ('VALUES ?k { wd:Q165 wd:Q9430 } ?item wdt:P31 ?k.', 25),
    'Name a herb or spice': ('VALUES ?k { wd:Q42527 wd:Q207123 } ?item wdt:P31|wdt:P279 ?k.', 15),
    'Name a vegetable': ('?item wdt:P31|wdt:P279 wd:Q11004.', 15),
    'Name a fruit': ('VALUES ?k { wd:Q1364 wd:Q3314483 } ?item wdt:P31|wdt:P279 ?k.', 15),
    'Name a nut or seed you can eat': ('?item wdt:P31|wdt:P279 wd:Q11009.', 10),
    'Name a way to cook food': ('?item wdt:P31|wdt:P279 wd:Q1039303.', 10),
    'Name something you wear on your feet': ('VALUES ?k { wd:Q22676 wd:Q4925 wd:Q43663 } ?item wdt:P31|wdt:P279 ?k.', 8),
    'Name a cocktail': ('?item wdt:P31|wdt:P279 wd:Q134768.', 10),
    'Name a spirit (a strong alcoholic drink)': ('VALUES ?k { wd:Q56139 wd:Q154 } ?item wdt:P31|wdt:P279 ?k.', 12),
}


def query(pattern: str, min_sl: int) -> str:
    # (Aliases come from the API below: joining them in here made the queries time out.)
    return f"""
SELECT DISTINCT ?item ?itemLabel ?sl WHERE {{
  {pattern}
  ?item wikibase:sitelinks ?sl. FILTER(?sl >= {min_sl})
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}} ORDER BY DESC(?sl) LIMIT 400"""


def aliases(qids: list[str]) -> dict[str, list[str]]:
    """English aliases for items, 50 per request (the Wikidata API: fast, unlike the SPARQL join)."""
    out: dict[str, list[str]] = {}
    for i in range(0, len(qids), 50):
        ids = '|'.join(qids[i:i + 50])
        url = API + '?' + urllib.parse.urlencode({'action': 'wbgetentities', 'ids': ids, 'props': 'aliases', 'languages': 'en', 'format': 'json'})
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30) as r:
                data: dict[str, Any] = json.load(r)
            for qid, ent in data.get('entities', {}).items():
                out[qid] = [a['value'] for a in ent.get('aliases', {}).get('en', [])][:4]
        except Exception as e:  # noqa: BLE001 — aliases are a bonus: go on without them
            print(f'aliases: {e}', file=sys.stderr)
        time.sleep(0.3)
    return out


def run(name: str, q: str) -> list[dict[str, Any]]:
    url = ENDPOINT + '?' + urllib.parse.urlencode({'query': q, 'format': 'json'})
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data: dict[str, Any] = json.load(r)
            rows: list[dict[str, Any]] = []
            for b in data['results']['bindings']:
                qid = b['item']['value'].rsplit('/', 1)[-1]
                label = b.get('itemLabel', {}).get('value', '')
                if not label or label == qid:
                    continue
                rows.append({'qid': qid, 'label': label, 'aliases': [], 'sl': int(b['sl']['value'])})
            print(f'{name[:48]:48s} {len(rows)} items', file=sys.stderr)
            return rows
        except Exception as e:  # noqa: BLE001 — network hiccups / endpoint timeouts: retry
            print(f'{name}: {e} (retry {attempt + 1})', file=sys.stderr)
            # 429: the endpoint is rate-limiting (during outages: 1 request a minute) — wait it out.
            time.sleep(65 if '429' in str(e) else 20)
    return []


def main() -> None:
    old: dict[str, Any] = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    out: dict[str, Any] = {}
    only_missing = os.environ.get('FETCH_MISSING') == '1'  # fill in only categories with nothing yet
    for cat, (pattern, min_sl) in SOURCES.items():
        if only_missing and old.get(cat):
            out[cat] = old[cat]
            continue
        rows = run(cat, query(pattern, min_sl))
        al = aliases([r['qid'] for r in rows])
        for r in rows:
            r['aliases'] = al.get(r['qid'], [])
        out[cat] = rows or old.get(cat, [])  # a failed query keeps what was fetched last time
        time.sleep(PAUSE_S)  # be polite to the public endpoint
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf-8')
    print(f'wrote {OUT} ({sum(len(v) for v in out.values())} items)', file=sys.stderr)


if __name__ == '__main__':
    main()
