#!/usr/bin/env python3
"""
Fetch Wiktionary's Words of the Day (CC BY-SA 4.0) — curious real words chosen by Wiktionary's editors,
each with its definition — for a Fish Tales round: 'In English, "qualtagh" means ____.' Everyone
invents a meaning, then spots the real one. tools/build-content.py keeps the single words whose
definition is short and doesn't give the word away.

Writes content-src/vendor/wotd.json (cached; rerun to refresh). Needs the internet; the game never does.
    python3 tools/fetch-wotd.py
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
OUT = ROOT / 'content-src' / 'vendor' / 'wotd.json'
API = 'https://en.wiktionary.org/w/api.php'
UA = 'Cabin Fever/1.0 (offline party game, personal use; content builder)'
YEARS = range(2012, 2026)
MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']


def get(titles: list[str]) -> dict[str, str]:
    q = {'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main', 'titles': '|'.join(titles), 'format': 'json', 'formatversion': 2}
    url = API + '?' + urllib.parse.urlencode(q)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                pages = json.load(r).get('query', {}).get('pages', [])
            return {p['title']: p['revisions'][0]['slots']['main']['content'] for p in pages if p.get('revisions')}
        except Exception as e:  # noqa: BLE001 — refused / timed out: wait and retry
            print(f'{titles[0]}: {e} (retry {attempt + 1})', file=sys.stderr)
            time.sleep(30 * (attempt + 1))
    return {}


def plain(wikitext: str) -> str:
    """Wikitext → plain text: links keep their shown words, templates and labels go."""
    s = re.sub(r'\{\{(lb|lbl|label|q|qualifier|i)\|[^{}]*\}\}', '', wikitext)
    for _ in range(3):
        s = re.sub(r'\{\{[^{}]*\}\}', '', s)
    s = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', s)
    s = re.sub(r"'''?|<[^>]+>", '', s)
    return re.sub(r'\s+', ' ', s).strip()


def params(body: str) -> list[str]:
    """A template's parameters, split at its own "|"s (not those inside nested links and templates)."""
    out, depth, cur = [], 0, ''
    i = 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ('{{', '[['):
            depth += 1; cur += two; i += 2; continue
        if two in ('}}', ']]'):
            if depth == 0:
                break  # the end of the WOTD template
            depth -= 1; cur += two; i += 2; continue
        if body[i] == '|' and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += body[i]
        i += 1
    out.append(cur)
    return out


def parse(text: str) -> dict[str, str] | None:
    m = re.search(r'\{\{WOTD\|', text)
    if not m:
        return None
    ps = params(text[m.end():])
    # word, part of speech, then the definition: the first unnamed parameter after them ("link=…", "tl=…"
    # are named); only its first sense (a "#" starts the next).
    pos_args = [p for p in ps if not re.match(r'^\s*[a-z]+\s*=', p)]
    if len(pos_args) < 3:
        return None
    return {'word': pos_args[0].strip(), 'pos': pos_args[1].strip(), 'def': plain(pos_args[2].split('#')[0])}


def main() -> None:
    old: list[dict[str, str]] = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else []
    titles = [f'Wiktionary:Word of the day/{y}/{m} {d}' for y in YEARS for m in MONTHS for d in range(1, 32)]
    out: list[dict[str, str]] = []
    for i in range(0, len(titles), 50):
        for content in get(titles[i:i + 50]).values():
            row = parse(content)
            if row and row['def']:
                out.append(row)
        time.sleep(3)
    if len(out) < len(old):
        out = old  # a run that was refused partway keeps last time's list
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding='utf-8')
    print(f'wrote {OUT} ({len(out)} words)', file=sys.stderr)


if __name__ == '__main__':
    main()
