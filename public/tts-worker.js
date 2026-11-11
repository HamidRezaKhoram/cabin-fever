/*
 * The narrator's natural voice: Kokoro-82M (Apache-2.0) running in a background worker on the TV,
 * so speaking never stalls the 30 fps animation. Every file comes from the game itself (tts/,
 * downloaded once by tools/fetch-kokoro.js) — the library's Hugging Face URLs are redirected there,
 * so this works offline in Docker and from the browser cache on GitHub Pages.
 *
 * A line arrives already cut into short parts (sentences / clauses). Each part is sent back as soon
 * as it's made, so the TV starts talking after the first part instead of after the whole line.
 * A newer line (or {cancel}) stops the older one between parts: the narrator never falls behind.
 * Speed: the uint8 model (~2× faster than q8 in WebAssembly) and threads — the TV page is
 * cross-origin isolated (server.js / sw.js headers). About real time on a laptop; the Docker server
 * makes the voice natively instead (core/voice.js), which is ~3× faster than that.
 *
 * Messages in:  {id, parts: string[], voice} · {id, text: '', dtype} (load now) · {cancel: true}
 * Messages out: {id, k, rate, samples: Float32Array, last} per part · {id, ready, threads} · {id, k, error}
 * AGPLv3 — see LICENSE.
 */
const HERE = new URL('./', self.location.href).href;
const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return realFetch(url.startsWith(HF) ? HERE + 'tts/model/' + url.slice(HF.length) : input, init);
};

/** Threads the runtime may use: only possible when the page is cross-origin isolated. */
const THREADS = self.crossOriginIsolated ? Math.max(1, Math.min(4, Math.ceil((navigator.hardwareConcurrency || 2) / 2))) : 1;

/** Loaded once, on the first message. Precision from /api/voice (uint8 is ~2× faster than q8 here). */
let model = null;
let dtype = 'q8';
async function load() {
  if (!model) {
    model = (async () => {
      const { KokoroTTS, env } = await import(HERE + 'tts/kokoro.web.js');
      env.wasmPaths = HERE + 'tts/ort/';
      return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device: 'wasm' });
    })();
  }
  return model;
}

/** The line being spoken now; parts of any other line are dropped. */
let current = 0;

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.cancel) { current = 0; return; }
  const { id, voice } = msg;
  if (msg.dtype && !model) dtype = msg.dtype;
  const parts = Array.isArray(msg.parts) ? msg.parts : msg.text ? [msg.text] : [];
  try {
    const tts = await load();
    if (!parts.length) { // a warm-up request: load, and make one word (the first run is slower)
      await tts.generate('Ready.', { voice: 'af_heart' });
      self.postMessage({ id, ready: true, threads: THREADS });
      return;
    }
    current = id;
    for (let k = 0; k < parts.length; k++) {
      if (current !== id) return; // a newer line took over
      const audio = await tts.generate(String(parts[k]).slice(0, 300), { voice: voice || 'af_heart' });
      if (current !== id) return;
      const samples = audio.audio;
      self.postMessage({ id, k, rate: audio.sampling_rate, samples, last: k === parts.length - 1 }, [samples.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, k: -1, error: String(err && err.message || err) });
  }
};
