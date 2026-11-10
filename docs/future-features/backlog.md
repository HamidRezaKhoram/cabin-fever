# Backlog — worth doing, too big for now

**Gameplay**
- ✅ **Game-night playlist** — shipped: 3/5/7-game nights, phone votes, night points, grand champion.
- ✅ **Persistent stats & achievements** — shipped: data/stats.json, 9 achievements, /highlights (tonight, all time, hall of fame).
- ✅ **House rules editor** — shipped at /admin (per-game timers, 18+ share, banned words).
- **Wagers / double-down** mechanic for Trivia, Closest, Majority (see playtest-findings.md).

**Presentation**
- **Offline narrator voice** (Piper TTS, CC0/MIT voices) reading prompts and roasting players —
  runs in the container, no internet. Big "TV show" upgrade.
- Animated pixel host character on the TV that reacts to events.
- Per-game background scenes (dock at sunset for Punchline, campfire for Odd One Out, …).
- More avatars + seasonal hats; drawn avatars get a pixelate filter to match the art style.
- ✅ Highlight reel — shipped with /highlights (best lines, lies, cards and doodles).

**Content**
- ✅ Content editor — shipped at /admin (search, disable, add your own).
- French (Canadian) translations of UI + a French content pack.
- More 18+ trivia written and fact-checked (Trivia/Closest pools are ~8% / 3% adult; draw mix
  is ~30% via weighting, but bigger adult pools would reduce repeats).

**Tech**
- Strict TypeScript (`strict: true`, `noImplicitAny`) — currently `checkJs` without strict.
- GitHub Actions CI running `scripts/test-all.sh` on every push.
- Load test: 12 phones + audience on a Raspberry Pi–class machine.
- PWA install for phones (works offline after first visit, home-screen icon).
- Accessibility: colour-blind safe palette option, larger-text toggle on phones, reduced-motion
  respected everywhere (partly done).
