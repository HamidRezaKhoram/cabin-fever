#!/usr/bin/env python3
"""
Generate the game-select illustrations (original pixel art) from simple
shapes, and write them into public/sprites.js between the ICONS markers.
Each game gets its own size and design that shows what the game is about.

    python3 tools/make-icons.py            # write sprites.js
    python3 tools/make-icons.py --preview  # also write icons-preview.png (needs Pillow)
"""
import math, re, sys
from typing import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

class Canvas:
    def __init__(self, w: int, h: int) -> None:
        self.w, self.h = w, h
        self.px = [['.'] * w for _ in range(h)]
    def set(self, x: float, y: float, c: str) -> None:
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c
    def get(self, x: int, y: int) -> str:
        return self.px[y][x] if 0 <= x < self.w and 0 <= y < self.h else '.'
    def rect(self, x: int, y: int, w: int, h: int, c: str) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, c)
    def disc(self, cx: float, cy: float, r: float, c: str) -> None:
        for y in range(int(cy - r - 1), int(cy + r + 2)):
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3:
                    self.set(x, y, c)
    def ellipse(self, cx: float, cy: float, rx: float, ry: float, c: str) -> None:
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.02:
                    self.set(x, y, c)
    def line(self, x0: float, y0: float, x1: float, y1: float, c: str) -> None:
        n = int(max(abs(x1 - x0), abs(y1 - y0))) or 1
        for i in range(n + 1):
            self.set(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c)
    def tri(self, pts: list[tuple[float, float]], c: str) -> None:
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        def inside(x: float, y: float) -> bool:
            (x1, y1), (x2, y2), (x3, y3) = pts
            d1 = (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2)
            d2 = (x - x3) * (y2 - y3) - (x2 - x3) * (y - y3)
            d3 = (x - x1) * (y3 - y1) - (x3 - x1) * (y - y1)
            neg = d1 < 0 or d2 < 0 or d3 < 0; pos = d1 > 0 or d2 > 0 or d3 > 0
            return not (neg and pos)
        for y in range(int(min(ys)), int(max(ys)) + 1):
            for x in range(int(min(xs)), int(max(xs)) + 1):
                if inside(x, y): self.set(x, y, c)
    def text(self, x: int, y: int, s: str, c: str) -> None:
        for ch in s:
            g = FONT.get(ch)
            if not g: x += 4; continue
            for yy, row in enumerate(g):
                for xx, b in enumerate(row):
                    if b == '#': self.set(x + xx, y + yy, c)
            x += len(g[0]) + 1
    def outline(self, c: str = 'K') -> None:
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.px[y][x] != '.': continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    v = self.get(x + dx, y + dy)
                    if v not in ('.', c):
                        add.append((x, y)); break
        for x, y in add: self.px[y][x] = c
    def grid(self) -> str:
        return '\n'.join(''.join(r) for r in self.px)

FONT: dict[str, list[str]] = {
    'H': ['#.#', '#.#', '###', '#.#', '#.#'], 'A': ['.#.', '#.#', '###', '#.#', '#.#'],
    '!': ['#', '#', '#', '.', '#'], '?': ['##.', '..#', '.#.', '...', '.#.'],
    'X': ['#.#', '#.#', '.#.', '#.#', '#.#'], 'V': ['#.#', '#.#', '#.#', '#.#', '.#.'],
    '1': ['.#', '##', '.#', '.#', '.#'], '2': ['##.', '..#', '.#.', '#..', '###'], '3': ['##.', '..#', '.#.', '..#', '##.'],
}

def punchline() -> Canvas:                       # stand-up mic in a spotlight with a "HA!" bubble
    c = Canvas(32, 28)
    c.tri([(4, 27), (27, 27), (16, 4)], 'H')            # spotlight cone
    c.rect(2, 25, 28, 3, 'M')                            # stage
    c.line(15, 12, 15, 25, 'S'); c.line(16, 12, 16, 25, 'S')   # stand
    c.rect(11, 24, 10, 1, 'S')
    c.ellipse(15.5, 9, 3.5, 4.5, 'G')                    # mic head
    for y in (6, 8, 10, 12):
        for x in (13, 15, 17): c.set(x, y, 'S')
    c.rect(14, 13, 4, 2, 'C')
    c.rect(19, 0, 13, 9, 'W'); c.tri([(21, 8), (24, 8), (20, 11)], 'W')
    c.text(20, 2, 'HA!', 'R')
    c.outline(); return c

def fibbage() -> Canvas:                         # sweating poker face: shifty eyes + "?"
    c = Canvas(28, 28)
    c.disc(13, 15, 11, 'Z')
    c.rect(6, 11, 5, 3, 'W'); c.rect(15, 11, 5, 3, 'W')  # eyes looking sideways
    c.rect(9, 12, 2, 2, 'E'); c.rect(18, 12, 2, 2, 'E')
    c.line(6, 9, 10, 10, 'B'); c.line(15, 10, 19, 9, 'B') # raised brow
    c.line(8, 20, 18, 19, 'E'); c.set(19, 18, 'E')        # smirk
    c.ellipse(23, 8, 2, 3, 'A'); c.set(23, 4, 'A')        # sweat drop
    c.rect(21, 0, 7, 7, 'Y'); c.text(23, 1, '?', 'C')
    c.outline(); return c

def trivia() -> Canvas:                          # big red quiz buzzer with lightning bolts
    c = Canvas(24, 28)
    c.ellipse(12, 14, 9, 7, 'R'); c.rect(3, 14, 19, 5, 'R')
    c.ellipse(9, 11, 3, 2, 'P')                           # shine
    c.rect(1, 19, 23, 5, 'Q'); c.rect(1, 24, 23, 2, 'C')
    c.rect(5, 21, 2, 1, 'Y'); c.rect(17, 21, 2, 1, 'Y')
    for ox in (0, 19):                                    # lightning bolts
        c.line(ox + 3, 0, ox + 1, 4, 'Y'); c.line(ox + 1, 4, ox + 4, 4, 'Y'); c.line(ox + 4, 4, ox + 2, 8, 'Y')
    c.outline(); return c

def closest() -> Canvas:                         # dartboard with a dart near the bullseye
    c = Canvas(28, 28)
    for r, col in ((12, 'E'), (11, 'R'), (9, 'W'), (7, 'R'), (5, 'W'), (3, 'R'), (1.5, 'N')):
        c.disc(13, 14, r, col)
    c.line(16, 12, 26, 2, 'T'); c.line(17, 12, 27, 2, 'T')   # dart shaft
    c.rect(15, 12, 2, 2, 'S')
    c.tri([(23, 1), (27, 1), (27, 5)], 'U')                   # flight
    c.outline(); return c

def sheep(c: Canvas, x: float, y: float, s: float = 1.0, body: str = 'W', face: str = 'Q', wolf: bool = False) -> None:
    for dx in (-3, 3):                                                    # legs
        c.rect(int(x + dx * s), int(y + 3 * s), max(1, int(s * 1.5)), int(3 * s), 'Q')
    c.ellipse(x, y, 5 * s, 3.5 * s, body)
    for wx in (-3.5, 0.0, 3.5): c.disc(x + wx * s, y - 2.5 * s, 2.2 * s, body)  # fluffy wool
    hx, hy = x + 5.5 * s, y - 2.5 * s
    if wolf:
        c.ellipse(hx, hy, 3.2 * s, 2.6 * s, face)
        c.tri([(hx - 2 * s, hy - 2 * s), (hx - 1 * s, hy - 5.5 * s), (hx, hy - 2 * s)], face)   # pointy ears
        c.tri([(hx + 0.5 * s, hy - 2 * s), (hx + 1.5 * s, hy - 5.5 * s), (hx + 2.5 * s, hy - 2 * s)], face)
        c.ellipse(hx + 3 * s, hy + 1, 2 * s, 1.3 * s, face)                # snout
        c.set(hx + 0.5 * s, hy - 0.5, 'R')                                  # red eye
        c.set(hx + 3 * s, hy + 2, 'W'); c.set(hx + 4 * s, hy + 2, 'W')     # fangs
        c.set(hx + 5 * s, hy + 0.5, 'E')                                    # nose
    else:
        c.ellipse(hx, hy, 2 * s, 2.6 * s, face)
        c.set(hx + 0.5 * s, hy - 0.5 * s, 'W')                              # eye
        c.rect(int(hx - 2.5 * s), int(hy - 2 * s), int(1.5 * s) or 1, 1, face)  # ear

def meadow(c: Canvas) -> None:
    c.rect(0, 0, c.w, c.h, 'A')                                             # sky
    c.disc(c.w - 5, 4, 2.5, 'Y')                                            # sun
    c.rect(0, c.h - 5, c.w, 5, 'N')                                         # grass

def majority() -> Canvas:                        # a flock of sheep, all facing the same way
    c = Canvas(32, 24)
    meadow(c)
    sheep(c, 6, 15, 0.75); sheep(c, 24, 15, 0.75); sheep(c, 14, 13, 1.0)
    c.outline(); return c

def mostlikely() -> Canvas:                      # "who, me?!" — spotlit face, arrows pointing in
    c = Canvas(26, 26)
    c.tri([(13, 0), (2, 25), (24, 25)], 'H')
    c.disc(13, 15, 6, 'Z')
    c.rect(10, 13, 2, 2, 'E'); c.rect(15, 13, 2, 2, 'E')
    c.ellipse(13, 18.5, 1.5, 1.5, 'E')                   # gasp
    c.rect(12, 3, 2, 5, 'R'); c.rect(12, 9, 2, 1, 'R')     # "!"
    for side in (1, -1):                                  # arrows
        x0 = 0 if side == 1 else 25
        c.line(x0, 15, x0 + side * 4, 15, 'U'); c.line(x0, 16, x0 + side * 4, 16, 'U')
        c.tri([(x0 + side * 4, 12), (x0 + side * 4, 19), (x0 + side * 6, 15.5)], 'U')
    c.outline(); return c

def imposter() -> Canvas:                        # wolf in sheep's clothing among the flock
    c = Canvas(30, 26)
    meadow(c)
    sheep(c, 5, 17, 0.65); sheep(c, 24, 17, 0.65)
    sheep(c, 13, 15, 0.95, face='G', wolf=True)
    c.outline(); return c

def twotruths() -> Canvas:                       # three cards: ✓ ✓ ✗
    c = Canvas(30, 22)
    for i, (col, mark) in enumerate((('N', 'V'), ('N', 'V'), ('R', 'X'))):
        x = 1 + i * 10
        c.rect(x, 3 + (2 if i == 1 else 0), 8, 15, 'W'); c.rect(x, 3 + (2 if i == 1 else 0), 8, 3, col)
        y = 10 + (2 if i == 1 else 0)
        if mark == 'V':
            c.line(x + 1, y, x + 3, y + 3, 'F'); c.line(x + 3, y + 3, x + 6, y - 2, 'F')
        else:
            c.line(x + 1, y - 2, x + 6, y + 3, 'R'); c.line(x + 6, y - 2, x + 1, y + 3, 'R')
    c.outline(); return c

def telephone() -> Canvas:                       # tin-can phones + a doodle on paper
    c = Canvas(30, 26)
    c.rect(1, 8, 6, 8, 'G'); c.rect(1, 8, 6, 1, 'X')      # can 1
    c.rect(23, 8, 6, 8, 'G'); c.rect(23, 8, 6, 1, 'X')    # can 2
    for x in range(7, 23):                                 # wavy string
        c.set(x, 11 + round(math.sin(x / 2) * 1.5), 'B')
    c.rect(8, 15, 14, 10, 'W')                             # paper
    for x in range(10, 20): c.set(x, 20 + round(math.sin(x / 1.3) * 2), 'U')  # doodle
    c.line(19, 0, 13, 13, 'Y'); c.line(20, 0, 14, 13, 'Y')  # pencil
    c.rect(19, 0, 2, 1, 'P'); c.set(13, 14, 'E')
    c.outline(); return c

def cah() -> Canvas:                             # fanned black & white cards with a flame
    c = Canvas(28, 28)
    c.rect(2, 6, 13, 18, 'C'); c.text(6, 11, '?', 'W')     # black card
    c.rect(12, 9, 13, 18, 'W')                             # white card
    for y in (13, 16, 19): c.rect(14, y, 9, 1, 'Q')
    c.disc(20, 5, 3.5, 'O'); c.tri([(17, 4), (23, 4), (20, -1)], 'O'); c.disc(20, 6, 1.8, 'Y')  # flame
    c.outline(); return c

def minigames() -> Canvas:              # red vs blue tug-of-war over the lake
    c = Canvas(34, 24)
    c.rect(0, 15, 34, 9, 'U')                                   # lake
    for x in range(0, 34, 4): c.set(x + 1, 17, 'A')
    c.rect(0, 11, 9, 5, 'F'); c.rect(25, 11, 9, 5, 'F')          # two shores
    c.line(6, 7, 28, 7, 'B'); c.line(6, 8, 28, 8, 'B')            # rope
    c.rect(16, 4, 2, 4, 'W'); c.tri([(18, 4), (22, 5), (18, 6)], 'Y')  # centre flag
    for cx, col in ((4, 'R'), (30, 'U')):                        # the two pullers
        c.disc(cx, 4, 2.5, col); c.rect(cx - 2, 6, 5, 5, col)
        c.set(cx - 1, 3, 'W'); c.set(cx + 1, 3, 'W')
    c.outline(); return c

def crush() -> Canvas:                 # two lovebirds on a dock under a heart moon
    c = Canvas(32, 22)
    c.rect(0, 17, 32, 5, 'U')                                   # lake
    c.rect(4, 14, 24, 2, 'B'); c.rect(6, 16, 2, 4, 'B'); c.rect(24, 16, 2, 4, 'B')  # dock
    for cx, col in ((11, 'D'), (20, 'V')):                       # two sweethearts
        c.disc(cx, 9, 2.5, col); c.rect(cx - 2, 11, 5, 3, col); c.set(cx, 8, 'W')
    c.disc(13.5, 2.5, 2, 'P'); c.disc(17.5, 2.5, 2, 'P'); c.tri([(11.5, 3), (19.5, 3), (15.5, 7.5)], 'P')  # heart moon
    c.outline(); return c

def looncall() -> Canvas:              # a singing loon on the lake, notes floating up
    c = Canvas(30, 22)
    c.rect(0, 17, 30, 5, 'U')                                    # lake
    c.ellipse(13, 14.5, 9, 3.2, 'C')                             # body
    for x in range(7, 20, 3): c.set(x, 13, 'W'); c.set(x + 1, 15, 'W')  # chequered back
    c.rect(19, 7, 3, 7, 'C'); c.rect(19, 10, 3, 1, 'W')          # neck + white necklace
    c.disc(21, 6, 2.4, 'C'); c.set(22, 5, 'R')                   # head, red eye
    c.line(23, 6, 27, 5, 'S'); c.line(23, 7, 27, 8, 'S')         # open beak: singing
    for nx, ny in ((4, 7), (9, 4)):                              # two eighth notes
        c.disc(nx, ny + 3, 1.2, 'Y'); c.rect(nx + 1, ny - 1, 1, 4, 'Y'); c.set(nx + 2, ny - 1, 'Y'); c.set(nx + 3, ny, 'Y')
    c.outline(); return c

def lantern() -> Canvas:               # a paper boat with a glowing lantern on dusk water
    c = Canvas(30, 24)
    c.rect(0, 18, 30, 6, 'U')                                    # water
    for x in range(2, 28, 5): c.set(x, 20, 'A'); c.set(x + 2, 22, 'A')  # ripples
    c.tri([(4, 13), (26, 13), (21, 18)], 'W'); c.tri([(4, 13), (9, 18), (21, 18)], 'X')   # paper hull
    c.tri([(14, 2), (14, 13), (22, 13)], 'H')                    # sail
    c.rect(13, 2, 1, 11, 'B')                                    # mast
    c.disc(8, 8, 3.2, 'Y'); c.rect(7, 4, 3, 1, 'B'); c.set(8, 8, 'O')  # lantern
    c.outline(); return c

def storm() -> Canvas:                 # a cottage under a storm cloud, a raccoon peeking out
    c = Canvas(30, 26)
    c.ellipse(15, 4, 12, 3.5, 'S'); c.ellipse(9, 5, 6, 3, 'Q'); c.ellipse(21, 5, 6, 3, 'Q')   # storm cloud
    c.line(18, 8, 15, 12, 'Y'); c.line(15, 12, 18, 12, 'Y'); c.line(18, 12, 14, 17, 'Y')      # lightning
    for x in (6, 10, 23, 26): c.set(x, 10, 'A'); c.set(x - 1, 13, 'A')                       # rain
    c.rect(4, 17, 14, 8, 'B'); c.tri([(2, 17), (20, 17), (11, 11)], 'R')                       # cottage + roof
    c.rect(9, 20, 3, 5, 'C'); c.rect(14, 19, 2, 2, 'H')                                       # door, lit window
    c.disc(23, 21, 3, 'G'); c.rect(21, 20, 5, 1, 'C'); c.set(22, 20, 'W'); c.set(24, 20, 'W')   # raccoon: mask + eyes
    c.rect(20, 23, 7, 2, 'G'); c.rect(26, 22, 2, 1, 'C')                                      # body, ringed tail
    c.outline(); return c

def wizards() -> Canvas:               # two wizards casting over a campfire
    c = Canvas(32, 26)
    c.rect(0, 22, 32, 4, 'F')                                    # grass
    c.rect(12, 19, 8, 2, 'B'); c.tri([(13, 19), (19, 19), (16, 11)], 'O'); c.tri([(14, 19), (18, 19), (16, 14)], 'Y')  # fire
    for cx, hat in ((5, 'M'), (27, 'U')):
        c.tri([(cx - 3, 9), (cx + 3, 9), (cx, 2)], hat); c.set(cx, 4, 'Y')                    # pointy hat + star
        c.disc(cx, 11, 2.2, 'Z'); c.rect(cx - 3, 13, 7, 8, hat)                               # face, robe
    c.line(8, 15, 11, 12, 'B'); c.line(24, 15, 21, 12, 'B')                                    # wands
    for x, y in ((12, 10), (13, 8), (20, 10), (19, 8), (16, 6)): c.set(x, y, 'Y')              # sparks
    c.outline(); return c

ICONS: dict[str, Callable[[], Canvas]] = {
    'quiplash': punchline, 'fibbage': fibbage, 'trivia': trivia, 'closest': closest,
    'majority': majority, 'mostlikely': mostlikely, 'imposter': imposter,
    'twotruths': twotruths, 'telephone': telephone, 'cah': cah, 'minigames': minigames, 'looncall': looncall, 'lantern': lantern, 'storm': storm, 'wizards': wizards, 'crush': crush,
}

PAL: dict[str, str] = {'K': '#1a1423', 'W': '#f4f1e8', 'E': '#1a1423', 'O': '#e8762b', 'B': '#8a5a3b', 'L': '#d9b38c', 'T': '#e6c48a',
       'G': '#8e8fa3', 'P': '#f2a0b5', 'D': '#d46a8a', 'N': '#4caf50', 'Y': '#ffd23f', 'R': '#e83f5b', 'A': '#4fc3f7',
       'S': '#6b7a8f', 'M': '#5e3a8c', 'C': '#2b2d42', 'V': '#9c6ade', 'H': '#ffe9a8', 'Z': '#f1c27d', 'Q': '#4a4e69',
       'U': '#1e88e5', 'F': '#2e7d32', 'X': '#cfd2dc'}

def main() -> None:
    grids = {k: f().grid() for k, f in ICONS.items()}
    body = '  /** @type {Record<string, string>} */\n  const ICONS = {\n' + ''.join(f"    {k}: `\n{g}`,\n" for k, g in grids.items()) + '  };\n'
    p = ROOT / 'public' / 'sprites.js'
    s = p.read_text()
    s2 = re.sub(r'  // ICONS:START.*?// ICONS:END\n', '  // ICONS:START (generated by tools/make-icons.py — do not edit by hand)\n' + body + '  // ICONS:END\n', s, flags=re.S)
    assert s2 != s or 'ICONS:START' in s, 'markers missing'
    p.write_text(s2)
    print('wrote', len(grids), 'icons:', ', '.join(f"{k} {len(g.splitlines()[0])}x{len(g.splitlines())}" for k, g in grids.items()))
    if '--preview' in sys.argv:
        from PIL import Image  # type: ignore[import-untyped]  # optional, only for previews
        scale, pad = 6, 8
        tiles = [g.splitlines() for g in grids.values()]
        W = sum(len(t[0]) * scale + pad for t in tiles) + pad
        H = max(len(t) for t in tiles) * scale + 2 * pad
        img = Image.new('RGB', (W, H), '#14121f')
        x = pad
        for t in tiles:
            for yy, row in enumerate(t):
                for xx, ch in enumerate(row):
                    if ch != '.':
                        for dy in range(scale):
                            for dx in range(scale):
                                img.putpixel((x + xx * scale + dx, pad + yy * scale + dy), tuple(int(PAL[ch][i:i + 2], 16) for i in (1, 3, 5)))
            x += len(t[0]) * scale + pad
        out = sys.argv[sys.argv.index('--preview') + 1] if len(sys.argv) > sys.argv.index('--preview') + 1 else 'icons-preview.png'
        img.save(out)
        print('preview:', out)

if __name__ == '__main__':
    main()
