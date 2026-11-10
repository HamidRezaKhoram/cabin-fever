# Backlog — worth doing, too big for now

**Gameplay**
- **Audience mode:** extra phones join as audience (unlimited), vote on answers; audience votes
  give a small bonus. Great for big cottage weekends.
- **Game-night playlist:** auto-rotate games ("3 games, chosen by vote") with a running
  multi-game leaderboard and a grand champion at the end.
- **Persistent stats & achievements** across sessions (data/stats.json): wins per player name,
  funniest line hall-of-fame, "liar of the year". Exportable highlights page.
- **House rules editor** on the TV (timers per game, rounds, 18+ share slider, banned words).
- **Wagers / double-down** mechanic for Trivia, Closest, Majority (see playtest-findings.md).

**Presentation**
- **Offline narrator voice** (Piper TTS, CC0/MIT voices) reading prompts and roasting players —
  runs in the container, no internet. Big "TV show" upgrade.
- Animated pixel host character on the TV that reacts to events.
- Per-game background scenes (dock at sunset for Punchline, campfire for Odd One Out, …).
- More avatars + seasonal hats; drawn avatars get a pixelate filter to match the art style.
- Highlight reel: auto-saves the best answers/drawings of the night as a gallery page.

**Content**
- Content editor page on the TV (add/disable prompts without editing files).
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
