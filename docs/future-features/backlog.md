# Backlog — worth doing, too big for now

**Gameplay**
- ✅ **Game-night playlist** — shipped: 3/5/7-game nights, phone votes, night points, grand champion.
- ✅ **Persistent stats & achievements** — shipped: data/stats.json, 9 achievements, /highlights (tonight, all time, hall of fame).
- ✅ **House rules editor** — shipped at /admin (per-game timers, 18+ share, banned words).
- **Wagers / double-down** mechanic for Trivia, Closest, Majority (see playtest-findings.md).

**Presentation**
- ✅ **Offline narrator voice** — shipped with espeak-ng in the container (/api/tts); browser voice fallback; lobby toggle.
- ✅ Animated pixel host — Rocco the raccoon (sprites.js frames, 30 fps clock, speech bubble, cheers on reveals).
- Per-game background scenes (dock at sunset for Punchline, campfire for Odd One Out, …).
- ✅ Seasonal hats — Santa, witch, bunny ears, maple crown (Canada Day), grad cap; in-season hat listed first.
- ✅ Highlight reel — shipped with /highlights (best lines, lies, cards and doodles).

**Content**
- ✅ Content editor — shipped at /admin (search, disable, add your own).
- ✅ Français — room language setting; UI translated on TV + phones (public/i18n.js); original French pack for Punchline, Most Likely, Majority, Doodle Telephone; French narrator voice. Trivia/Fib/Closest/Card Chaos stay English (marked EN).
- More 18+ trivia written and fact-checked (Trivia/Closest pools are ~8% / 3% adult; draw mix
  is ~30% via weighting, but bigger adult pools would reduce repeats).

**Tech**
- Strict TypeScript (`strict: true`, `noImplicitAny`) — currently `checkJs` without strict.
- ✅ GitHub Actions CI — .github/workflows/ci.yml runs the full suite.
- ✅ Load test — test/unit/load.test.js: 12 phones, p95 fan-out ≤ 250 ms, server RSS < 200 MB.
- ✅ PWA — manifest, icons, network-first service worker (needs https or localhost to install).
- ✅ Accessibility — colour-blind palette (TV + phone), text size on phones, reduced motion everywhere.
