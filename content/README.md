# Custom content packs

Drop JSON files here to add your own prompts — no rebuild needed (this folder
is mounted into the container; restart it to pick up changes).
By default your entries are **added** to the built-in ones. Set
`RUMPUS_CONTENT_MODE=replace` to use only yours.

| File               | Game              | Format                                                      |
|--------------------|-------------------|-------------------------------------------------------------|
| `mostlikely.json`  | Cabin Superlatives    | `["Who is most likely to …?", …]`                           |
| `majority.json`    | Campfire Consensus    | `["Name a …", …]`                                           |
| `closest.json`     | Closest Cast     | `[{"q": "How many …?", "answer": 42, "unit": "km"}, …]`     |
| `imposter.json`    | Odd Duck Out       | `[{"category": "Snacks", "words": ["Chips", "Popcorn", …]}]` (4+ words) |
| `telephone.json`   | Message in a Bottle  | `["A moose in a canoe", …]` (starter suggestions)          |

See `example-mostlikely.json` (rename it to `mostlikely.json` to use it).
