/*
 * The Deep End's answer judge on the TV: gte-small (MIT, 34 MB, tools/fetch-kokoro.js puts it in
 * tts/judge/) turns each off-chart answer into a point in meaning space and scores it against the
 * category's centre (public/judge-centroids.json, maths in public/judge-core.js). A worker, so the
 * 30 fps animation never waits for it. Every file comes from the game itself: works offline.
 *
 * Messages in:  {id: 0} (load now) · {id, q, texts: string[]}
 * Messages out: {id, ready: true} · {id, scores: (number | null)[]} (null: no centre for this category)
 *               · {id, error}
 * AGPLv3 — see LICENSE.
 */
/* global importScripts, CfJudgeCore */
const HERE = new URL('./', self.location.href).href;
importScripts(HERE + 'judge-core.js');

/** @type {Promise<{ embed: any, cats: Record<string, number[]> }> | null} */
let loading = null;
function load() {
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import(HERE + 'tts/judge/transformers.web.js');
      env.allowRemoteModels = false;
      env.allowLocalModels = true; // (off by default in browsers: our files are the "local" ones)
      env.localModelPath = HERE + 'tts/judge/';
      env.backends.onnx.wasm.wasmPaths = HERE + 'tts/ort/';
      env.backends.onnx.wasm.numThreads = 1; // a few short strings: threads don't pay for themselves
      const embed = await pipeline('feature-extraction', 'model', { dtype: 'q8', device: 'wasm' });
      const packed = await (await fetch(HERE + 'judge-centroids.json')).json();
      /** @type {Record<string, number[]>} */
      const cats = {};
      for (const [q, b64] of Object.entries(packed.cats || {})) cats[q] = CfJudgeCore.unpack(String(b64));
      await embed(['ready'], { pooling: 'mean', normalize: true }); // the first run is the slow one
      return { embed, cats };
    })();
  }
  return loading;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    const { embed, cats } = await load();
    if (!msg.texts) { self.postMessage({ id: msg.id, ready: true }); return; }
    const own = cats[msg.q];
    if (!own || !msg.texts.length) { self.postMessage({ id: msg.id, scores: msg.texts.map(() => null) }); return; }
    const others = Object.entries(cats).filter(([q]) => q !== msg.q).map(([, v]) => v);
    const vecs = (await embed(msg.texts.map(String), { pooling: 'mean', normalize: true })).tolist();
    self.postMessage({ id: msg.id, scores: vecs.map((/** @type {number[]} */ v) => CfJudgeCore.score(v, own, others)) });
  } catch (err) {
    loading = null; // try again next time (a file still downloading, say)
    self.postMessage({ id: msg.id, error: String((err && err.message) || err) });
  }
};
