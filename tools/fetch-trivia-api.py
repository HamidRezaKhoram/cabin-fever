#!/usr/bin/env python3
"""
Download an international trivia bank from The Trivia API (the-trivia-api.com),
licensed CC BY-NC 4.0 (HomeJack is non-commercial; credited in CREDITS.md).

Every question there is tagged with `regions` (empty = globally relevant) and
`isNiche`; tools/build-content.py keeps only global, non-niche questions.

Writes content-src/vendor/the-trivia-api.json (cached; rerun to add more):
    python3 tools/fetch-trivia-api.py [calls]
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'content-src' / 'vendor' / 'the-trivia-api.json'
URL = 'https://the-trivia-api.com/v2/questions?limit=50&difficulties={}'
UA = 'HomeJack/1.0 (offline party game, personal non-commercial use; content builder)'


def fetch(difficulty: str) -> list[dict[str, Any]]:
    req = urllib.request.Request(URL.format(difficulty), headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        data: list[dict[str, Any]] = json.load(r)
    return data


def main() -> None:
    calls = int(sys.argv[1]) if len(sys.argv) > 1 else 120
    have: dict[str, dict[str, Any]] = {}
    if OUT.exists():
        have = {q['id']: q for q in json.loads(OUT.read_text(encoding='utf-8'))}
    start = len(have)
    stale = 0
    for i in range(calls):
        diff = ('easy', 'medium', 'medium', 'hard')[i % 4]
        try:
            batch = fetch(diff)
        except urllib.error.HTTPError as e:
            print(f'call {i}: HTTP {e.code} — backing off', file=sys.stderr)
            time.sleep(30)
            continue
        new = 0
        for q in batch:
            if q.get('type') == 'text_choice' and q['id'] not in have:
                have[q['id']] = q
                new += 1
        stale = stale + 1 if new == 0 else 0
        if stale >= 8:
            break  # the bank is exhausted for us
        if i % 10 == 0:
            print(f'call {i}: {len(have)} questions', file=sys.stderr)
            OUT.write_text(json.dumps(list(have.values()), ensure_ascii=False), encoding='utf-8')
        time.sleep(1.2)
    OUT.write_text(json.dumps(list(have.values()), ensure_ascii=False), encoding='utf-8')
    print(f'wrote {OUT.relative_to(ROOT)}: {len(have)} questions (+{len(have) - start})', file=sys.stderr)


if __name__ == '__main__':
    main()
