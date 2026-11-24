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
import hashlib, html, json, random, re, sys, unicodedata
from typing import Any, Callable

Item = dict[str, Any]
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

def sid(*parts: object) -> str:
    return hashlib.sha1('\x1f'.join(str(p) for p in parts).encode()).hexdigest()[:10]

def read_txt(name: str) -> tuple[list[str], list[str]]:
    """Return (family_lines, adult_lines) from a content-src text file."""
    fam: list[str] = []
    adult: list[str] = []
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

def dedupe(items: list[Item], key: Callable[[Item], str]) -> list[Item]:
    seen, out = set(), []
    for it in items:
        k = re.sub(r'[^a-z0-9]', '', key(it).lower())
        if k in seen or not k:
            continue
        seen.add(k)
        out.append(it)
    return out

SRC_LABEL = {
    'opentdb': 'Open Trivia DB (CC BY-SA 4.0)', 'otqa': 'OpenTriviaQA (CC BY-SA 4.0)',
    'ttapi': 'The Trivia API (CC BY-NC 4.0)',
    'cah': 'Cards Against Humanity (CC BY-NC-SA 4.0)', 'wikidata': 'Wikidata (CC0)',
}

def write(name: str, items: list[Item], min_count: int = 300) -> None:
    items = [it for it in items if benign(' '.join(str(it.get(k, '')) for k in ('text', 'q', 'answer', 'word')))]
    for it in items:
        it.setdefault('id', sid(name, json.dumps({k: v for k, v in it.items() if k not in ('a', 'topic')}, sort_keys=True)))
    adult = sum(1 for i in items if i['a'])
    (OUT / f'{name}.json').write_text(json.dumps(items, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    flag = '' if len(items) >= min_count else '   <-- below target'
    print(f'{name:12s} {len(items):6d} items   {adult:5d} adult ({adult * 100 // max(1, len(items))}%){flag}')

def fill(tpl: str, f: str) -> str:
    out = tpl.replace('{}', f)
    return re.sub(r"\ba ([aeiAEI]|[oO](?!ne|nce)|[uU](?!ni|se|su|ku|ro|ti|fo|FO))", r"an \1", out)

def clean(s: str) -> str:
    return html.unescape(s).strip()


def french(name: str) -> list[Item]:
    """Original French content pack (content-src/fr/<name>): items tagged lang 'fr'."""
    if not (SRC / 'fr' / name).exists():
        return []
    fam, adult = read_txt('fr/' + name)
    return [{'text': t, 'a': False, 'lang': 'fr'} for t in fam] + [{'text': t, 'a': True, 'lang': 'fr'} for t in adult]

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

# Benign-violation theory (McGraw & Warren 2010): humour needs a violation that
# still feels safe. Topics that are violations without being benign aren't
# funny at a party, even in 18+ mode — drop them from every pool.
NON_BENIGN = re.compile(r"\b(rap(e|ed|es|ing|ist)|molest\w*|pedophil\w*|paedophil\w*|child porn|incest|holocaust|"
                        r"genocide|nazi\w*|hitler|auschwitz|school shooting|mass shooting|lynch\w*|slavery|suicide|"
                        r"terminal(ly)? ill|cancer (kids?|children)|dead (baby|babies)|9/11|isis|terroris\w*|"
                        r"domestic violence|beating (my|your|his|her) (wife|kids?))\b", re.I)

def benign(text: str) -> bool:
    return not NON_BENIGN.search(text)

# Item-writing flaws that research links to poor items (negatively worded stems,
# "all/none of the above", which-of-the-following lists) + TV readability (long stems).
FLAWED = re.compile(r"\bNOT\b|\bEXCEPT\b|\bnot\b.*\?$|all of the above|none of the above|which of the following|which of these", re.I)

# Players are an international group: questions that only make sense if you grew up in
# the US (or watch one country's TV) are dropped — sports leagues, TV networks, states, etc.
US_STATES = ('Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Idaho|Illinois|'
             'Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|'
             'Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|'
             'Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington State|'
             'West Virginia|Wisconsin|Wyoming')
LOCAL_RE = re.compile(
    r"(?<!South )(?<!Latin )(?<!North )(?<!Central )(?<!Native )\b(American|America's|U\.S\.|USA|United States|US (state|president|army|navy|dollar|city|TV)|NFL|NBA|MLB|NHL|NCAA|NASCAR|"
    r"WWE|Super Bowl|World Series|Stanley Cup|baseball|American football|touchdown|quarterback|college football|"
    r"Congress|Senate|Supreme Court|Founding Fathers|Confedera\w+|(?<!Spanish )(?<!English )(?<!Russian )(?<!Irish )(?<!Greek )(?<!Chinese )(?<!Syrian )Civil War|Billboard|Grammy|Emmy|Golden Globe|Tony Award|"
    r"Broadway|Saturday Night Live|SNL|late[- ]night|talk show|sitcom|soap opera|reality (TV|show)|Nickelodeon|"
    r"Cartoon Network|Disney Channel|HBO|NBC|CBS|ABC|PBS|Fox (network|TV)|MTV|BBC|ITV|Channel 4|Thanksgiving|"
    r"Fourth of July|Independence Day|Memorial Day|Labor Day|zip code|Walmart|Taco Bell|Wendy's|Twinkie|Hershey|"
    r"Kool-Aid|Dunkin|state (capital|bird|flower)|county|Hollywood Walk|country music|hip[- ]hop|rapper|R&B|"
    r"Pittsburgh|Boston|Chicago|Detroit|Philadelphia|Seattle|Dallas|Houston|Atlanta|Baltimore|Cleveland|Denver|"
    r"Miami|Minneapolis|Milwaukee|Phoenix|Portland|San Diego|San Francisco|Las Vegas|Brooklyn|Manhattan|" + US_STATES + r")\b")
NICHE_CATS = {'Entertainment: Television', 'Celebrities', 'Entertainment: Musicals & Theatres'}
# Video games are fine in moderation — only franchises most people have heard of.
FAMOUS_GAMES = re.compile(r"Mario|Pok[eé]mon|Zelda|Minecraft|Tetris|Pac-Man|Sonic|Grand Theft Auto|GTA|FIFA|Call of Duty|"
                          r"The Sims|Street Fighter|Angry Birds|Fortnite|Space Invaders|Donkey Kong|Halo|PlayStation|"
                          r"Nintendo|Xbox|Game Boy|Candy Crush|Among Us|Roblox|Mortal Kombat|Resident Evil", re.I)

def local_only(text: str) -> bool:
    return bool(LOCAL_RE.search(text))

# One shared category vocabulary for both trivia sources (category rounds need big categories).
CAT_MAP = {
    'Entertainment: Film': 'Film & TV', 'Entertainment: Television': 'Film & TV', 'Entertainment: Cartoon & Animations': 'Film & TV',
    'film_and_tv': 'Film & TV', 'Entertainment: Music': 'Music', 'music': 'Music', 'Science & Nature': 'Science',
    'science': 'Science', 'Animals': 'Science', 'Geography': 'Geography', 'geography': 'Geography', 'History': 'History',
    'history': 'History', 'Sports': 'Sport & Leisure', 'sport_and_leisure': 'Sport & Leisure',
    'Entertainment: Board Games': 'Sport & Leisure', 'Entertainment: Books': 'Arts & Literature', 'Art': 'Arts & Literature',
    'arts_and_literature': 'Arts & Literature', 'Mythology': 'Society & Culture', 'society_and_culture': 'Society & Culture',
    'food_and_drink': 'Food & Drink', 'General Knowledge': 'General Knowledge', 'general_knowledge': 'General Knowledge',
    'Vehicles': 'General Knowledge', 'Entertainment: Video Games': 'Video Games',
}

def boring_trivia(q: Item) -> bool:
    cat = clean(q.get('category', ''))
    text = clean(q['question'])
    # IRT: items almost nobody can answer don't separate players and aren't fun → no "hard" items.
    if q.get('difficulty') == 'hard':
        return True
    if FLAWED.search(text) or len(text) > 130:
        return True
    if any(re.search(r'all of the above|none of the above', clean(a), re.I) for a in [q['correct_answer']] + q['incorrect_answers']):
        return True
    if q['type'] == 'boolean' or cat in DRY_CATS or DRY_RE.search(text):
        return True
    if re.search(r"How many letters are in the English|What is the capital of|What colou?r is", text, re.I):
        return True
    if cat == 'Entertainment: Video Games' and not FAMOUS_GAMES.search(text):
        return True
    # OpenTDB's pop-culture questions lean on US charts/shows; only its easy (famous) ones stay —
    # The Trivia API supplies the internationally known music/film questions.
    if cat in ('Entertainment: Music', 'Entertainment: Film', 'Entertainment: Cartoon & Animations') and q.get('difficulty') != 'easy':
        return True
    if re.search(r"top \d+ hit|chart|debut (album|single)|mixtape|featured on|released in \d{4}|what year was .* released", text, re.I):
        return True
    if cat in NICHE_CATS or local_only(' '.join([text, clean(q['correct_answer'])] + [clean(a) for a in q['incorrect_answers']])):
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
            cah_black.append({'text': text, 'pick': b['pick'], 'a': not family, 'src': SRC_LABEL['cah']})
        for i in pack['white']:
            cah_white.append({'text': clean(cah['white'][i]), 'a': not family, 'src': SRC_LABEL['cah']})
    cah_black = dedupe(cah_black, lambda x: x['text'])
    cah_white = dedupe(cah_white, lambda x: x['text'])
    # Our original Campfire Quips prompts double as Rainy Day Cards prompt cards ("…: ____.").
    pf, pa = read_txt('punchline.txt')
    extra = [{'text': f'{t}: ____.', 'pick': 1, 'a': False} for t in pf] + [{'text': f'{t}: ____.', 'pick': 1, 'a': True} for t in pa]
    write('cah-black', dedupe([b for b in cah_black if b['pick'] == 1] + extra, lambda x: x['text']), 1000)
    write('cah-white', cah_white, 1000)

# ----------------------------------------------------------------- Campfire Quips
fam, adult = read_txt('punchline.txt')
punch = [{'text': t, 'a': False} for t in fam] + [{'text': t, 'a': True} for t in adult]
punch += [{'text': b['text'], 'a': b['a'] or bool(ADULT_RE.search(b['text'])), 'src': SRC_LABEL['cah']} for b in cah_black if b['pick'] == 1]
write('punchline', dedupe(punch + french('punchline.txt'), lambda x: x['text']))

# ----------------------------------------------------------------- Trivia + Fish Tales (OpenTDB split) + adult
def short_answer(a: str) -> bool:
    return len(a) <= 26 and len(a.split()) <= 4 and not re.fullmatch(r'[-\d.,%]+', a)

trivia: list[Item] = []
fib: list[Item] = []
closest: list[Item] = []
for q in opentdb:
    if boring_trivia(q):
        continue
    text = clean(q['question'])
    correct = clean(q['correct_answer'])
    wrong = [clean(w) for w in q['incorrect_answers']]
    is_adult = bool(ADULT_RE.search(text + ' ' + correct))
    raw_cat = clean(q.get('category', ''))
    cat = CAT_MAP.get(raw_cat, raw_cat)
    if q['type'] == 'boolean':
        choices = ['True', 'False']
        trivia.append({'q': text, 'choices': choices, 'correct': choices.index(correct), 'cat': cat, 'a': is_adult, 'src': SRC_LABEL['opentdb']})
        continue
    nums = [correct] + wrong
    if all(re.fullmatch(r'-?\d[\d,]*(\.\d+)?', n) for n in nums) and not re.search(r'which of|following', text, re.I):
        closest.append({'q': text, 'answer': float(correct.replace(',', '')), 'a': is_adult, 'src': SRC_LABEL['opentdb']})
    fib_ok = (short_answer(correct) and not re.search(r'which of (these|the following)|not |following|true|false|\bthese\b', text, re.I)
              and len(text) < 160)
    # Deterministic split so the two games never share a question.
    fib_ok = fib_ok and not raw_cat.startswith('Entertainment: Video Games') and not raw_cat.startswith('Entertainment: Cartoon')
    if fib_ok and q['difficulty'] != 'easy' and int(sid('split', text), 16) % 100 < 80:
        fib.append({'q': text, 'answer': correct, 'cat': cat, 'a': is_adult, 'src': SRC_LABEL['opentdb']})
    else:
        choices = wrong + [correct]
        rng.shuffle(choices)
        trivia.append({'q': text, 'choices': choices, 'correct': choices.index(correct), 'cat': cat, 'a': is_adult, 'src': SRC_LABEL['opentdb']})

# The Trivia API: an international bank. Keep only questions tagged as globally relevant
# (no `regions`) and not niche; skip hard ones (they don't separate players at a party).
ttapi_path = VENDOR / 'the-trivia-api.json'
ttapi = json.loads(ttapi_path.read_text(encoding='utf-8')) if ttapi_path.exists() else []
for q in ttapi:
    text = clean(q['question']['text'])
    correct = clean(q['correctAnswer'])
    wrong = [clean(w) for w in q['incorrectAnswers']][:3]
    if q.get('regions') or q.get('isNiche') or q.get('difficulty') == 'hard' or len(wrong) < 3:
        continue
    if FLAWED.search(text) or len(text) > 130 or local_only(' '.join([text, correct] + wrong)) or not benign(text):
        continue
    if DRY_RE.search(text) or re.search(r"How many letters are in the English|What is the capital of|What colou?r is", text, re.I):
        continue
    choices = wrong + [correct]
    rng.shuffle(choices)
    trivia.append({'q': text, 'choices': choices, 'correct': choices.index(correct),
                   'cat': CAT_MAP.get(q['category'], 'General Knowledge'),
                   'a': bool(ADULT_RE.search(text + ' ' + correct)), 'src': SRC_LABEL['ttapi']})

for line in (SRC / 'adult-trivia.txt').read_text(encoding='utf-8').splitlines():
    if '|' not in line or line.startswith('#'):
        continue
    parts = [p.strip() for p in line.split('|')]
    q, correct, wrong = parts[0], parts[1], parts[2:5]
    if local_only(' '.join([q, correct] + wrong)):
        continue
    choices = wrong + [correct]
    rng.shuffle(choices)
    trivia.append({'q': q, 'choices': choices, 'correct': choices.index(correct), 'cat': 'After Dark', 'a': True})
    if short_answer(correct) and '____' not in q and not re.search(r'which of|following', q, re.I):
        fib.append({'q': q, 'answer': correct, 'cat': 'After Dark', 'a': True})

# Original hand-written fill-in-the-blank facts from v1 stay in the pool too (JSON, so no Node needed:
# shelling out to `node` silently dropped them wherever Node wasn't installed — CI caught the difference).
v1 = json.loads((ROOT / 'games' / 'data' / 'fibbage-questions.json').read_text(encoding='utf-8'))
fib = [{'q': q['q'], 'answer': q['answer'], 'cat': 'Weird facts', 'a': False} for q in v1] + fib

# Topic diversity: a party doesn't want ten deep-cut questions about one game series. Each question
# gets a topic (a franchise or the title it quotes); a pool keeps at most TOPIC_CAP per topic, and a
# game never asks two questions on the same topic (games/trivia.js).
FRANCHISES = [
    'call of duty', 'pok[eé]mon', 'zelda', 'mario', 'minecraft', 'halo', 'final fantasy', 'sonic', 'fallout',
    'elder scrolls', 'skyrim', 'grand theft auto', 'gta', 'overwatch', 'league of legends', 'team fortress',
    'half-life', 'borderlands', 'kingdom hearts', 'metal gear', 'resident evil', 'street fighter',
    'mortal kombat', 'star wars', 'harry potter', 'doctor who', 'star trek', 'lord of the rings', 'hobbit',
    'marvel', 'simpsons', 'game of thrones', 'world of warcraft', 'warcraft', 'starcraft', 'diablo',
    'counter-strike', 'fortnite', 'battlefield', 'tomb raider', 'kirby', 'metroid', 'donkey kong',
    'animal crossing', 'splatter?n', 'dark souls', 'bioshock', 'mass effect', 'dota', 'tetris',
    'pac-man', 'james bond', 'batman', 'superman', 'spider-man', 'x-men', 'avengers', 'disney', 'pixar',
    'the sims', 'undertale', 'five nights', 'gears of war', 'uncharted', 'god of war',
]
FRANCHISE_RE = re.compile(r'\b(' + '|'.join(FRANCHISES) + r')', re.I)
TOPIC_CAP = 4


def topic(q: str) -> str:
    """The franchise or quoted title a question is about ('' = general)."""
    m = FRANCHISE_RE.search(q)
    if m:
        return re.sub(r'[^a-z]', '', m.group(1).lower().replace('é', 'e'))[:16]
    t = re.search(r'"([^"]{4,60})"', q)
    if t:
        return re.sub(r'[^a-z0-9]', '', t.group(1).split(':')[0].lower())[:16]
    return ''


def cap_topics(items: list[Item]) -> list[Item]:
    kept: list[Item] = []
    count: dict[str, int] = {}
    for it in sorted(items, key=lambda x: sid(x['q'])):  # stable, source-independent order
        tp = topic(str(it['q']))
        if tp:
            if count.get(tp, 0) >= TOPIC_CAP:
                continue
            count[tp] = count.get(tp, 0) + 1
            it['topic'] = tp
        kept.append(it)
    return kept


write('trivia', cap_topics(dedupe(trivia, lambda x: x['q'])))

# ----------------------------------------------------------------- Closest Cast
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
# OpenTriviaQA numbers were mostly obscure TV/celebrity minutiae → dropped (replaced by Wikidata facts).
otqa = VENDOR / 'opentriviaqa-numeric.json'
if False and otqa.exists():  # noqa: SIM — kept for reference
    for q in json.loads(otqa.read_text()):
        closest.append({'q': q['q'], 'answer': float(q['answer'].replace(',', '')), 'a': bool(ADULT_RE.search(q['q'])), 'src': SRC_LABEL['otqa']})
# Wikidata (CC0): popular superlative facts (Korn et al. 2019 / Prakash et al. 2015: well-known
# entities + extremes make the most interesting trivia). Popularity = sitelinks (filtered in the query).
WD = VENDOR / 'wikidata.json'
wd: dict[str, list[Item]] = json.loads(WD.read_text(encoding='utf-8')) if WD.exists() else {}
def wd_src(r: Item) -> str:
    return f"Wikidata {r['qid']} (CC0)"
def num(v: str) -> float | None:
    try:
        return float(v)
    except ValueError:
        return None
WD_TEMPLATES: dict[str, tuple[str, str, float]] = {
    'mountain_height': ('How tall is {}, in metres?', 'm', 1),
    'river_length': ('How long is the {} river, in km?', 'km', 1),
    'building_height': ('How tall is {}, in metres?', 'm', 1),
    'film_year': ('In what year did the film "{}" come out?', '', 1),
    'living_birth_year': ('In what year was {} born?', '', 1),
    'city_population': ('What is the population of {}, in millions (roughly)?', 'million', 1e-6),
}
# Be brutal: rows are ordered by popularity (sitelinks) — keep only the famous head of each list.
WD_TOP = {'mountain_height': 60, 'building_height': 50, 'city_population': 120, 'film_year': 80, 'river_length': 60, 'living_birth_year': 150}
for key, (tpl, unit, scale) in WD_TEMPLATES.items():
    for r in wd.get(key, [])[:WD_TOP.get(key, 50)]:
        if key == 'city_population' and (num(r['v']) or 0) < 1_000_000:
            continue  # small numbers make dull guesses
        v = num(r['v'])
        if v is None or v <= 0:
            continue
        label = r['label'][:-6] if key == 'river_length' and r['label'].endswith(' River') else r['label']
        ans = round(v * scale, 1) if scale != 1 else round(v)
        closest.append({'q': tpl.format(label), 'answer': ans, 'unit': unit, 'a': False, 'src': wd_src(r)})
for r in wd.get('birth_name', []):
    bn = r['v'].strip()
    # Only real reveals: the birth name shares no word with the famous name (stage names, not maiden names).
    famous = {w for w in re.findall(r"[a-z]{3,}", r['label'].lower())}
    if bn and len(bn) <= 40 and not famous & set(re.findall(r"[a-z]{3,}", bn.lower())):
        fib.append({'q': f"{r['label']}'s real birth name is ____.", 'answer': bn, 'cat': 'Real names', 'a': False, 'src': wd_src(r)})
for r in wd.get('city_nickname', []):
    nick = r['v'].strip()
    if nick and r['label'].lower() not in nick.lower() and len(nick) <= 30:
        fib.append({'q': f"{r['label']} is nicknamed \"____\".", 'answer': nick, 'cat': 'City nicknames', 'a': False, 'src': wd_src(r)})
# First lines of classics (Project Gutenberg, public domain; content-src/vendor/gutenberg.json from
# tools/fetch-gutenberg.py). Only the books in content-src/gutenberg-ok.txt: each first line checked by
# hand, with the title as people know it.
gut_path = VENDOR / 'gutenberg.json'
gut: dict[str, Item] = json.loads(gut_path.read_text(encoding='utf-8')) if gut_path.exists() else {}
for line in (SRC / 'gutenberg-ok.txt').read_text(encoding='utf-8').splitlines() if (SRC / 'gutenberg-ok.txt').exists() else []:
    if not line.strip() or line.startswith('#'):
        continue
    parts = [x.strip() for x in line.split('|', 2)]
    gid, title = parts[0], parts[1]
    book = gut.get(gid) or {}
    first = parts[2] if len(parts) > 2 and parts[2] else str(book.get('line') or '')
    if first:
        fib.append({'q': f'The classic book that begins "{first}" is called ____.', 'answer': title, 'cat': 'First lines', 'a': False, 'src': f'Project Gutenberg #{gid} (public domain)'})

# Curious real words (Wiktionary's Words of the Day, CC BY-SA 4.0; content-src/vendor/wotd.json from
# tools/fetch-wotd.py): one word, a short definition that doesn't give the word away.
wotd_path = VENDOR / 'wotd.json'
wotd_fib: list[Item] = []
for w in (json.loads(wotd_path.read_text(encoding='utf-8')) if wotd_path.exists() else []):
    word, pos, d = str(w['word']), str(w['pos']), str(w['def']).split('#')[0]
    if '=' in d or d.lstrip().startswith(('.', ',', ';')):
        continue  # a template left-over, not a definition (an older download's parse)
    meaning = re.split(r'[;:]|, (?:especially|usually|often|typically|such as|e\.g\.)', d)[0].strip().rstrip('.')
    meaning = re.sub(r'^\(.*?\)\s*', '', meaning)
    if (' ' in word or not word.islower() or not word.isalpha() or pos not in ('n', 'v', 'adj', 'adv')
            or not 10 <= len(meaning) <= 40 or word.lower()[:5] in meaning.lower() or not benign(meaning) or local_only(meaning)
            or re.search(r'\b(a|an|the|of|to|or|and|that|with|by|for|in|on|which|who)$', meaning, re.I)):  # (cut off mid-sentence)
        continue
    meaning = meaning[0].lower() + meaning[1:]
    wotd_fib.append({'q': f'In English, "{word}" means ____.', 'answer': meaning, 'cat': 'Curious words',
                     'a': bool(ADULT_RE.search(meaning) or re.search(r'marijuana|cannabis|drug', meaning, re.I)), 'src': f'Wiktionary: {word} (CC BY-SA 4.0)'})
# At most 300 (the same ones each build): more and Fish Tales would be mostly definitions.
fib.extend(sorted(wotd_fib, key=lambda x: sid('wotd', x['q']))[:300])

write('fibbage', dedupe(fib, lambda x: x['q']))

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
# Our World in Data (CC BY 4.0, content-src/vendor/owid.json, tools/fetch-owid.py): one question per
# indicator for a spread of countries, the year in the question so it stays true.
OWID_Q: dict[str, tuple[str, str, Callable[[float], float]]] = {
    'life-expectancy': ('What is life expectancy at birth in {c} ({y}), in years?', 'years', lambda v: round(v, 1)),
    'population': ('How many people live in {c} ({y}), in millions?', 'million', lambda v: round(v / 1e6, 1)),
    'median-age': ('What is the median age of the people of {c} ({y})?', 'years', lambda v: round(v, 1)),
    'co-emissions-per-capita': ('How many tonnes of CO₂ does an average person in {c} emit in a year ({y})?', 't', lambda v: round(v, 1)),
    'children-per-woman-un': ('On average, how many children does a woman in {c} have ({y})?', '', lambda v: round(v, 2)),
    'daily-per-capita-caloric-supply': ('How many calories of food a day are there per person in {c} ({y})?', 'kcal', lambda v: float(round(v))),
    'share-of-individuals-using-the-internet': ('What percentage of people in {c} use the internet ({y})?', '%', lambda v: float(round(v))),
    'meat-supply-per-person': ('How many kilograms of meat does an average person in {c} eat in a year ({y})?', 'kg', lambda v: float(round(v))),
}
OWID_THE = {'United States', 'United Kingdom', 'Netherlands', 'Philippines'}
owid_path = VENDOR / 'owid.json'
owid: dict[str, dict[str, Item]] = json.loads(owid_path.read_text(encoding='utf-8')) if owid_path.exists() else {}
for slug, by_country in owid.items():
    if slug not in OWID_Q:
        continue
    tpl, unit, fmt = OWID_Q[slug]
    # The same ~22 countries each build (a hash order), a different pick per indicator.
    for country in sorted(by_country, key=lambda c: sid('owid', slug, c))[:22]:
        owid_row = by_country[country]
        name = ('the ' + country) if country in OWID_THE else country
        closest.append({'q': tpl.format(c=name, y=owid_row['year']), 'answer': fmt(float(owid_row['value'])), 'unit': unit, 'a': False, 'src': 'Our World in Data (CC BY 4.0)'})

closest = [c for c in closest if not OBVIOUS.search(c['q'])]
write('closest', dedupe(closest, lambda x: x['q']))

# ----------------------------------------------------------------- Campfire Consensus
fam, adult = read_txt('majority.txt')
def plain(t: str) -> bool:
    return len(t.split()) <= 6 and not TWIST_RE.search(t)
maj = [{'text': t, 'a': False} for t in fam if not plain(t)] + [{'text': t, 'a': True} for t in adult]
T = json.loads((SRC / 'majority-templates.json').read_text(encoding='utf-8'))
for tpl, fills in T.items():
    for f in fills:
        maj.append({'text': fill(tpl, f), 'a': False})
write('majority', dedupe(maj + french('majority.txt'), lambda x: x['text']))

# ----------------------------------------------------------------- Cabin Superlatives
fam, adult = read_txt('mostlikely.txt')
ml: list[Item] = [{'text': f'Who is most likely to {t}?', 'a': False} for t in fam]
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
write('mostlikely', dedupe(ml + french('mostlikely.txt'), lambda x: x['text']))

# ----------------------------------------------------------------- Porch Confessions
fam, adult = read_txt('confessions.txt')
write('confessions', dedupe([{'text': t, 'a': False} for t in fam] + [{'text': t, 'a': True} for t in adult], lambda x: x['text']), min_count=100)

# ----------------------------------------------------------------- Odd Duck Out
fam, adult = read_txt('imposter.txt')
cats: list[Item] = []
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

# ----------------------------------------------------------------- Message in a Bottle
fam, adult = read_txt('telephone.txt')
tel = [{'text': t, 'a': False} for t in fam] + [{'text': t, 'a': True} for t in adult]
G = json.loads((SRC / 'telephone-words.json').read_text(encoding='utf-8'))
combos: set[tuple[str, str, str]] = set()
while len(combos) < 1300:
    combos.add((rng.choice(G['who']), rng.choice(G['doing']), rng.choice(G['where'])))
for who, doing, where in sorted(combos):
    tel.append({'text': f'{who} {doing} {where}', 'a': False})
write('telephone', dedupe(tel + french('telephone.txt'), lambda x: x['text']))

# ----------------------------------------------------------------- Cottage Crush (notes + replies, original)
for pool_name, src in (('crush-openers', 'crush-openers.txt'), ('crush-replies', 'crush-replies.txt')):
    f_lines, a_lines = read_txt(src)
    write(pool_name, [{'text': t, 'a': False} for t in f_lines] + [{'text': t, 'a': True} for t in a_lines], 20)

# ----------------------------------------------------------------- The Deep End (answer charts)
# Hand-written charts (content-src/deepend.txt, depth 0 = obvious … 4 = lake bottom), plus every
# member of a category Wikidata knows (content-src/vendor/deepend-wikidata.json, tools/fetch-deepend.py)
# with its depth set from how many Wikipedias have an article on it, calibrated on the hand-tiered
# answers of the same category. An item's answers: [depth, name, alias…]. Wikidata never adds a
# depth-0 answer (the obvious ones are hand-picked) and never moves a hand-tiered one.
def dd_word(w: str) -> str:
    """One word made singular, exactly as games/deepend.js keyOf() does."""
    if len(w) > 4 and w.endswith('ies'):
        return w[:-3] + 'y'
    if len(w) > 4 and re.search(r'(ches|shes|xes|sses|oes)$', w):
        return w[:-2]
    if len(w) > 3 and w.endswith('s') and not w.endswith('ss') and not w.endswith('us'):
        return w[:-1]
    return w

def dd_key(s: str) -> str:
    """The game's match key (games/deepend.js keyOf), so two spellings the game treats as one answer are
    merged here too — plus "st." = "saint" for merging names."""
    s = unicodedata.normalize('NFD', s)
    s = re.sub(r'[\u0300-\u036f]', '', s).lower().replace('&', ' and ')
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'\bst\.?\s', 'saint ', s)
    words = [w for w in re.sub(r'[^a-z0-9 ]+', ' ', s).split() if w]
    while len(words) > 1 and words[0] in ('the', 'a', 'an', 'some'):
        words.pop(0)
    return ''.join(dd_word(w) for w in words)

# Wikidata names carry their class or a food label ("comté cheese", "grana padano PDO", "newfoundland
# dog"); nobody says those, so they come off. Names that read like a list or a classification go.
DD_TAIL = re.compile(r'\s+(cheese|dog|breed|pasta|bread|soup|sauce|cocktail|dance|pdo|pgi|aop|doc|docg|dop|igp|aoc|tsg)$')
DD_JUNK = re.compile(r'\b(official|list|type|types|style|styles|family|variety|cuisine|category|class|genre|in|of the|hybrid|mythical|drink|drinks|beverage)\b')
# People categories stay hand-written: "painter" on Wikidata is anyone who ever painted (presidents,
# poets, film directors came out as the shallowest "famous painters").
DD_SKIP_WIKIDATA = {'Name a famous painter', 'Name a famous scientist',
                    'Name a capital city'}  # (P36 also lists districts' capitals: Baramulla, Sopore…)
# The words a longer name may add to a hand-written answer and still be the same thing ("jack russell
# terrier" = "jack russell"); anything else is a different thing ("american bulldog", "porn star martini").
DD_FILLER = {'terrier', 'hound', 'dog', 'cat', 'cheese', 'grape', 'fish', 'bird', 'tree', 'flower', 'mountain', 'mount', 'lake', 'sea', 'ocean', 'the', 'common'}

def dd_clean(s: str) -> str | None:
    """A Wikidata name as a player would type it, or None if nobody would."""
    s = re.sub(r"\s*\([^)]*\)", '', html.unescape(s)).strip().lower()
    for _ in range(2):
        s = DD_TAIL.sub('', s).strip()
    if not s or len(s) > 32 or re.search(r'[0-9,;:/"]', s) or not re.search(r'[a-z]', s) or DD_JUNK.search(s):
        return None
    return s

def dd_median(xs: list[int]) -> float | None:
    xs = sorted(xs)
    return float(xs[len(xs) // 2]) if xs else None

# Wiktionary's thesaurus (content-src/vendor/deepend-wiktionary.json, tools/fetch-wiktionary.py): the
# word categories' synonyms with their labels. The labels set the depth; anything Wiktionary marks as
# offensive, or that is a slur, never goes in (and 18+ words stay out of the family categories).
DD_RARE = re.compile(r'\b(archaic|obsolete|dated|rare|historical|nonce|poetic|literary)\b', re.I)
DD_SLANG = re.compile(r'\b(slang|colloquial|informal|rhyming|regional|dialect\w*|cockney|scotland|ireland|australia|new zealand|britain|uk|us|canada|south africa|india)\b', re.I)
DD_OFFENSIVE = re.compile(r'\b(offensive|derogatory|pejorative|vulgar|ethnic slur|slur|disparaging|ableist)\b', re.I)
SLUR_RE = re.compile(r'\b(retard\w*|tard|spaz|spastic|mong|mongol\w*|cretin\w*|fag\w*|dyke|poof\w*|nigg\w*|negro\w*|coon|chink|gook|spic|kike|paki|gyp\w*|wog|wop|dago|cripple|midget|whore\w*|slut\w*|cunt\w*|twat\w*|bitch\w*|tranny|shemale|injun|squaw|honky)\b', re.I)
dd_wikt: dict[str, list[Item]] = json.loads((VENDOR / 'deepend-wiktionary.json').read_text(encoding='utf-8')) if (VENDOR / 'deepend-wiktionary.json').exists() else {}
dd_wikt_added = 0
dd_wd: dict[str, list[Item]] = json.loads((VENDOR / 'deepend-wikidata.json').read_text(encoding='utf-8')) if (VENDOR / 'deepend-wikidata.json').exists() else {}
# GBIF (tools/fetch-gbif.py: the most-recorded birds and insects, their record count as `sl`) and
# OpenStreetMap (tools/fetch-osm.py: islands, lakes, volcanoes, rivers; the number of languages their
# name is written in as `sl`), shaped like the Wikidata rows, for categories Wikidata doesn't fill.
for dd_file in ('deepend-gbif.json', 'deepend-osm.json'):
    for dd_cat, dd_rows in (json.loads((VENDOR / dd_file).read_text(encoding='utf-8')) if (VENDOR / dd_file).exists() else {}).items():
        if dd_rows and not dd_wd.get(dd_cat):
            dd_wd[dd_cat] = dd_rows
deepend: list[Item] = []
dd_adult = False
dd_cur: Item | None = None
for raw in (SRC / 'deepend.txt').read_text(encoding='utf-8').splitlines():
    line = raw.strip()
    if line.lower() == '## adult':
        dd_adult = True
        continue
    if not line or line.startswith('#'):
        continue
    if line.startswith('Q:'):
        dd_cur = {'q': line[2:].strip(), 'answers': [], 'a': dd_adult}
        deepend.append(dd_cur)
        continue
    m = re.match(r'^([0-4]):(.*)$', line)
    if not m or dd_cur is None:
        sys.exit(f'deepend.txt: bad line {line!r}')
    for dd_ans in m.group(2).split(','):
        forms = [f.strip().lower() for f in dd_ans.split('/') if f.strip()]
        if forms:
            dd_cur['answers'].append([int(m.group(1)), *forms])
dd_added = 0
for it in deepend:
    # One answer per key: the first (shallowest) time an answer is listed wins.
    seen_keys: dict[str, int] = {}
    kept: list[list[Any]] = []
    for dd_row in it['answers']:
        keys = [dd_key(f) for f in dd_row[1:]]
        if any(k in seen_keys for k in keys):
            continue
        for k in keys:
            seen_keys[k] = int(dd_row[0])
        kept.append(dd_row)
    rows = [] if it['q'] in DD_SKIP_WIKIDATA else dd_wd.get(it['q'], [])
    if rows:
        by_tier: dict[int, list[int]] = {t: [] for t in range(5)}
        for r in rows:
            for f in [r['label'], *r.get('aliases', [])]:
                t = seen_keys.get(dd_key(f))
                if t is not None:
                    by_tier[t].append(int(r['sl']))
                    break
        sls = sorted(int(r['sl']) for r in rows)
        def dd_pct(q: float, xs: list[int] = sls) -> float:
            return float(xs[min(len(xs) - 1, int(len(xs) * q))])
        t1 = dd_median(by_tier[1]) or dd_pct(0.95)
        t2 = dd_median(by_tier[2]) or dd_pct(0.75)
        t3 = dd_median(by_tier[3]) or dd_pct(0.4)
        # A hand-written answer plus a filler word ("jack russell terrier") is another way to say it, at the
        # hand-picked depth — not a new, rarer answer.
        rows_by_words = {' '.join(dd_clean(f) or f for f in [w]).strip(): row for row in kept for w in row[1:]}
        def dd_parent(name: str) -> list[Any] | None:
            words = name.split()
            for i in range(len(words)):
                rest = words[:i] + words[i + 1:]
                if words[i] in DD_FILLER and rest and ' '.join(rest) in rows_by_words:
                    return rows_by_words[' '.join(rest)]
            return None
        for r in rows:
            label = dd_clean(r['label'])
            if not label or dd_key(label) in seen_keys:
                continue  # the thing itself is on the chart already (or isn't something people say)
            # Aliases that are another answer's name ("santiago" for Caracas) are dropped, not the item.
            names = [label] + [n for n in (dd_clean(x) for x in r.get('aliases', [])) if n and len(n) >= 4 and dd_key(n) not in seen_keys]
            parent = dd_parent(label)
            if parent is not None:
                for n in names:
                    if dd_key(n) not in seen_keys:
                        seen_keys[dd_key(n)] = int(parent[0])
                        parent.append(n)
                continue
            names = list(dict.fromkeys(names))[:4]
            sl = int(r['sl'])
            tier = 1 if sl >= t1 else 2 if sl >= t2 else 3 if sl >= t3 else 4
            # GBIF's record counts follow where birders and moth-trappers live, and OpenStreetMap's name
            # translations where map bots worked (remote Arctic islands have dozens): neither is what people
            # know. A species or place the hand chart doesn't list is never shallower than the drop-off.
            if str(r.get('qid', '')).startswith(('gbif:', 'osm:')):
                tier = max(3, tier)
            for n in names:
                seen_keys[dd_key(n)] = tier
            kept.append([tier, *names])
            dd_added += 1
        it['src'] = SRC_LABEL['wikidata'] + ' + original'
    dd_words: list[Item] = dd_wikt.get(it['q'], [])
    for dd_w in dd_words:
        labels = ' '.join(str(x) for x in dd_w.get('labels', []))
        name = re.sub(r'\s+', ' ', html.unescape(str(dd_w['w']))).strip().lower()
        if (not name or len(name) > 32 or len(name.split()) > 4 or re.search(r'[0-9;:/"]', name) or DD_OFFENSIVE.search(labels) or SLUR_RE.search(name)
                or (not it['a'] and ADULT_RE.search(name)) or not benign(name) or dd_key(name) in seen_keys
                or re.search(r'\b' + re.escape(name) + r'\b', it['q'].lower())):  # (not the category's own word: "money")
            continue
        tier = 4 if DD_RARE.search(labels) else 3 if DD_SLANG.search(labels) else 2
        seen_keys[dd_key(name)] = tier
        kept.append([tier, name])
        dd_wikt_added += 1
    if dd_words:
        it['src'] = ((it.get('src') or 'original') + ' + Wiktionary (CC BY-SA 4.0)').replace('original + ', '')
    it['answers'] = kept
    if not any(r[0] == 0 for r in kept) or len(kept) < 20:
        sys.exit(f"deepend.txt: {it['q']!r} needs obvious (0) answers and at least 20 in all")
write('deepend', dedupe(deepend, lambda x: x['q']), 60)
print(f'deepend: {dd_added} answers added from Wikidata, {dd_wikt_added} from Wiktionary')

print('\nPools written to', OUT.relative_to(ROOT))
