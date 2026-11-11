/* Rocco, the TV host (an original pixel raccoon) + the offline narrator.
 *
 *   Rumpus.host.say('Ann wins the round!')   — speech bubble + voice (if the narrator is on)
 *   Rumpus.host.cheer()                       — jumps for joy on reveals
 *
 * Voices, best first:
 *  1. Kokoro-82M, a small natural-sounding model (Apache-2.0) in a background worker
 *     (public/tts-worker.js), English, 4 voices (US/UK × female/male) — when its files are in tts/;
 *  2. the server's /api/tts (espeak-ng in the container; offline, robotic, also French);
 *  3. the browser's speechSynthesis (the GitHub Pages build without the model, or no server voice).
 * Kokoro speaks a line part by part (sentences / clauses), so it starts after the first part; a new
 * line cuts the old one off, so it never lags behind the screen. It needs the TV page to be
 * cross-origin isolated (multi-threaded: server.js headers, sw.js on GitHub Pages). A TV too slow
 * for it (3 lines in a row late) switches to the classic voice.
 * Animation runs on the shared 30 fps clock. AGPLv3 — see LICENSE.
 */
'use strict';

(function () {
  const R = window.Rumpus;
  const el = document.createElement('div');
  el.id = 'rocco';
  el.innerHTML = '<div class="rocco-bubble" hidden></div><img class="rocco-img" alt="Rocco the host" width="96" height="96">';
  document.body.appendChild(el);
  const img = /** @type {HTMLImageElement} */ (el.querySelector('.rocco-img'));
  const bubble = /** @type {HTMLElement} */ (el.querySelector('.rocco-bubble'));
  let talkUntil = 0, cheerUntil = 0, bubbleUntil = 0;
  let enabled = R.store('rumpus.narrator') !== false; // on by default; lobby toggle
  /** @type {HTMLAudioElement | null} */
  let voice = null;
  /** Narrator voice: a Kokoro voice id, or 'classic' (espeak / the browser's voice). */
  let voiceId = R.store('rumpus.voice') || 'af_heart';
  const VOICES = [['af_heart', 'Natural — US female'], ['am_michael', 'Natural — US male'], ['bf_emma', 'Natural — UK female'], ['bm_george', 'Natural — UK male'], ['classic', 'Classic robot']];

  // ---- Kokoro: made by the server when it can (Docker: native, fast), else in a worker on this TV
  /** @type {Worker | null} */
  let worker = null;
  /** 'server' / 'worker' once a natural voice is ready; 'none' if there isn't one. */
  let engine = /** @type {'loading' | 'server' | 'worker' | 'none'} */ ('loading');
  let seq = 0;
  const C = /** @type {any} */ (window).CABIN;
  const base = C ? '' : '/';
  /** The line being spoken: its id, what to do with each part, and how to drop it. */
  /** @type {{ id: number, onPart: (k: number, buf: AudioBuffer) => void, onError: () => void, abort: () => void } | null} */
  let line = null;
  /** A line asked for while the model was still loading: spoken once it's ready (if still fresh). */
  /** @type {{ t: string, at: number } | null} */
  let waiting = null;
  /** How the natural voice is doing (the debug panel and tests). */
  const info = { engine: 'loading', threads: 0, firstMs: /** @type {number | null} */ (null) };

  const ready = (/** @type {'server' | 'worker'} */ e) => {
    engine = e; info.engine = e;
    const w = waiting; waiting = null;
    if (w && Date.now() - w.at < 2500 && enabled) speakNatural(w.t);
  };
  /** The model in a worker on this TV (GitHub Pages, or a server without the native runtime). @param {string | null} dtype */
  function startWorker(dtype) {
    try {
      worker = new Worker(base + 'tts-worker.js', { type: 'module' });
      worker.onmessage = (e) => {
        const d = e.data || {};
        if (d.ready) {
          info.threads = d.threads || 1;
          if (info.threads < 2) console.info('[narrator] natural voice on 1 thread (page not cross-origin isolated): it may lag');
          return ready('worker');
        }
        if (!line || d.id !== line.id) return; // an old line: dropped
        if (d.error || !d.samples) { line.onError(); return; }
        const ctx = audio();
        if (!ctx) return;
        const buf = ctx.createBuffer(1, d.samples.length, d.rate);
        buf.copyToChannel(d.samples, 0);
        line.onPart(d.k, buf);
      };
      worker.onerror = () => { worker = null; engine = 'none'; info.engine = 'none'; };
      worker.postMessage({ id: 0, text: '', dtype }); // load the model now, while the room fills up
    } catch (e) { worker = null; engine = 'none'; info.engine = 'none'; }
  }
  // Ask what this server/build has (a missing file would log a 404 on the TV).
  void fetch(base + 'api/voice').then((r) => r.json()).then((/** @type {{ available?: boolean, server?: boolean, dtype?: string }} */ v) => {
    if (v && v.server) return ready('server');
    if (!v || !v.available || typeof Worker === 'undefined') { engine = 'none'; info.engine = 'none'; return; }
    startWorker(v.dtype || null);
  }).catch(() => { engine = 'none'; info.engine = 'none'; });

  /** Cut a line into short parts so the first one is ready fast: sentences, then clauses of long
   * sentences; tiny bits ride along with a neighbour. @param {string} t */
  function parts(t) {
    const out = [];
    for (const sentence of t.split(/(?<=[.!?…])\s+/)) {
      // Clauses of longer sentences: the first sound waits only for the first clause.
      if (sentence.length <= 50) { out.push(sentence); continue; }
      out.push(...sentence.split(/(?<=[,;:])\s+|\s+(?=—)/));
    }
    /** @type {string[]} */
    const merged = [];
    for (const p of out.map((x) => x.trim()).filter(Boolean)) {
      if (merged.length && (p.length < 14 || merged[merged.length - 1].length < 14) && merged[merged.length - 1].length + p.length < 60) merged[merged.length - 1] += ' ' + p;
      else merged.push(p);
    }
    return merged;
  }

  // Natural-voice audio plays through Web Audio: parts are scheduled back to back (no gaps, no
  // files), and a new line stops the old one at once.
  /** @type {AudioContext | null} */
  let actx = null;
  function audio() {
    if (!actx) { try { actx = new AudioContext(); } catch (e) { return null; } }
    if (actx.state !== 'running') void actx.resume();
    return actx;
  }
  /** @type {AudioBufferSourceNode[]} */
  let playing = [];
  let nextAt = 0;
  /** Recently made parts by voice + text: repeated lines ("Time's up!") start instantly. */
  /** @type {Map<string, AudioBuffer>} */
  const made = new Map();
  /** Lines in a row whose first part came too late: this TV can't keep up → classic voice. */
  let lateLines = 0;
  const FIRST_PART_MS = 3500;

  function stopNatural() {
    for (const n of playing) { try { n.stop(); } catch (e) { /* not started */ } }
    playing = [];
    if (line) line.abort();
    line = null;
  }

  /** @param {AudioBuffer} buf */
  function schedule(buf) {
    const ctx = /** @type {AudioContext} */ (actx);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, nextAt);
    src.start(at);
    nextAt = at + buf.duration;
    playing.push(src);
    src.onended = () => { playing = playing.filter((x) => x !== src); };
    talkUntil = Math.max(talkUntil, Date.now() + (nextAt - ctx.currentTime) * 1000);
  }

  /** One line for the lobby: what the 🎙 picker will actually sound like right now. */
  function status() {
    if (voiceId === 'classic') return '';
    if (engine === 'loading') return 'natural voice loading…';
    if (engine === 'none') return 'no natural voice here — using the robot voice';
    if (lateLines >= 3) return 'this device is too slow for the natural voice — using the robot voice';
    return 'natural voice ready';
  }
  let lastStatus = '';
  setInterval(() => { const s = status(); if (s !== lastStatus) { lastStatus = s; document.dispatchEvent(new CustomEvent('cf:voice', { detail: s })); } }, 500);

  /** Can the natural voice speak right now? (While it loads, lines wait for it.) */
  const naturalOn = () => voiceId !== 'classic' && engine !== 'none' && lateLines < 3;

  /** Speak with Kokoro, part by part. Falls back to the classic voice only if it fails.
   * @param {string} t @param {{ patience?: number, done?: (ok: boolean) => void }} [opt] */
  function speakNatural(t, opt = {}) {
    stopNatural();
    const done = opt.done || (() => {});
    if (engine === 'loading') { waiting = { t, at: Date.now() }; done(false); return; } // say it when ready
    const ctx = audio();
    if (!ctx || engine === 'none') { done(false); classic(t, false); return; }
    nextAt = 0;
    const list = parts(t);
    const key = (/** @type {string} */ p) => voiceId + '|' + p;
    const id = ++seq;
    const t0 = Date.now();
    let got = 0;
    let started = false;
    /** Parts that arrived early, waiting for the ones before them. @type {Map<number, AudioBuffer>} */
    const early = new Map();
    const late = setTimeout(() => {
      if (started || !line || line.id !== id) return;
      // Too slow on this TV: skip this line (the text is on screen) rather than talk over the next.
      lateLines++;
      if (lateLines >= 3) console.warn('[narrator] this TV is too slow for the natural voice — using the classic one');
      stopNatural();
      done(false);
    }, opt.patience || FIRST_PART_MS);
    const play = (/** @type {number} */ k, /** @type {AudioBuffer} */ buf) => {
      early.set(k, buf);
      while (early.has(got)) {
        const b = /** @type {AudioBuffer} */ (early.get(got));
        early.delete(got);
        if (!started) { started = true; clearTimeout(late); lateLines = 0; info.firstMs = Date.now() - t0; done(true); }
        schedule(b);
        got++;
      }
    };
    // Parts already made come from memory; only the rest are asked for.
    const todo = [];
    for (let k = 0; k < list.length; k++) {
      const hit = made.get(key(list[k]));
      if (hit && todo.length === 0) play(k, hit); else todo.push(k);
    }
    if (!todo.length) { clearTimeout(late); return; }
    const offset = todo[0];
    /** @type {AbortController[]} */
    const requests = [];
    line = {
      id,
      onPart: (k, buf) => {
        made.set(key(list[k]), buf);
        if (made.size > 80) made.delete(/** @type {string} */ (made.keys().next().value));
        play(k, buf);
      },
      onError: () => { clearTimeout(late); if (line && line.id === id) { stopNatural(); done(false); classic(t, false); } },
      abort: () => { clearTimeout(late); requests.forEach((r) => r.abort()); if (engine === 'worker' && worker) worker.postMessage({ cancel: true }); },
    };
    const mine = line;
    if (engine === 'worker') {
      // The worker numbers parts from 0: map them back to their place in the line.
      const onPart = mine.onPart;
      mine.onPart = (k, buf) => onPart(k + offset, buf);
      /** @type {Worker} */ (worker).postMessage({ id, parts: list.slice(offset), voice: voiceId });
      return;
    }
    // Server: one request per part, all at once; the server makes them in order and the first
    // plays as soon as it arrives. A newer line aborts these (the server skips what it hasn't started).
    for (let k = offset; k < list.length; k++) {
      const ac = new AbortController();
      requests.push(ac);
      const part = k;
      void fetch(`${base}api/voice/say?v=${encodeURIComponent(voiceId)}&t=${encodeURIComponent(list[k])}`, { signal: ac.signal })
        .then((r) => { if (!r.ok) throw new Error('voice ' + r.status); return r.arrayBuffer(); })
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => { if (line === mine) mine.onPart(part, buf); })
        .catch((e) => { if (line === mine && !(e && e.name === 'AbortError')) mine.onError(); });
    }
  }

  /** The browser's own voice closest to the chosen narrator (accent, then female/male by name —
   * browsers don't say which is which). Only used when the natural voice can't run. @param {boolean} fr */
  function browserVoice(fr) {
    const all = speechSynthesis.getVoices();
    const lang = fr ? 'fr' : voiceId[0] === 'b' ? 'en-GB' : 'en-US';
    const female = voiceId[1] !== 'm';
    const FEMALE = /female|samantha|victoria|karen|moira|tessa|fiona|zira|hazel|susan|aria|jenny|libby|sonia|emma|amelie|denise|woman/i;
    const MALE = /\bmale|daniel|alex|fred|george|david|mark|ryan|guy|thomas|oliver|arthur|henri|\bman\b/i;
    const score = (/** @type {SpeechSynthesisVoice} */ v) => (v.lang.replace('_', '-').startsWith(lang) ? 4 : v.lang.startsWith(lang.slice(0, 2)) ? 2 : 0)
      + ((female ? FEMALE : MALE).test(v.name) ? 1.5 : (female ? MALE : FEMALE).test(v.name) ? -1 : 0) + (v.localService ? 0.2 : 0);
    return all.slice().sort((a, b) => score(b) - score(a))[0] || null;
  }

  /** espeak-ng (server) or the browser's voice. @param {string} t @param {boolean} fr */
  function classic(t, fr) {
    if (C && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = fr ? 'fr-FR' : voiceId[0] === 'b' ? 'en-GB' : 'en-US';
      const v = browserVoice(fr);
      if (v) u.voice = v;
      speechSynthesis.speak(u);
      return;
    }
    const a = new Audio('/api/tts?text=' + encodeURIComponent(t) + (fr ? '&lang=fr' : ''));
    voice = a;
    a.play().catch(() => {
      // No server voice (e.g. running outside the container): use the browser's, if any.
      if ('speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
    });
  }

  // 30 fps clock: bob while idle, flap the mouth while talking, jump when cheering.
  R.clock.add((frame) => {
    const now = Date.now();
    const cheering = now < cheerUntil;
    const talking = now < talkUntil;
    const f = cheering ? 'cheer' : talking && frame % 8 < 4 ? 'talk' : 'idle';
    const src = R.sprites.roccoUrl(f);
    if (img.getAttribute('src') !== src) img.src = src;
    const bob = cheering ? -Math.abs(Math.sin(frame / 4)) * 18 : (frame % 30 < 15 ? 0 : -3);
    img.style.transform = `translateY(${Math.round(bob)}px)`;
    if (bubbleUntil && now > bubbleUntil) { bubble.hidden = true; bubbleUntil = 0; }
  });

  /** Spoken version of on-screen text: blanks read as "blank". @param {string} text */
  const speakable = (text) => text.replace(/_{2,}/g, ' blank ').replace(/\s+/g, ' ').trim().slice(0, 240);

  /** @param {string} text */
  function say(text) {
    const t = speakable(text);
    if (!t) return;
    bubble.textContent = t;
    bubble.hidden = false;
    const ms = Math.min(9000, 1500 + t.length * 60);
    bubbleUntil = Date.now() + ms;
    talkUntil = Date.now() + Math.min(ms, 600 + t.length * 55);
    if (!enabled) return;
    if (voice) { voice.pause(); voice = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    stopNatural();
    waiting = null;
    const fr = !!(R.i18n && R.i18n.lang() === 'fr');
    if (R.music && R.music.duck) R.music.duck(Math.min(8000, 800 + t.length * 70), 0.45);
    // Kokoro speaks English only; French rooms, the "Classic robot" choice and TVs without the
    // model (or too slow for it) use the classic voice.
    if (fr || !naturalOn()) { classic(t, fr); return; }
    speakNatural(t);
  }

  function cheer() { cheerUntil = Date.now() + 1500; }

  R.host = {
    say, cheer,
    isEnabled: () => enabled,
    /** @param {boolean} on */
    setEnabled(on) { enabled = on; R.store('rumpus.narrator', on); if (!on) { if (voice) voice.pause(); stopNatural(); waiting = null; } },
    /** @param {boolean} on */
    show(on) { el.hidden = !on; },
    voices: () => VOICES,
    voiceStatus: status,
    voice: () => voiceId,
    /** @param {string} id */
    setVoice(id) { voiceId = id; lateLines = 0; R.store('rumpus.voice', id); },
    /** True once the natural voice is loaded (tests / the debug panel). */
    natural: () => engine === 'server' || engine === 'worker',
    /** Speak with the natural voice only; resolves whether it worked (tests). */
    testNatural: (/** @type {string} */ t, /** @type {number} */ ms) => new Promise((/** @type {(ok: boolean) => void} */ res) => speakNatural(speakable(t), { patience: ms, done: res })),
    /** Threads the voice runs on, and how long the last line took to start (ms). */
    voiceInfo: () => ({ ...info, isolated: !!window.crossOriginIsolated }),
  };
})();
