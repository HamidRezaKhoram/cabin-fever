# Networking: is the server built the fastest way? (Nov 2026)

Short answer: **yes for the server; the remaining latency is the Wi-Fi.** Measured, not guessed.

## What we measured (test/unit/load.test.js, scripts/load-harsh.sh)

12 phones (the max), pushed harder than a real party: every phone answers instantly, mashes 20
duplicate taps a second and sends keep-warm pings; Lantern Lake with every phone streaming tilt
at 60/s (4× what real phones send); every phone dropping at once and rejoining together.

| Condition | Update reaches all phones (p95) | Tap → "got it" (p95) | TV frames | All 12 rejoin |
|---|---|---|---|---|
| Normal | 2 ms | 3–4 ms | 30 fps, gap p99 34 ms | 25 ms |
| Bad Wi-Fi (15±10 ms each way, 1% loss) | 38 ms | 63 ms | 30 fps, gap p99 79 ms | 198 ms |
| Server on ¼ CPU core | 2 ms | 3 ms | 29 fps, gap p99 58 ms | 83 ms |

CPU profile of the server during the tap storm: busy 0.41 s of 2.8 s (~15% of one core), most of
it inside socket.io writing frames. Memory ~77 MB. The bad-Wi-Fi row is almost exactly the link
delay itself, so the server adds nothing noticeable even then.

## Options considered

| Idea | Verdict | Why |
|---|---|---|
| Replace socket.io with raw `ws` or uWebSockets.js | **No** | Published benchmarks only separate them at thousands to 10k+ connections ([AnyCable](https://anycable.io/compare/nodejs-websocket), [Evil Martians](https://evilmartians.com/chronicles/choose-your-fighter-benchmarking-5-websocket-servers-for-nodejs)). We have 13 sockets and the server idles at 85%. socket.io gives us reconnects, acks, the polling fallback and the API the browser build's WebRTC shim imitates. |
| msgpack parser ([socket.io tuning](https://socket.io/docs/v4/performance-tuning/)) | No | Helps binary payloads; ours are small JSON. Would need the same parser in the phone, TV and WebRTC builds. |
| `bufferutil` native add-on | No | Speeds masking for big throughput; needs a native build in the Alpine image for no measurable gain here. |
| perMessageDeflate compression | Keep off (the default) | Updates are ~2 KB; on a LAN compressing costs more time than it saves. |
| Don't send phones the game list | **Done** | Phones never show it: every phone update went from ~4.5 KB to ~2.2 KB. |
| Coalesce updates, skip unchanged views | Done earlier | One update per screen per 30 ms at most; a screen that didn't change gets nothing. |
| Keep the phone's Wi-Fi radio awake | **Done** | An idle phone's Wi-Fi dozes between router beacons; the router holds packets until it wakes, adding ~100–300 ms ([Nordic](https://nrfconnectdocs.nordicsemi.com/ncs/2.6.1/nrf/protocols/wifi/station_mode/powersave.html), [TI](https://e2e.ti.com/support/wireless-connectivity/wi-fi-group/wifi/f/wi-fi-forum/984486/wl1837mod-power_save-affect-on-ping-latency)). A 200 ms heartbeat cut p99 from 572 to 173 ms in [one Android LAN game](https://github.com/HashingSeeds/scryve/pull/582). Native apps can also take Android's [low-latency Wi-Fi lock](https://source.android.com/docs/core/connect/wifi-low-latency); web pages can't. Phones now send a tiny `k` message every 200 ms while a game is on screen (public/play.js). |
| Send only what changed (deltas) | Not now | Would cut ~2 KB to a few hundred bytes, but 2 KB is well under a millisecond of Wi-Fi airtime; not worth the bug risk. |
| Unreliable WebRTC channel for tilt and frames (browser build) | Maybe later | `ordered:false, maxRetransmits:0` avoids waiting on a lost packet ([guide](https://www.metered.ca/docs/realtime-messaging/sdk-javascript/guides/data-channel-low-latency)). Only matters when packets are lost; worth it if Lantern Lake feels sticky in real play. |

## What helps at the cottage (no code)

- Use the router's 5 GHz network, and plug the TV/laptop into the router with a cable if you can.
- A phone in battery-saver mode can be slower; plug-in or turn it off for the night.
