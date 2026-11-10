# Music folders (optional)

HomeJack plays 50+ original chiptunes, chosen per scenario. To use your own
music for a scenario, drop audio files (`.mp3 .ogg .m4a .wav .opus`) into its
folder. Scenarios without files keep using the chiptunes, so you can mix.

| Folder | When it plays |
|---|---|
| `title/` | TV title screen before anyone joins |
| `menu/` | Lobby / game select |
| `intro/` | Short sting when a game starts |
| `game/` | While answering (any game) — or `game/<id>/` for one game: `quiplash`, `fibbage`, `trivia`, `closest`, `majority`, `mostlikely`, `imposter`, `twotruths`, `telephone`, `cah` |
| `category/` | Trivia category pick |
| `vote/` | Voting / picking |
| `reveal/` | Reveals and results |
| `round2/` | (chiptunes speed up automatically in round 2) |
| `final/` | The final ×3 question — make it the most hype |
| `victory/` | Winner fanfare |
| `scoreboard/` | Final scores screen |
| (root) | Files directly in `music/` are a fallback for every scenario |

Reload the TV page after adding files.
