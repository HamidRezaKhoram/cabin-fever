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
 * A line that Kokoro can't finish in time falls back to 2/3, so the narrator never goes quiet.
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

  // ---- Kokoro in a worker (only if the build/server has the model files)
  /** @type {Worker | null} */
  let worker = null;
  let workerOk = false;
  let seq = 0;
  /** @type {Map<number, (r: { rate?: number, samples?: Float32Array, error?: string }) => void>} */
  const pending = new Map();
  const C = /** @type {any} */ (window).CABIN;
  const base = C ? '' : '/';
  // Ask whether this server/build has the model (a missing file would log a 404 on the TV).
  void fetch(base + 'api/voice').then((r) => r.json()).then((/** @type {{ available?: boolean }} */ v) => {
    if (!v || !v.available || typeof Worker === 'undefined') return;
    try {
      worker = new Worker(base + 'tts-worker.js', { type: 'module' });
      worker.onmessage = (e) => { const f = pending.get(e.data.id); pending.delete(e.data.id); if (e.data.ready) workerOk = true; if (f) f(e.data); };
      worker.onerror = () => { worker = null; };
      worker.postMessage({ id: 0, text: '' }); // load the model now, while the room fills up
    } catch (e) { worker = null; }
  }).catch(() => {});

  /** Float samples → a WAV blob URL (so it plays through the same <audio> path). @param {Float32Array} samples @param {number} rate */
  function wavUrl(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (/** @type {number} */ o, /** @type {string} */ t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  /** Speak with Kokoro; resolves false if it can't (not loaded, too slow, error). @param {string} t @param {number} [ms] */
  function kokoro(t, ms = 6000) {
    return new Promise((/** @type {(ok: boolean) => void} */ done) => {
      if (!worker || !workerOk || voiceId === 'classic') { done(false); return; }
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); done(false); }, ms); // too slow on this TV: fall back
      pending.set(id, (r) => {
        clearTimeout(timer);
        if (!r.samples || !r.rate) { done(false); return; }
        const a = new Audio(wavUrl(r.samples, r.rate));
        if (voice) voice.pause();
        voice = a;
        a.play().then(() => done(true), () => done(false));
      });
      /** @type {Worker} */ (worker).postMessage({ id, text: t, voice: voiceId });
    });
  }

  /** espeak-ng (server) or the browser's voice. @param {string} t @param {boolean} fr */
  function classic(t, fr) {
    if (C && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = fr ? 'fr-FR' : 'en-US';
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
    const fr = !!(R.i18n && R.i18n.lang() === 'fr');
    if (R.music && R.music.duck) R.music.duck(Math.min(8000, 800 + t.length * 70), 0.45);
    // Kokoro speaks English only; French rooms (and fallbacks) use the classic voice.
    if (fr) { classic(t, fr); return; }
    void kokoro(t).then((ok) => { if (!ok) classic(t, fr); });
  }

  function cheer() { cheerUntil = Date.now() + 1500; }

  R.host = {
    say, cheer,
    isEnabled: () => enabled,
    /** @param {boolean} on */
    setEnabled(on) { enabled = on; R.store('rumpus.narrator', on); if (!on && voice) voice.pause(); },
    /** @param {boolean} on */
    show(on) { el.hidden = !on; },
    voices: () => VOICES,
    voice: () => voiceId,
    /** @param {string} id */
    setVoice(id) { voiceId = id; R.store('rumpus.voice', id); },
    /** True once the natural voice is loaded (tests / the debug panel). */
    natural: () => !!worker && workerOk,
    /** Speak with the natural voice only; resolves whether it worked (tests). */
    testNatural: (/** @type {string} */ t, /** @type {number} */ ms) => kokoro(speakable(t), ms),
  };
})();
