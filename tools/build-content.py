#!/usr/bin/env python3
"""
Build Rumpus question/prompt pools.

Inputs
  content-src/*.txt                    hand-written (original) content
  content-src/vendor/opentdb.json      Open Trivia DB dump (CC BY-SA 4.0) — tools/fetch-opentdb.py
  content-src/vendor/cah.json          Cards Against Humanity, official packs only (CC BY-NC-SA 4.0)
  content-src/vendor/never-have-i-ever.json   from party-game-sentences (MIT)
  content-src/vendor/opentriviaqa-numeric.json  number-answer questions from OpenTriviaQA (CC BY-SA 4.0)

Output
  games/data/pools/<game>.json  — list of items, each with a stable "id" and "a" (18+ flag)

Run:  python3 tools/build-content.py
"""
import hashlib, html, json, random, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'content-src'
VENDOR = SRC / 'vendor'
OUT = ROOT / 'games' / 'data' / 'pools'
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(1234)

ADULT_RE = re.compile(
    r"\b(sex\w*|naked|nude\w*|nudist|drunk\w*|beer|vodka|tequila|whisk(e)?y|booze|liquor|wine|shots?|hangover|"
    r"orgasm\w*|penis|vagina|boob\w*|breast\w*|nipple\w*|dick\w*|cock\w*|puss(y|ies)|ass(es|hole)?|butt(hole)?|"
    r"genital\w*|horny|porn\w*|strip(per|ping|ped)?|lap ?dance|condom\w*|lube|viagra|erection|masturbat\w*|"
    r"kinky|bdsm|bondage|fetish|threesome|orgy|hook ?up|one-night|booty|thong|lingerie|f\*+|fuck\w*|shit\w*|"
    r"bitch\w*|slut\w*|whore\w*|hooker\w*|weed|stoned|high as|cocaine|crack|meth|heroin|ejaculat\w*|semen|"
    r"sperm|testic\w*|balls|scrotum|anal|anus|dildo|vibrator|bukkake|69|rape\w*|incest|nazi\w*|hitler)\b",
    re.I)

def sid(*parts):
    return hashlib.sha1('\x1f'.join(str(p) for p in parts).encode()).hexdigest()[:10]

def read_txt(name):
    """Return (family_lines, adult_lines) from a content-src text file."""
    fam, adult, cur = [], [], None
    cur = fam
    for raw in (SRC / name).read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.lower() == '## adult':
            cur = adult
            continue
        if line.startswith('#'):
            continue
        cur.append(line)
    return fam, adult

def dedupe(items, key):
    seen, out = set(), []
    for it in items:
        k = re.sub(r'[^a-z0-9]', '', key(it).lower())
        if k in seen or not k:
            continue
        seen.add(k)
        out.append(it)
    return out

def write(name, items, min_count=1000):
    for it in items:
        it.setdefault('id', sid(name, json.dumps({k: v for k, v in it.items() if k != 'a'}, sort_keys=True)))
    adult = sum(1 for i in items if i['a'])
    (OUT / f'{name}.json').write_text(json.dumps(items, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    flag = '' if len(items) >= min_count else '   <-- below target'
    print(f'{name:12s} {len(items):6d} items   {adult:5d} adult ({adult * 100 // max(1, len(items))}%){flag}')

def fill(tpl, f):
    out = tpl.replace('{}', f)
    return re.sub(r"\ba ([aeiAEI]|[oO](?!ne|nce)|[uU](?!ni|se|su|ku|ro|ti|fo|FO))", r"an \1", out)

def clean(s):
    return html.unescape(s).strip()

# ----------------------------------------------------------------- "boring" filters
# The user asked for no boring / generic / everyday questions. These filters
# drop dry or niche trivia, plain "name a fruit" prompts and obvious numbers.
DRY_CATS = {'Science: Computers', 'Science: Mathematics', 'Science: Gadgets', 'Politics',
            'Entertainment: Japanese Anime & Manga', 'Entertainment: Comics'}
DRY_RE = re.compile(r"stand for|abbreviat|acronym|network|protocol|programming|algorithm|equation|derivative|"
                    r"isotope|frequency|wavelength|integer|binary|\bCPU\b|\bGPU\b|kernel|operating system|"
                    r"version of|chemical (formula|symbol)|atomic|molar|theorem|prime minister of|president of "
                    r"(the )?(senate|council)|which of these is not|codename|developer|engine|firmware|patch", re.I)
TWIST_RE = re.compile(r"worst|never|weird|embarrass|secret|lie|regret|scar|gross|awkward|terrible|illegal|"
                      r"drunk|naked|ex\b|kick|fired|banned|haunt|ghost|zombie|bear|moose|raccoon|goose|"
                      r"steal|hide|cheat|cry|fake|ruin|mom|dad|grandma|stranger|weirdest|creep|cursed|"
                      r"apocalypse|villain|explode|panic|disaster|horrible|smell|sexy|date|bed|toilet", re.I)

def boring_trivia(q):
    cat = clean(q.get('category', ''))
    text = clean(q['question'])
    if q['type'] == 'boolean' or cat in DRY_CATS or DRY_RE.search(text):
        return True
    if re.search(r"How many letters are in the English|What is the capital of|What colou?r is", text, re.I):
        return True
    if cat == 'Entertainment: Video Games' and q['difficulty'] == 'hard':
        return True
    return False

# ----------------------------------------------------------------- vendor data
opentdb = json.loads((VENDOR / 'opentdb.json').read_text()) if (VENDOR / 'opentdb.json').exists() else []
cah = json.loads((VENDOR / 'cah.json').read_text()) if (VENDOR / 'cah.json').exists() else None
nhie = json.loads((VENDOR / 'never-have-i-ever.json').read_text()) if (VENDOR / 'never-have-i-ever.json').exists() else []

# ----------------------------------------------------------------- CAH (official packs only)
cah_black, cah_white = [], []
if cah:
    for pack in cah['packs']:
        if not pack.get('official'):
            continue
        family = bool(re.search(r'family', pack['name'], re.I))
        for i in pack['black']:
            b = cah['black'][i]
            text = clean(b['text']).replace('_', '____')
            # Skip instruction cards ("Instead of playing a card…") — they need house rules we don't have.
            if '____' not in text and not text.rstrip().endswith('?'):
                continue
            cah_black.append({'text': text, 'pick': b['pick'], 'a': not family})
        for i in pack['white']:
            cah_white.append({'text': clean(cah['white'][i]), 'a': not family})
    cah_black = dedupe(cah_black, lambda x: x['text'])
    cah_white = dedupe(cah_white, lambda x: x['text'])
    # Our original Punchline prompts double as Card Chaos prompt cards ("…: ____.").
    pf, pa = read_txt('punchline.txt')
    extra = [{'text': f'{t}: ____.', 'pick': 1, 'a': False} for t in pf] + [{'text': f'{t}: ____.', 'pick': 1, 'a': True} for t in pa]
    write('cah-black', dedupe([b for b in cah_black if b['pick'] == 1] + extra, lambda x: x['text']), 1000)
    write('cah-white', cah_white, 1000)

# ----------------------------------------------------------------- Punchline
fam, adult = read_txt('punchline.txt')
punch = [{'text': t, 'a': False} for t in fam] + [{'text': t, 'a': True} for t in adult]
punch += [{'text': b['text'], 'a': b['a'] or bool(ADULT_RE.search(b['text']))} for b in cah_black if b['pick'] == 1]
write('punchline', dedupe(punch, lambda x: x['text']))

# ----------------------------------------------------------------- Trivia + Fib Finder (OpenTDB split) + adult
def short_answer(a):
    return len(a) <= 26 and len(a.split()) <= 4 and not re.fullmatch(r'[-\d.,%]+', a)

trivia, fib, closest = [], [], []
for q in opentdb:
    if boring_trivia(q):
        continue
    text = clean(q['question'])
    correct = clean(q['correct_answer'])
    wrong = [clean(w) for w in q['incorrect_answers']]
    is_adult = bool(ADULT_RE.search(text + ' ' + correct))
    cat = clean(q.get('category', ''))
    if q['type'] == 'boolean':
        choices = ['True', 'False']
        trivia.append({'q': text, 'choices': choices, 'correct': choices.index(correct), 'cat': cat, 'a': is_adult})
        continue
    nums = [correct] + wrong
    if all(re.fullmatch(r'-?\d[\d,]*(\.\d+)?', n) for n in nums) and not re.search(r'which of|following', text, re.I):
        closest.append({'q': text, 'answer': float(correct.replace(',', '')), 'a': is_adult})
    fib_ok = (short_answer(correct) and not re.search(r'which of (these|the following)|not |following|true|false|\bthese\b', text, re.I)
              and len(text) < 160)
    # Deterministic split so the two games never share a question.
    fib_ok = fib_ok and not cat.startswith('Entertainment: Video Games') and not cat.startswith('Entertainment: Cartoon')
    if fib_ok and q['difficulty'] != 'easy' and int(sid('split', text), 16) % 100 < 80:
        fib.append({'q': text, 'answer': correct, 'cat': cat, 'a': is_adult})
    else:
        choices = wrong + [correct]
        rng.shuffle(choices)
        trivia.append({'q': text, 'choices': choices, 'correct': choices.index(correct), 'cat': cat, 'a': is_adult})

for line in (SRC / 'adult-trivia.txt').read_text(encoding='utf-8').splitlines():
    if '|' not in line or line.startswith('#'):
        continue
    parts = [p.strip() for p in line.split('|')]
    q, correct, wrong = parts[0], parts[1], parts[2:5]
    choices = wrong + [correct]
    rng.shuffle(choices)
    trivia.append({'q': q, 'choices': choices, 'correct': choices.index(correct), 'cat': 'After Dark', 'a': True})
    if short_answer(correct) and '____' not in q and not re.search(r'which of|following', q, re.I):
        fib.append({'q': q, 'answer': correct, 'cat': 'After Dark', 'a': True})

# Original hand-written fill-in-the-blank facts from v1 stay in the pool too.
try:
    import subprocess
    old = subprocess.run(['node', '-e', "console.log(JSON.stringify(require('./games/data/fibbage-questions').QUESTIONS))"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    fib = [{'q': q['q'], 'answer': q['answer'], 'cat': 'Weird facts', 'a': False} for q in json.loads(old)] + fib
except Exception:
    pass

write('trivia', dedupe(trivia, lambda x: x['q']))
write('fibbage', dedupe(fib, lambda x: x['q']))

# ----------------------------------------------------------------- Closest Guess
ELEMENTS = ('Hydrogen Helium Lithium Beryllium Boron Carbon Nitrogen Oxygen Fluorine Neon Sodium Magnesium Aluminium Silicon '
            'Phosphorus Sulfur Chlorine Argon Potassium Calcium Scandium Titanium Vanadium Chromium Manganese Iron Cobalt Nickel '
            'Copper Zinc Gallium Germanium Arsenic Selenium Bromine Krypton Rubidium Strontium Yttrium Zirconium Niobium Molybdenum '
            'Technetium Ruthenium Rhodium Palladium Silver Cadmium Indium Tin Antimony Tellurium Iodine Xenon Caesium Barium '
            'Lanthanum Cerium Praseodymium Neodymium Promethium Samarium Europium Gadolinium Terbium Dysprosium Holmium Erbium '
            'Thulium Ytterbium Lutetium Hafnium Tantalum Tungsten Rhenium Osmium Iridium Platinum Gold Mercury Thallium Lead '
            'Bismuth Polonium Astatine Radon Francium Radium Actinium Thorium Protactinium Uranium Neptunium Plutonium Americium '
            'Curium Berkelium Californium Einsteinium Fermium Mendelevium Nobelium Lawrencium Rutherfordium Dubnium Seaborgium '
            'Bohrium Hassium Meitnerium Darmstadtium Roentgenium Copernicium Nihonium Flerovium Moscovium Livermorium Tennessine '
            'Oganesson').split()
assert len(ELEMENTS) == 118
# (Atomic numbers were dropped as too dry.)

for line in (SRC / 'closest.txt').read_text(encoding='utf-8').splitlines():
    if '|' not in line or line.startswith('#'):
        continue
    p = [x.strip() for x in line.split('|')]
    closest.append({'q': p[0], 'answer': float(p[1]), 'unit': p[2] if len(p) > 2 else '', 'a': False})
for line in (SRC / 'adult-closest.txt').read_text(encoding='utf-8').splitlines():
    if '|' not in line or line.startswith('#'):
        continue
    p = [x.strip() for x in line.split('|')]
    closest.append({'q': p[0], 'answer': float(p[1]), 'unit': p[2] if len(p) > 2 else '', 'a': True})
otqa = VENDOR / 'opentriviaqa-numeric.json'
if otqa.exists():
    for q in json.loads(otqa.read_text()):
        closest.append({'q': q['q'], 'answer': float(q['answer'].replace(',', '')), 'a': bool(ADULT_RE.search(q['q']))})
for c in closest:
    if c['answer'] == int(c['answer']):
        c['answer'] = int(c['answer'])
OBVIOUS = re.compile(r"atomic number|legs does (a|an) (spider|insect)|arms does an octopus|chambers does a human heart|lungs does|"
    r"planets are in our|degrees are in a|sides does a (hexagon|stop sign)|days are in a leap|hours are in a (week|year)|"
    r"years are in a millennium|letters are in the English|bits are in a byte|megabytes|strings does a standard|"
    r"lines are in a (sonnet|haiku)|syllables are in a haiku|cards are in a standard|players are on a|Great Lakes are|"
    r"provinces does Canada|territories does Canada|official languages does Canada|How many Beatles|Lord of the Rings books|"
    r"Harry Potter books|How many US states|stars are on the US|stripes are on|feet are in a mile|centimetres are in an inch|"
    r"grams are in a pound|ounces are in a pound|does water freeze|holes are on a standard golf|pins are in ten-pin|"
    r"pieces does each player|rings are on the Olympic|moons does Mars|minutes are in a week|seconds are in a day|"
    r"weeks are in a year|countries border Canada|babies \(joeys\)|valves does|keys does a standard harmonica|"
    r"players are on a curling|points is a (touchdown|field goal)|downs does|bottles of wine are in a standard case|"
    r"beers are in a Canadian", re.I)
closest = [c for c in closest if not OBVIOUS.search(c['q'])]
write('closest', dedupe(closest, lambda x: x['q']))

# ----------------------------------------------------------------- Majority Rules
fam, adult = read_txt('majority.txt')
plain = lambda t: len(t.split()) <= 6 and not TWIST_RE.search(t)
maj = [{'text': t, 'a': False} for t in fam if not plain(t)] + [{'text': t, 'a': True} for t in adult]
T = json.loads((SRC / 'majority-templates.json').read_text(encoding='utf-8'))
for tpl, fills in T.items():
    for f in fills:
        maj.append({'text': fill(tpl, f), 'a': False})
write('majority', dedupe(maj, lambda x: x['text']))

# ----------------------------------------------------------------- Most Likely To
fam, adult = read_txt('mostlikely.txt')
ml = [{'text': f'Who is most likely to {t}?', 'a': False} for t in fam]
ml += [{'text': f'Who is most likely to {t}?', 'a': True} for t in adult]
# The Never-Have-I-Ever source turned out to be generic hobby lists ("eaten
# sushi", "gone rollerblading") — dropped as too boring.
MUNDANE = re.compile(r"^Who is most likely to (fall asleep first tonight|burn the toast|forget where they parked|"
    r"lose their keys every day|call their mom every day|own a telescope|own 1,000 books|become a librarian|"
    r"read the last page|eat dessert first|put ketchup on everything|drink coffee at midnight|become a coffee snob|"
    r"complain about the (cold|heat)|wear shorts in winter|grow a beard|own a typewriter|send a handwritten letter|"
    r"remember everyone's birthday|give the best gifts|become an astronaut|want to live on Mars|become a vegetarian|"
    r"run a marathon|walk a marathon|become a yoga instructor|chop wood like a pro|make the best s'mores|"
    r"eat cereal for dinner|win a game of hide and seek|become a CEO|invent something useful|become a crossword|"
    r"finish a 1,000-piece|hum the same song|keep a diary|own a label maker|iron their jeans|become a beekeeper|"
    r"learn a language|wake up first|volunteer to go first|plan the whole trip|become a park ranger|catch the biggest fish)")
ml = [m for m in ml if not MUNDANE.search(m['text'])]
for tpl, fills in json.loads((SRC / 'mostlikely-templates.json').read_text(encoding='utf-8')).items():
    ml += [{'text': fill(tpl, f), 'a': False} for f in fills]
write('mostlikely', dedupe(ml, lambda x: x['text']))

# ----------------------------------------------------------------- Odd One Out
fam, adult = read_txt('imposter.txt')
cats = []
for lines, is_adult in ((fam, False), (adult, True)):
    for line in lines:
        cat, words = line.split(':', 1)
        if cat.strip() in ('Shapes', 'Colours'):
            continue
        ws = [w.strip() for w in words.split(',') if w.strip()]
        cats.append({'category': cat.strip(), 'words': ws, 'a': is_adult})
# Each secret word is one "question": items are (category, word); the game
# draws decoys from the same category.
imp = [{'category': c['category'], 'word': w, 'words': c['words'], 'a': c['a']} for c in cats for w in c['words']]
write('imposter', imp)

# ----------------------------------------------------------------- Doodle Telephone
fam, adult = read_txt('telephone.txt')
tel = [{'text': t, 'a': False} for t in fam] + [{'text': t, 'a': True} for t in adult]
G = json.loads((SRC / 'telephone-words.json').read_text(encoding='utf-8'))
combos = set()
while len(combos) < 1300:
    combos.add((rng.choice(G['who']), rng.choice(G['doing']), rng.choice(G['where'])))
for who, doing, where in sorted(combos):
    tel.append({'text': f'{who} {doing} {where}', 'a': False})
write('telephone', dedupe(tel, lambda x: x['text']))

print('\nPools written to', OUT.relative_to(ROOT))
