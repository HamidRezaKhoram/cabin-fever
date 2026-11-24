#!/usr/bin/env python3
"""
Fetch numbers for Closest Cast from Our World in Data (CC BY 4.0): a few well-known indicators, the
latest measured year (no projections) for a spread of countries from every continent.
tools/build-content.py turns them into questions that say the year ("… in Japan (2023)?"), so they stay
true as the numbers change.

Writes content-src/vendor/owid.json (cached; rerun to refresh). Needs the internet; the game never does.
    python3 tools/fetch-owid.py
"""
import csv
import io
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'content-src' / 'vendor' / 'owid.json'
UA = 'Cabin Fever/1.0 (offline party game, personal use; content builder)'

# Chart slug → the data column to read.
CHARTS: dict[str, str] = {
    'life-expectancy': 'life_expectancy_0',
    'population': 'population_historical',
    'median-age': 'median_age__sex_all__age_all__variant_estimates',
    'co-emissions-per-capita': 'emissions_total_per_capita',
    'children-per-woman-un': 'fertility_rate__sex_all__age_all__variant_estimates',
    'daily-per-capita-caloric-supply': 'daily_calories',
    'share-of-individuals-using-the-internet': 'it_net_user_zs',
    'meat-supply-per-person': '',  # (one long column name: the first data column)
}
# From every continent, all well known (an international room).
COUNTRIES = ['Japan', 'China', 'India', 'Indonesia', 'South Korea', 'Vietnam', 'Thailand', 'Philippines', 'Pakistan', 'Bangladesh',
             'Iran', 'Turkey', 'Saudi Arabia', 'Israel', 'Egypt', 'Nigeria', 'Ethiopia', 'Kenya', 'South Africa', 'Morocco',
             'Brazil', 'Mexico', 'Argentina', 'Colombia', 'Peru', 'Chile', 'Canada', 'United States', 'Cuba', 'Jamaica',
             'United Kingdom', 'France', 'Germany', 'Italy', 'Spain', 'Sweden', 'Norway', 'Poland', 'Russia', 'Greece',
             'Ukraine', 'Ireland', 'Netherlands', 'Portugal', 'Australia', 'New Zealand', 'Iceland', 'Switzerland']


def fetch(slug: str) -> str:
    url = f'https://ourworldindata.org/grapher/{slug}.csv?v=1&csvType=full&useColumnShortNames=true'
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                return str(r.read().decode('utf-8'))
        except Exception as e:  # noqa: BLE001 — retry a hiccup
            print(f'{slug}: {e} (retry {attempt + 1})', file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    return ''


def latest(text: str, column: str) -> dict[str, dict[str, Any]]:
    """Each country's latest year with a value (rows are entity, code, year, columns…)."""
    out: dict[str, dict[str, Any]] = {}
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        return out
    col = column or [k for k in rows[0] if k not in ('entity', 'code', 'year')][0]
    for r in rows:
        name, v = r.get('entity', ''), r.get(col, '')
        if name not in COUNTRIES or not v:
            continue
        try:
            year, value = int(r['year']), float(v)
        except ValueError:
            continue
        if year > 2025:
            continue  # a projection
        if name not in out or year > out[name]['year']:
            out[name] = {'year': year, 'value': value}
    return out


def main() -> None:
    old: dict[str, Any] = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    out: dict[str, Any] = {}
    for slug, column in CHARTS.items():
        got = latest(fetch(slug), column)
        out[slug] = got or old.get(slug, {})
        print(f'{slug:42s} {len(out[slug])} countries', file=sys.stderr)
        time.sleep(1)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf-8')
    print(f'wrote {OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
