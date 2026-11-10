#!/usr/bin/env python3
"""
Fetch real facts from Wikidata (CC0 — public domain) for Closest Cast and
Fish Tales. Popularity is enforced with sitelink counts (how many Wikipedias
have an article), so questions are about things people have heard of.

Writes content-src/vendor/wikidata.json (cached; rerun to refresh).
    python3 tools/fetch-wikidata.py
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'content-src' / 'vendor' / 'wikidata.json'
ENDPOINT = 'https://query.wikidata.org/sparql'
UA = 'Cabin Fever/1.0 (offline party game, personal use; content builder)'

QUERIES: dict[str, str] = {
    # Closest Cast -------------------------------------------------------
    'mountain_height': """
SELECT ?item ?itemLabel ?v WHERE { ?item wdt:P31 wd:Q8502; wdt:P2044 ?v; wikibase:sitelinks ?sl. FILTER(?sl >= 35)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?sl) LIMIT 220""",
    'river_length': """
SELECT ?item ?itemLabel ?v WHERE { ?item wdt:P31 wd:Q4022; wdt:P2043 ?v; wikibase:sitelinks ?sl. FILTER(?sl >= 50)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?sl) LIMIT 180""",
    'building_height': """
SELECT ?item ?itemLabel ?v WHERE { ?item wdt:P31/wdt:P279* wd:Q11303; wdt:P2048 ?v; wikibase:sitelinks ?sl. FILTER(?sl >= 25)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?sl) LIMIT 160""",
    'film_year': """
SELECT ?item ?itemLabel (MIN(YEAR(?d)) AS ?v) WHERE { ?item wdt:P31 wd:Q11424; wdt:P577 ?d; wikibase:sitelinks ?sl. FILTER(?sl >= 70)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } GROUP BY ?item ?itemLabel ORDER BY DESC(MAX(?sl)) LIMIT 400""",
    'person_birth_year': """
SELECT ?item ?itemLabel (MIN(YEAR(?d)) AS ?v) WHERE { ?item wdt:P31 wd:Q5; wdt:P569 ?d; wikibase:sitelinks ?sl. FILTER(?sl >= 170)
  ?item wdt:P570 [] . FILTER NOT EXISTS { ?item wdt:P570 [] }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } GROUP BY ?item ?itemLabel LIMIT 1""",
    # Cheap form: famous living people via a high sitelink cut, no GROUP BY / ORDER BY (the
    # sorted version times out on the public endpoint).
    'living_birth_year': """
SELECT ?item ?itemLabel ?v WHERE { ?item wikibase:sitelinks ?sl. FILTER(?sl >= 150) ?item wdt:P31 wd:Q5; wdt:P569 ?d.
  FILTER NOT EXISTS { ?item wdt:P570 [] } BIND(YEAR(?d) AS ?v) FILTER(?v >= 1930)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 600""",
    'city_population': """
SELECT ?item ?itemLabel (MAX(?p) AS ?v) WHERE { ?item wdt:P31/wdt:P279* wd:Q515; wdt:P1082 ?p; wikibase:sitelinks ?sl. FILTER(?sl >= 150)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } GROUP BY ?item ?itemLabel ORDER BY DESC(MAX(?sl)) LIMIT 200""",
    # Fish Tales ------------------------------------------------------------
    'birth_name': """
SELECT ?item ?itemLabel ?v WHERE { ?item wdt:P31 wd:Q5; wdt:P1477 ?v; wikibase:sitelinks ?sl. FILTER(?sl >= 60) FILTER(LANG(?v) = "en" || LANG(?v) = "")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?sl) LIMIT 900""",
    'city_nickname': """
SELECT ?item ?itemLabel ?v WHERE { ?item wdt:P31/wdt:P279* wd:Q515; wdt:P1449 ?v; wikibase:sitelinks ?sl. FILTER(?sl >= 60) FILTER(LANG(?v) = "en")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY DESC(?sl) LIMIT 500""",
}
QUERIES.pop('person_birth_year')  # superseded by living_birth_year (cheaper query)


def run(name: str, q: str) -> list[dict[str, Any]]:
    url = ENDPOINT + '?' + urllib.parse.urlencode({'query': q, 'format': 'json'})
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data: dict[str, Any] = json.load(r)
            rows = []
            for b in data['results']['bindings']:
                qid = b['item']['value'].rsplit('/', 1)[-1]
                label = b.get('itemLabel', {}).get('value', '')
                if not label or label == qid:
                    continue
                rows.append({'qid': qid, 'label': label, 'v': b['v']['value']})
            print(f'{name:18s} {len(rows)} rows', file=sys.stderr)
            return rows
        except Exception as e:  # noqa: BLE001 — network hiccups: retry
            print(f'{name}: {e} (retry {attempt + 1})', file=sys.stderr)
            time.sleep(65)
    return []


def main() -> None:
    # Keep earlier successful results; the public endpoint may rate-limit hard
    # (1 request/minute during outages), so space requests out and only refetch gaps.
    out: dict[str, list[dict[str, Any]]] = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    for name, q in QUERIES.items():
        if out.get(name):
            continue
        out[name] = run(name, q)
        OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding='utf-8')
        time.sleep(65)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding='utf-8')
    print('wrote', OUT.relative_to(ROOT), sum(len(v) for v in out.values()), 'rows', file=sys.stderr)


if __name__ == '__main__':
    main()
