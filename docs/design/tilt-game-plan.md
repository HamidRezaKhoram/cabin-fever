# Lantern Lake — a tilt-your-phone party game (research + plan)

Status: ✅ **shipped** (Nov 10 2026) — `games/lantern.js`. Playtest: 2.5 min, worst idle 10 s. Original name, story, art and music.

## Research
- **Done before, and it works:** phone-as-tilt-controller on a shared screen is a proven genre —
  AirConsole's *Tiles of Doom* (steer a ball by gyro), *Play Friends* (tilt is one of several
  controls), motion games like *Just Dance Now*. The best moments are physical and visible: people
  leaning their whole body, bumping each other, and **everyone steering one thing together**.
- **The catch — browsers:** `deviceorientation` only fires on **secure (https) pages**, and iOS 13+
  also needs `DeviceOrientationEvent.requestPermission()` from a tap (MDN; WebKit bugs; A-Frame
  docs). Cabin Fever is plain http on the LAN → tilt would silently do nothing.
  → Cabin Fever gets an **optional https port with a self-signed certificate** (generated once,
  offline). The phone gets a one-tap "Use tilt" switch to the secure link (one certificate
  warning the first time), and **touch steering is always available** as a fallback, so nobody is
  locked out.
- **Feel:** tilt controls feel good with *inertia and friction* (things glide, never snap), a
  dead-zone around flat, a "hold flat → calibrate" step, and soft feedback (ripples, bump sound,
  a short vibration). Tilt range ±25° → full speed: nobody has to twist their wrist.
- **Is it a good idea?** Yes, as a short (≈3 min) game with a co-op finale; risky as a long one
  (arms tire, phones get dropped). Verdict: build it, keep rounds to 40 s.

## The game
**Story:** dusk at the cottage; everyone floats a paper lantern-boat on the lake. Three short
scenes as night falls — no text to read, just glide.

1. **Firefly Catch** (×1, 40 s) — fireflies drift over the water; glide into them to catch them
   (+20, gold ones +60). Boats bump each other (elastic, satisfying).
2. **Moonbeam** (×2, 40 s) — the moon's reflection wanders across the lake; points every tick you're
   inside it (+5/tick), and bumping others out is the whole game.
3. **Raft Run** (×3, 40 s, co-op finale) — the whole room steers **one raft**: its direction is the
   **average of everyone's tilt**. Collect floating lanterns (+room points), avoid rocks. Everyone
   shares the raft's haul, plus a "good paddler" bonus for pulling the way the raft needed to go.

Intro card (3 lines): Tilt your phone to glide · Catch fireflies, hog the moonbeam · Steer the raft
together.

**Pacing:** continuous control → every player acts constantly; between scenes only a 5 s result.

## Tech
- Phones send `{tilt:[x,y]}` (−1…1, dead-zone, calibrated) ≤ 15×/s, only on change.
- Server runs a fixed 30 Hz physics tick (velocity += tilt·accel; friction; wall bounce;
  circle collisions) and sends a compact **`room:frame`** to the TV only (positions), 30×/s;
  the normal state push stays slow (scores, timers).
- TV draws a canvas on the shared 30 fps clock (CLAUDE.md rule 3): lake, ripples, boats with
  each player's colour + avatar, fireflies, moonbeam, raft.
- https: `RUMPUS_HTTPS_PORT` (default 8443 in compose); cert in `data/certs/` via `openssl`
  (in the image). `/api/info` reports the https address; `/play?seat=CODE.TOKEN` rejoins the
  same seat on the other origin.
- Bots steer toward their nearest target (the bot brain gets their position + target).

## Tests
Physics (catch, bump, moonbeam scoring, raft = average tilt, bonuses), input validation, the https
server + rejoin link, bots finish the game, browser: touch-steering on a phone moves its boat on
the TV. Playtest at 4 and 6.
