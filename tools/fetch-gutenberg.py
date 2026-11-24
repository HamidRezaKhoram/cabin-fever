#!/usr/bin/env python3
"""
Fetch the first lines of well-known classics from Project Gutenberg (public domain in the US; each
book's own notice is respected) for a Fish Tales round: "Which classic begins: '…'?" — everyone invents
a title, then spots the real one. The title comes from the book's own header; the first line is the
first sentence of its first chapter (prefaces and contents skipped). tools/build-content.py only uses
the books listed in content-src/gutenberg-ok.txt (each first line checked by hand).

Downloads from the official PGLAF mirror (Gutenberg asks automated clients to use mirrors), one book
every few seconds. Writes content-src/vendor/gutenberg.json (cached; rerun to refresh).
    python3 tools/fetch-gutenberg.py
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'content-src' / 'vendor' / 'gutenberg.json'
UA = 'Cabin Fever/1.0 (offline party game, personal use; content builder)'
MIRROR = 'https://gutenberg.pglaf.org'

# Gutenberg ebook numbers of famous books from around the world (in English translation where needed).
BOOKS = [1342, 2701, 98, 84, 11, 1661, 74, 76, 345, 1260, 768, 2600, 1400, 46, 120, 43, 174, 219, 2554, 1184, 64317,
         158, 161, 105, 36, 35, 5230, 164, 103, 113, 514, 55, 16, 2852, 244, 205, 4300, 2814, 28054, 1399, 135, 2413,
         829, 521, 215, 910, 45, 41, 160, 33, 271, 236, 2097, 1257, 730, 766, 1023, 580, 2591, 1952, 4217, 2148, 996,
         2500, 1232, 3600, 23, 25344, 42324, 6593, 8800, 2542, 1497, 3825, 289]


def url_for(n: int) -> list[str]:
    d = '/'.join(str(n)[:-1]) if n >= 10 else '0'
    return [f'{MIRROR}/{d}/{n}/{n}-0.txt', f'{MIRROR}/{d}/{n}/{n}.txt', f'{MIRROR}/cache/epub/{n}/pg{n}.txt']


def fetch(n: int) -> str:
    for url in url_for(n):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                return str(r.read().decode('utf-8', errors='replace'))
        except Exception:  # noqa: BLE001 — try the next layout
            continue
    return ''


CHAPTER = re.compile(r'^\s*(CHAPTER|Chapter|BOOK|Book|PART|Part|LETTER|Letter|STAVE|Stave)\s+(I|1|ONE|One|THE FIRST|the First)\b[^\n]*$|^\s*(I|1)\.\s*$', re.M)


def first_line(text: str) -> tuple[str, str]:
    """(title, the first sentence of the story) from a Gutenberg plain-text book."""
    title_m = re.search(r'^Title:\s*(.+)$', text, re.M) or re.search(r'Project Gutenberg (?:EBook|eBook|Etext) of (.+?)(?:,| by |\r?\n)', text)
    title = title_m.group(1).strip() if title_m else ''
    start = re.search(r'\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*', text)
    body = text[start.end():] if start else text
    end = re.search(r'\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG', body)
    body = body[:end.start()] if end else body
    # The first chapter heading followed by real prose (a contents list has headings close together).
    for m in CHAPTER.finditer(body):
        after = body[m.end():m.end() + 4000]
        paras = [p.strip() for p in re.split(r'\n\s*\n', after) if p.strip()]
        prose = next((p for p in paras if len(p) > 200), None)
        if not prose or CHAPTER.search(after[:after.find(prose)] if prose in after else ''):
            continue
        flat = re.sub(r'\s+', ' ', prose).replace('_', '')
        sent = re.match(r'(.{30,240}?[.!?])(\s|"|”|$)', flat)
        if sent:
            return title, sent.group(1).strip()
    return title, ''


def main() -> None:
    old: dict[str, Any] = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    out: dict[str, Any] = {}
    for n in BOOKS:
        text = fetch(n)
        title, line = first_line(text) if text else ('', '')
        # (The title shown in the game comes from content-src/gutenberg-ok.txt: keep a line even without one.)
        out[str(n)] = {'title': title, 'line': line} if line else old.get(str(n), {'title': title, 'line': ''})
        print(f'{n:6d} {title[:40]:40s} | {line[:90]}', file=sys.stderr)
        time.sleep(2)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf-8')
    print(f'wrote {OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
