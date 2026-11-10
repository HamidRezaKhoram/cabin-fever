/* Rocco, the TV host (an original pixel raccoon) + the offline narrator.
 *
 *   Rumpus.host.say('Ann wins the round!')   — speech bubble + voice (if the narrator is on)
 *   Rumpus.host.cheer()                       — jumps for joy on reveals
 *
 * Voice: the server's /api/tts (espeak-ng inside the container — fully offline, and its
 * robotic tone suits the retro look); falls back to the browser's speechSynthesis.
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
    const fr = R.i18n && R.i18n.lang() === 'fr';
    const a = new Audio('/api/tts?text=' + encodeURIComponent(t) + (fr ? '&lang=fr' : ''));
    voice = a;
    if (R.music && R.music.duck) R.music.duck(Math.min(8000, 800 + t.length * 70), 0.45);
    a.play().catch(() => {
      // No server voice (e.g. running outside the container): use the browser's, if any.
      if ('speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
    });
  }

  function cheer() { cheerUntil = Date.now() + 1500; }

  R.host = {
    say, cheer,
    isEnabled: () => enabled,
    /** @param {boolean} on */
    setEnabled(on) { enabled = on; R.store('rumpus.narrator', on); if (!on && voice) voice.pause(); },
    /** @param {boolean} on */
    show(on) { el.hidden = !on; },
  };
})();
