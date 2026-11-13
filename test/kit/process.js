/*
 * Test kit — start the real app in a child process and wait until it's listening.
 * No project knowledge: copy into any project.
 *   const app = await startApp('server.js', { env: { PORT: '0' }, ready: /listening on port (\d+)/ });
 *   app.port; app.log(); await app.stop();
 * Start the real thing (not a mock): tests then catch start-up crashes, bad config and wiring.
 */
'use strict';
const { fork } = require('child_process');

/** @param {string} script @param {{ cwd?: string, env?: Record<string, string>, ready?: RegExp, timeoutMs?: number }} [opts] */
function startApp(script, { cwd, env = {}, ready = /listening on port (\d+)/, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = fork(script, [], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let out = '';
    const fail = (/** @type {string} */ why) => { proc.kill('SIGKILL'); reject(new Error(`${why}:\n${out}`)); };
    const timer = setTimeout(() => fail('app did not start'), timeoutMs);
    const onData = (/** @type {Buffer} */ d) => {
      out += d;
      const m = ready.exec(out);
      if (!m) return;
      clearTimeout(timer);
      /** @type {NodeJS.ReadableStream} */ (proc.stdout).off('data', onData);
      /** @type {NodeJS.ReadableStream} */ (proc.stdout).on('data', (/** @type {Buffer} */ d2) => { out += d2; });
      proc.removeAllListeners('exit');
      resolve({
        port: m[1] ? Number(m[1]) : null, proc, log: () => out,
        stop() {
          proc.kill('SIGTERM');
          return new Promise((r) => (proc.exitCode !== null ? r(null) : proc.once('exit', r)));
        },
      });
    };
    /** @type {NodeJS.ReadableStream} */ (proc.stdout).on('data', onData);
    /** @type {NodeJS.ReadableStream} */ (proc.stderr).on('data', (/** @type {Buffer} */ d) => { out += d; });
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`app exited (${code}) before it was ready:\n${out}`)); });
  });
}

module.exports = { startApp };
