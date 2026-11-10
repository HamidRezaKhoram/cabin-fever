/*
 * The narrator's natural voice: Kokoro-82M (Apache-2.0) running in a background worker on the TV,
 * so speaking never stalls the 30 fps animation. Every file comes from the game itself (tts/,
 * downloaded once by tools/fetch-kokoro.js) — the library's Hugging Face URLs are redirected there,
 * so this works offline in Docker and from the browser cache on GitHub Pages.
 * Messages: {id, text, voice} → {id, rate, samples: Float32Array} or {id, error}.
 * AGPLv3 — see LICENSE.
 */
const HERE = new URL('./', self.location.href).href;
const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return realFetch(url.startsWith(HF) ? HERE + 'tts/model/' + url.slice(HF.length) : input, init);
};

/** Loaded once, on the first line to speak. */
let model = null;
async function load() {
  if (!model) {
    model = (async () => {
      const { KokoroTTS, env } = await import(HERE + 'tts/kokoro.web.js');
      env.wasmPaths = HERE + 'tts/ort/';
      return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' });
    })();
  }
  return model;
}

self.onmessage = async (e) => {
  const { id, text, voice } = e.data || {};
  try {
    const tts = await load();
    if (!text) { self.postMessage({ id, ready: true }); return; } // a warm-up request
    const audio = await tts.generate(String(text).slice(0, 300), { voice: voice || 'af_heart' });
    const samples = audio.audio;
    self.postMessage({ id, rate: audio.sampling_rate, samples }, [samples.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
