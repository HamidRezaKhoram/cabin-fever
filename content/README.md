# Custom content packs

Drop JSON files here to add your own prompts — no rebuild needed (this folder
is mounted into the container; restart it to pick up changes).
By default your entries are **added** to the built-in ones. Set
`RUMPUS_CONTENT_MODE=replace` to use only yours.

| File               | Game              | Format                                                      |
|--------------------|-------------------|-------------------------------------------------------------|
| `mostlikely.json`  | Most Likely To    | `["Who is most likely to …?", …]`                           |
| `majority.json`    | Majority Rules    | `["Name a …", …]`                                           |
| `closest.json`     | Closest Guess     | `[{"q": "How many …?", "answer": 42, "unit": "km"}, …]`     |
| `imposter.json`    | Odd One Out       | `[{"category": "Snacks", "words": ["Chips", "Popcorn", …]}]` (4+ words) |
| `telephone.json`   | Doodle Telephone  | `["A moose in a canoe", …]` (starter suggestions)          |

See `example-mostlikely.json` (rename it to `mostlikely.json` to use it).
