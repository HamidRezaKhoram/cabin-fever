/*
 * The narrator's natural voice on the server (Docker): Kokoro-82M through the native ONNX runtime,
 * in its own thread so making speech never delays the game. Several times faster than the browser
 * (WebAssembly) version: a short line in well under a second. Started by core/voice.js.
 * In: {id, text, voice} · Out: {ready} once loaded · {id, rate, samples} · {id, error} · {failed}
 * AGPLv3 — see LICENSE.
 */
import { parentPort, workerData } from 'node:worker_threads';

try {
  const { KokoroTTS } = await import('kokoro-js');
  const tts = await KokoroTTS.from_pretrained(workerData.dir, { dtype: workerData.dtype, device: 'cpu' });
  await tts.generate('Ready.', { voice: 'af_heart' }); // the first run is slower: do it before the TV needs it
  parentPort.on('message', async (/** @type {{ id: number, text: string, voice: string }} */ m) => {
    try {
      const a = await tts.generate(m.text, { voice: m.voice });
      const samples = a.audio;
      parentPort.postMessage({ id: m.id, rate: a.sampling_rate, samples }, [samples.buffer]);
    } catch (e) {
      parentPort.postMessage({ id: m.id, error: String((e && e.message) || e) });
    }
  });
  parentPort.postMessage({ ready: true });
} catch (e) {
  // No native runtime here (e.g. a musl/Alpine image) or no model: the TV uses its own voice.
  parentPort.postMessage({ failed: String((e && e.message) || e) });
}
