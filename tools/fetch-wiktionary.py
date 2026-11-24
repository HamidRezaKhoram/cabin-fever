#!/usr/bin/env python3
"""
Fetch words for The Deep End's word categories from Wiktionary's thesaurus pages (CC BY-SA 4.0):
every synonym listed for the page's first sense, with the labels Wiktionary gives it (slang, archaic,
Cockney rhyming slang, Australia…). tools/build-content.py turns the labels into a depth (no label =
mid-depth, slang deeper, archaic / obsolete / rare = the lake bottom) under the hand-tiered answers of
content-src/deepend.txt, and drops slurs.

Writes content-src/vendor/deepend-wiktionary.json (cached; rerun to refresh). Needs the internet; the
game itself never does.
    python3 tools/fetch-wiktionary.py
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
OUT = ROOT / 'content-src' / 'vendor' / 'deepend-wiktionary.json'
API = 'https://en.wiktionary.org/w/api.php'
UA = 'Cabin Fever/1.0 (offline party game, personal use; content builder)'
PAUSE_S = 3.0  # the API refuses a quick burst; one page every few seconds is fine

# Category (exactly as in deepend.txt) → its thesaurus page.
SOURCES: dict[str, str] = {
    'Name a slang word for money': 'Thesaurus:money',
    'Name a word for nonsense': 'Thesaurus:nonsense',
    'Name a word for the toilet': 'Thesaurus:toilet',
    'Name a slang word for the police': 'Thesaurus:police officer',
    'Name a word for a fool': 'Thesaurus:idiot',
    'Name a word that means excellent': 'Thesaurus:excellent',
    'Name a slang word for food': 'Thesaurus:food',
    'Name a word for a friend': 'Thesaurus:friend',
    'Name a slang word for your head': 'Thesaurus:head',
    'Name a slang word for your nose': 'Thesaurus:nose',
    'Name a way to say "throw up"': 'Thesaurus:vomit',
    'Name a way to say "go to sleep"': 'Thesaurus:sleep',
    'Name a way to say someone died': 'Thesaurus:die',
    'Name a way to say "steal"': 'Thesaurus:steal',
    'Name a way to say "eat"': 'Thesaurus:eat',
    'Name a word for chatter': 'Thesaurus:chatter',
    'Name a word for rich': 'Thesaurus:rich',
    'Name a slang word for prison': 'Thesaurus:prison',
    'Name a word for good-looking': 'Thesaurus:attractive',
    'Name a word for your bottom': 'Thesaurus:buttocks',
    'Name a slang word for being drunk': 'Thesaurus:drunk',
    'Name a cheeky word for sex': 'Thesaurus:copulate',
    'Name a word for kissing': 'Thesaurus:kiss',
}

WS = re.compile(r'\{\{ws\|en\|([^|}]+)[^}]*\}\}([^\n]*)')
QUAL = re.compile(r'\{\{(?:qualifier|q|qual|i|lb\|en)\|([^}]*)\}\}')


def first_sense(text: str) -> str:
    """The wikitext of the page's first sense (a page can list several: "head" the body part and the leader)."""
    parts = re.split(r'\n=+\{\{ws sense\|', text)
    return parts[1] if len(parts) > 1 else text


def synonyms(sense: str) -> str:
    """Only the Synonyms lists of a sense (not its hyponyms, related terms, antonyms…: "money box" and
    "unit of measure" came in as slang for money)."""
    return '\n'.join(re.findall(r'=+\s*Synonyms\s*=+\n(.*?)(?=\n=+[^=\n]+=+\n|\Z)', sense, re.S))


def words(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in WS.finditer(synonyms(first_sense(text))):
        word = m.group(1).strip()
        labels = [x.strip() for q in QUAL.findall(m.group(2)) for x in q.split('|') if x.strip()]
        if word:
            out.append({'w': word, 'labels': labels})
    return out


def fetch(page: str) -> str | None:
    url = API + '?' + urllib.parse.urlencode({'action': 'parse', 'page': page, 'prop': 'wikitext', 'redirects': 1, 'format': 'json', 'formatversion': 2})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30) as r:
                data: dict[str, Any] = json.load(r)
            return str(data['parse']['wikitext'])
        except Exception as e:  # noqa: BLE001 — refused / timed out: wait and retry
            print(f'{page}: {e} (retry {attempt + 1})', file=sys.stderr)
            time.sleep(30 * (attempt + 1))
    return None


def main() -> None:
    old: dict[str, Any] = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    out: dict[str, Any] = {}
    for cat, page in SOURCES.items():
        text = fetch(page)
        got = words(text) if text else []
        out[cat] = got or old.get(cat, [])  # nothing (refused, or a page that moved): keep last time's
        print(f'{cat[:44]:44s} {len(out[cat])} words', file=sys.stderr)
        time.sleep(PAUSE_S)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf-8')
    print(f'wrote {OUT} ({sum(len(v) for v in out.values())} words)', file=sys.stderr)


if __name__ == '__main__':
    main()
