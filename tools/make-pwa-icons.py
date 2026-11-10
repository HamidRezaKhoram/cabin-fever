#!/usr/bin/env python3
"""Draw the Cabin Fever app icon (pixel art, original) and write the PWA PNGs:
public/icons/icon-192.png and icon-512.png.  python3 tools/make-pwa-icons.py"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 16x16: a game controller on the cottage-night purple.
ART = [
    "................",
    "................",
    "................",
    "................",
    "...##########...",
    "..#oooooooooo#..",
    ".#oo.oooooo**o#.",
    ".#o...oooo*oo*#.",
    ".#oo.oooooo**o#.",
    ".#oooooooooooo#.",
    ".#ooo######ooo#.",
    "..#o#......#o#..",
    "...#........#...",
    "................",
    "................",
    "................",
]
COL = {'.': (36, 31, 61), '#': (11, 9, 20), 'o': (255, 176, 46), '*': (94, 224, 160)}


def png(size: int) -> bytes:
    scale = size // 16
    rows = []
    for y in range(size):
        line = bytearray([0])
        for x in range(size):
            line += bytes(COL[ART[y // scale][x // scale]])
        rows.append(bytes(line))
    raw = zlib.compress(b''.join(rows), 9)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')


def main() -> None:
    for size in (192, 512):
        (ROOT / 'public' / 'icons' / f'icon-{size}.png').write_bytes(png(size))


if __name__ == '__main__':
    main()
