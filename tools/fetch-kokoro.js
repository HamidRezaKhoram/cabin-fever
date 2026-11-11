#!/usr/bin/env node
/*
 * Download the narrator's natural voice (Kokoro-82M, Apache-2.0) into a folder the game serves:
 *   node tools/fetch-kokoro.js <outDir> [--dtype uint8|fp32|q8]   (default: vendor/kokoro, uint8)
 * Which model precision: uint8 for browsers (~2× faster than q8 in WebAssembly, 177 MB), fp32 for
 * the Docker server, which runs the voice natively (≈3× faster than real time, 326 MB).
 * Run once while you have internet (the Docker image build and the Pages workflow do it);
 * afterwards the voice works fully offline. Files:
 *   <out>/kokoro.web.js                     kokoro-js browser build (from npm)
 *   <out>/ort/ort-wasm-simd-threaded.jsep.{mjs,wasm}   ONNX runtime for the browser — must be the
 *     exact onnxruntime-web build kokoro-js's transformers.js expects (1.22.0-dev.20250409-89f8206ba4)
 *   <out>/model/{config.json,tokenizer.json,tokenizer_config.json,onnx/model[_uint8|_quantized].onnx}
 *   <out>/model/voice.json                  {dtype} — which precision this folder holds
 *   <out>/model/voices/{af_heart,am_michael,bf_emma,bm_george}.bin
 * Already-downloaded files are kept. AGPLv3 — see LICENSE.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);
const flag = args.indexOf('--dtype');
const DTYPE = flag >= 0 ? args.splice(flag, 2)[1] : 'uint8';
/** Model file for each precision (transformers.js naming). */
const FILE_FOR = { fp32: 'model.onnx', uint8: 'model_uint8.onnx', q8: 'model_quantized.onnx' };
if (!(DTYPE in FILE_FOR)) { console.error(`--dtype must be one of ${Object.keys(FILE_FOR).join(', ')}`); process.exit(1); }
const OUT = path.resolve(args[0] || path.join(__dirname, '..', 'vendor', 'kokoro'));
const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
/** The narrator voices offered on the TV (2 accents × female/male). */
const VOICES = ['af_heart', 'am_michael', 'bf_emma', 'bm_george'];
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', `onnx/${FILE_FOR[/** @type {'fp32' | 'uint8' | 'q8'} */ (DTYPE)]}`, ...VOICES.map((v) => `voices/${v}.bin`)];

/** @param {string} url @param {string} file @returns {Promise<void>} */
function download(url, file) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CabinFever/1.0 (party game narrator voice)' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(new URL(res.headers.location, url).href, file).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`${url}: HTTP ${res.statusCode}`)); return; }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => { fs.renameSync(tmp, file); resolve(); });
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  // Runtime files come from npm (kokoro-js and the onnxruntime-web it was built against).
  /** Folder of an installed package (hoisted or nested under @huggingface/transformers). @param {string} name */
  const pkgDir = (name) => {
    const nm = path.join(__dirname, '..', 'node_modules');
    for (const d of [path.join(nm, name), path.join(nm, '@huggingface', 'transformers', 'node_modules', name)]) if (fs.existsSync(path.join(d, 'package.json'))) return d;
    throw new Error(`${name} is not installed (npm install)`);
  };
  const kokoro = path.join(pkgDir('kokoro-js'), 'dist', 'kokoro.web.js');
  const ortDir = path.join(pkgDir('onnxruntime-web'), 'dist');
  fs.mkdirSync(path.join(OUT, 'ort'), { recursive: true });
  fs.copyFileSync(kokoro, path.join(OUT, 'kokoro.web.js'));
  for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) fs.copyFileSync(path.join(ortDir, f), path.join(OUT, 'ort', f));
  for (const f of MODEL_FILES) {
    const dest = path.join(OUT, 'model', f);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    process.stdout.write(`downloading ${f}… `);
    await download(HF + f, dest);
    console.log(`${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
  }
  fs.writeFileSync(path.join(OUT, 'model', 'voice.json'), JSON.stringify({ dtype: DTYPE }));
  console.log(`narrator voice (${DTYPE}) ready in ${OUT}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
