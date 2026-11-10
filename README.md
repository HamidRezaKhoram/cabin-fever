# Rumpus

Self-hosted Jackbox-style party game platform: one shared TV screen and
everyone else plays from their phone. Runs entirely on your own LAN — no
account, no cloud service, no per-player app install.

- **`/host`** — put this on the TV. Shows the room code and drives the shared screen.
- **`/play`** — everyone else opens this on their phone, enters the room code, and plays.

Built with Node, Express, and Socket.IO. No client build step — the browser
gets plain JS/HTML/CSS, nothing to compile. Rooms are in-memory and ephemeral
(a server restart clears them).

## Running it

```
npm install
npm start
```

Then open `http://<this-machine's-LAN-IP>:3000/host` on the TV and
`http://<this-machine's-LAN-IP>:3000/play` on phones.

Or with Docker:

```
docker build -t rumpus:local .
docker run -d --name rumpus --restart unless-stopped -p 8012:3000 rumpus:local
```

## Games

- **Quiplash** — everyone answers a prompt, then votes for their favorite (self-votes blocked). 2+ players.
- **Lakeside Quiz** — multiple-choice, speed-scored. 2+ players.
- **Cards Against Humanity** — fill-in-the-blank, pick-1 prompts only. Needs a Card Czar plus at least 2 others (3+ players). Ships with a small original sample deck — see below to use a real CAH deck.
- **Fibbage** — you get a fact with a blank; write a fake answer, then hunt for the real one hidden among everyone's lies. Score for finding the truth, and for every player your lie fools. 2+ players.

New games are pluggable: drop a module in `games/` exporting a `.meta = { id, name, blurb, minPlayers }` plus the lifecycle methods (`start`, `destroy`, `handleSubmit`, `onPlayerLeft`, `hostGameState`, `playerView`), and register it in the `GAMES` map in `server.js`. The host's game picker and min-player gating pick it up automatically.

## Bring your own CAH deck

The actual Cards Against Humanity card text is CC BY-NC-SA (non-commercial) and
isn't shipped in this repo — just a small original sample deck so the game
works out of the box. To use a full deck, drop a file at
`games/data/cah-cards.js` exporting:

```js
module.exports = { WHITE: [...strings], BLACK: [...strings] };
```

That path is gitignored, so your deck stays local.

## Testing

```
npm run test:e2e
```

Boots the server in-process and plays all four games back-to-back with
simulated players, asserting each reaches its terminal state. No browser
required.

## Known limitations

No reconnect-on-refresh (a phone reload drops you from the room), rooms are
in-memory only (a server restart wipes them), the host disconnecting closes
the room, and there's no spectator mode.

## License

AGPLv3 — see `LICENSE`.

## v2: what's new

**Games (10):** Campfire Quips (prompt + vote), Fish Tales (bluffing trivia), Lakeside Quiz,
Closest Cast (numeric estimation), Campfire Consensus (match the herd), Cabin Superlatives,
Odd Duck Out (find the imposter), Porch Confessions, Message in a Bottle (draw/describe chains),
Rainy Day Cards (fill-in-the-blank cards).

**Platform:**
- Phones and the TV **reconnect automatically** after a refresh, screen lock or Wi-Fi blip (seat kept for 2 min; TV room kept for 5 min).
- **QR code** on the TV; scanning it pre-fills the room code.
- Host **settings** (rounds, timer speed), **Skip** and **End game** buttons, fullscreen and mute toggles.
- Countdown on phones, vibration when it's your turn, synthesized sound effects on the TV (no audio files).
- Typing/drawing is no longer wiped when someone else submits.
- **Custom content packs** in `content/*.json` — see `content/README.md`.
- Up to 12 players (`MAX_PLAYERS`).

### Run with Docker Compose

```
docker compose up -d --build      # or: podman-compose / docker-compose
```

Uses host networking on port **8012** so the TV can show your real LAN address.
Open `http://<this-machine>:8012/host` on the TV; phones scan the QR code.

### Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PORT` | 3000 (8012 in compose) | Listen port |
| `MAX_PLAYERS` | 12 | Room size |
| `PUBLIC_URL` | auto | Force the join URL shown on the TV |
| `PLAYER_GRACE_MS` / `HOST_GRACE_MS` | 120000 / 300000 | Reconnect windows |
| `RUMPUS_CONTENT_MODE` | append | `replace` = only use your content packs |

## v3: content, music & pixel art

- **10,000+ questions/prompts** — every game that needs them has 1,000+ (see `/api/content-stats`).
  Bland/generic items were filtered out (dry trivia categories, plain "name a fruit" prompts, obvious numbers).
- **No repeats**: used questions are recorded in `data/history.json`; nothing repeats until a
  game's whole pool has been played (thousands of rounds), even across restarts.
- **🌶 18+ mode** (toggle in the lobby, on by default): ~30% of what's drawn is adult content.
- **Soundtrack**: 50 original chiptune tracks synthesized in the browser, organised by cue —
  title, menu, a theme per game, voting tension, reveals, final round, victory fanfares,
  scoreboard, game-start stingers. Each cue rotates its tracks; music speeds up in the last 10s.
  Music + SFX volume sliders on the TV. Drop mp3s into `music/` to use your own instead.
- **Pixel-art look**: pixel fonts, 17 animal avatars, game icons, animated lakeside night scene,
  pixel screen wipes, confetti, screen shake, floating emoji reactions from phones.
- **Game feel**: how-to-play title cards, final round worth double, Campfire Quips sweeps, trivia
  answer streaks, Closest Cast bullseyes, "new leader" alerts, podium + end-of-game awards.

Content sources and licenses: see CREDITS.md.
