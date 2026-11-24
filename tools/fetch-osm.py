#!/usr/bin/env python3
"""
Fetch places for The Deep End from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0): islands,
lakes, volcanoes and rivers that have an English Wikipedia article, with how many languages their name
is written in on the map (name:fr, name:ja, …) — a measure of how well known a place is, like Wikidata's
sitelinks. tools/build-content.py places them under the hand-tiered answers of content-src/deepend.txt.

Uses a public Overpass API server: a few queries, with waits between them and a longer wait whenever a
server is busy (as the servers ask). Writes content-src/vendor/deepend-osm.json (rows shaped like
deepend-wikidata.json's). Needs the internet; the game never does.
    python3 tools/fetch-osm.py
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'content-src' / 'vendor' / 'deepend-osm.json'
UA = 'Cabin Fever/1.0 (offline party game, personal use; content builder)'
SERVERS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']

# Category (exactly as in deepend.txt) → the features to ask for.
SOURCES: dict[str, str] = {
    'Name an island': 'nwr["place"="island"]["wikipedia"~"^en:"]',
    'Name a lake': 'nwr["natural"="water"]["water"="lake"]["wikipedia"~"^en:"]',
    'Name a volcano': 'node["natural"="volcano"]["wikipedia"~"^en:"]',
    'Name a river': 'relation["waterway"="river"]["wikipedia"~"^en:"]',
}
MIN_LANGS = 3  # names written in fewer languages than this: too obscure to be anyone's answer


def overpass(selector: str) -> list[dict[str, Any]]:
    q = f'[out:json][timeout:180];{selector};out tags;'
    data = urllib.parse.urlencode({'data': q}).encode()
    for attempt in range(6):
        server = SERVERS[attempt % len(SERVERS)]
        try:
            req = urllib.request.Request(server, data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=240) as r:
                return list(json.load(r).get('elements', []))
        except Exception as e:  # noqa: BLE001 — busy (429/502/504): back off, then the next server
            print(f'{server}: {e} (retry {attempt + 1})', file=sys.stderr)
            time.sleep(30 * 2 ** min(attempt, 3))
    return []


def rows(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[str, dict[str, Any]] = {}
    for el in elements:
        tags: dict[str, str] = el.get('tags', {})
        title = tags.get('wikipedia', '')[3:]
        if not title:
            continue
        langs = sum(1 for k in tags if re.fullmatch(r'name:[a-z]{2,3}', k))
        name = tags.get('name:en') or re.sub(r'\s*\([^)]*\)$', '', title)
        others = [v for v in {tags.get('name', ''), tags.get('alt_name:en', ''), re.sub(r'\s*\([^)]*\)$', '', title)} if v and v != name]
        # One row per article (a lake can be several map features).
        if langs >= MIN_LANGS and (title not in best or langs > best[title]['sl']):
            best[title] = {'qid': f'osm:{title}', 'label': name, 'aliases': others[:3], 'sl': langs, 'wiki': title}
    return sorted(best.values(), key=lambda r: -int(r['sl']))[:600]


def main() -> None:
    old: dict[str, Any] = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    out: dict[str, Any] = {}
    for cat, selector in SOURCES.items():
        got = rows(overpass(selector))
        out[cat] = got or old.get(cat, [])
        print(f'{cat:20s} {len(out[cat])} places', file=sys.stderr)
        time.sleep(20)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf-8')
    print(f'wrote {OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
