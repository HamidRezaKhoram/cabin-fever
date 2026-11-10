/*
 * "Lantern Lake" — tilt your phone to glide a paper lantern-boat across the lake at dusk.
 * Three scenes: Firefly Catch, Moonbeam (king of the hill), Raft Run (everyone steers one raft
 * with the average of their tilts). Design: docs/design/tilt-game-plan.md.
 * The server runs the physics at a fixed 30 Hz and streams compact frames to the TV only.
 * Original game; genre mechanics only. AGPLv3 — see LICENSE.
 */
'use strict';

const crypto = require('crypto');
const { BaseGame } = require('./base');

const env = (/** @type {string} */ k, /** @type {number} */ d) => Number(process.env[k] || d);
const INTRO_MS = env('RUMPUS_LL_INTRO_MS', 4000);
const PLAY_MS = env('RUMPUS_LL_PLAY_MS', 40000);
const RESULT_MS = env('RUMPUS_LL_RESULT_MS', 5000);
const TICK_MS = env('RUMPUS_LL_TICK_MS', 1000 / 30);

const W = 320, H = 180;                 // world units (the TV canvas is drawn at this size ×N)
const BOAT_R = 7, ACCEL = 0.42, FRICTION = 0.9, MAX_V = 4.2;
const FLY_R = 4, MAX_FLIES = 6, FLY_PTS = 20, GOLD_PTS = 60;
const MOON_R = 26, MOON_PTS_PER_S = 10;
const RAFT_R = 14, RAFT_ACCEL = 0.3, LANTERN_PTS = 30, ROCKS = 5;

/** @typedef {'fireflies' | 'moonbeam' | 'raft'} SceneId */
/** @type {Record<SceneId, { name: string, rule: string }>} */
const SCENES = {
  fireflies: { name: 'Firefly Catch', rule: 'Glide into the fireflies — gold ones are worth triple!' },
  moonbeam: { name: 'Moonbeam', rule: 'Stay in the moon’s reflection. Bump the others out!' },
  raft: { name: 'Raft Run', rule: 'One raft, everyone steers. Tilt together to catch the lanterns!' },
};
const ORDER = /** @type {SceneId[]} */ (['fireflies', 'moonbeam', 'raft']);

/** @typedef {{ x: number, y: number, vx: number, vy: number }} Body */

const rnd = () => crypto.randomInt(1e6) / 1e6;
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Clean a phone's tilt: a vector in the unit disc with a small dead-zone. @param {unknown} t */
function cleanTilt(t) {
  if (!Array.isArray(t) || t.length !== 2) return null;
  let x = Number(t[0]), y = Number(t[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  if (Math.hypot(x, y) < 0.06) return [0, 0];
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
}

/** Move a body one tick: accelerate, damp, cap speed, bounce off the shore. @param {Body} b @param {number[]} tilt @param {number} accel @param {number} r */
function stepBody(b, tilt, accel, r) {
  b.vx = (b.vx + tilt[0] * accel) * FRICTION;
  b.vy = (b.vy + tilt[1] * accel) * FRICTION;
  const v = Math.hypot(b.vx, b.vy);
  if (v > MAX_V) { b.vx *= MAX_V / v; b.vy *= MAX_V / v; }
  b.x += b.vx; b.y += b.vy;
  let bounced = false;
  if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * 0.7; bounced = true; }
  if (b.x > W - r) { b.x = W - r; b.vx = -Math.abs(b.vx) * 0.7; bounced = true; }
  if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy) * 0.7; bounced = true; }
  if (b.y > H - r) { b.y = H - r; b.vy = -Math.abs(b.vy) * 0.7; bounced = true; }
  return bounced;
}

/** Equal-mass elastic bump between two circles; returns true if they touched. @param {Body} a @param {Body} b @param {number} r */
function collide(a, b, r) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (d >= 2 * r || d === 0) return false;
  const nx = dx / d, ny = dy / d;
  const push = (2 * r - d) / 2;
  a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
  const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rel > 0) { // approaching: swap the normal components (+ a little extra for a lively bump)
    const k = rel * 1.1;
    a.vx -= k * nx; a.vy -= k * ny; b.vx += k * nx; b.vy += k * ny;
  }
  return true;
}

class LanternGame extends BaseGame {
  /** @param {Room} room @param {() => void} push */
  constructor(room, push) {
    super(room, push);
    this.totalRounds = 3;
    this.noPaceVotes = true;
    /** @type {SceneId} */
    this.scene = 'fireflies';
    /** @type {string[]} boat order (frames refer to boats by index) */
    this.order = [];
    /** @type {Map<string, Body>} */
    this.boats = new Map();
    /** @type {Map<string, number[]>} */
    this.tilt = new Map();
    /** @type {{ x: number, y: number, gold: boolean, ph: number }[]} */
    this.flies = [];
    this.moon = { x: W / 2, y: H / 2, r: MOON_R };
    /** @type {Body} */
    this.raft = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    /** @type {{ x: number, y: number, r: number }[]} */
    this.rocks = [];
    /** @type {{ x: number, y: number }[]} */
    this.lanterns = [];
    /** @type {Map<string, number>} points this scene */
    this.gained = new Map();
    /** @type {Map<string, number>} raw (unmultiplied) score accumulators (moonbeam ticks, paddling) */
    this.acc = new Map();
    this.raftHaul = 0;
    this.tickNo = 0;
    /** @type {NodeJS.Timeout | null} */
    this.loop = null;
    /** @type {{ x: number, y: number }[]} */
    this.bumps = [];
    /** @type {{ x: number, y: number, who: number, gold: boolean }[]} */
    this.caught = [];
    this.result = null;
  }

  mult() { return this.round >= 3 ? 3 : this.round === 2 ? 2 : 1; }

  destroy() { this.stopLoop(); super.destroy(); }
  stopLoop() { if (this.loop) clearInterval(this.loop); this.loop = null; }

  start() { this.nextRound(); }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    this.scene = ORDER[(this.round - 1) % ORDER.length];
    this.order = this.playerIds();
    // Boats start spread around the shore.
    this.boats = new Map(this.order.map((id, i) => {
      const a = (i / Math.max(1, this.order.length)) * Math.PI * 2;
      return [id, { x: W / 2 + Math.cos(a) * 110, y: H / 2 + Math.sin(a) * 60, vx: 0, vy: 0 }];
    }));
    this.tilt = new Map();
    this.flies = [];
    this.gained = new Map();
    this.acc = new Map();
    this.raft = { x: 40, y: H / 2, vx: 0, vy: 0 };
    this.raftHaul = 0;
    this.lanterns = [];
    this.rocks = this.scene === 'raft' ? Array.from({ length: ROCKS }, (_, i) => ({ x: 90 + i * 45 + rnd() * 20, y: 25 + rnd() * (H - 50), r: 8 + rnd() * 6 })) : [];
    this.result = null;
    this.phase = 'll-intro';
    this.setTimer(INTRO_MS, () => this.play(), false);
    this.push();
  }

  play() {
    this.phase = 'll-play';
    this.tickNo = 0;
    this.setTimer(PLAY_MS, () => this.finish(), false);
    this.stopLoop();
    this.loop = setInterval(() => this.tick(), TICK_MS);
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase !== 'll-play' && this.phase !== 'll-intro') return;
    const t = cleanTilt(payload.tilt);
    if (t) this.tilt.set(id, t);
  }

  /** @param {string} id @param {number} pts */
  give(id, pts) {
    if (!pts) return;
    this.gained.set(id, (this.gained.get(id) || 0) + this.award(id, pts));
  }

  spawnFly() {
    this.flies.push({ x: 20 + rnd() * (W - 40), y: 20 + rnd() * (H - 40), gold: rnd() < 0.15, ph: rnd() * 6.28 });
  }

  spawnLantern() {
    for (let k = 0; k < 20; k++) {
      const l = { x: 30 + rnd() * (W - 60), y: 20 + rnd() * (H - 40) };
      if (this.rocks.every((r) => Math.hypot(r.x - l.x, r.y - l.y) > r.r + 12) && Math.hypot(this.raft.x - l.x, this.raft.y - l.y) > 50) { this.lanterns.push(l); return; }
    }
  }

  tick() {
    if (this.destroyed || this.phase !== 'll-play') return;
    this.tickNo++;
    this.bumps = [];
    this.caught = [];
    const zero = [0, 0];
    if (this.scene === 'raft') this.tickRaft();
    else {
      for (const [id, b] of this.boats) stepBody(b, this.tilt.get(id) || zero, ACCEL, BOAT_R);
      const list = [...this.boats.values()];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const speed = Math.hypot(a.vx - b.vx, a.vy - b.vy);
        if (collide(a, b, BOAT_R) && speed > 1.2) this.bumps.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
      if (this.scene === 'fireflies') this.tickFlies();
      else this.tickMoon();
    }
    this.frame(this.frameData());
  }

  tickFlies() {
    while (this.flies.length < MAX_FLIES) this.spawnFly();
    for (const f of this.flies) { f.ph += 0.05; f.x = clamp(f.x + Math.cos(f.ph) * 0.3, 8, W - 8); f.y = clamp(f.y + Math.sin(f.ph * 1.3) * 0.2, 8, H - 8); }
    let scored = false;
    this.flies = this.flies.filter((f) => {
      for (const [id, b] of this.boats) {
        if (Math.hypot(b.x - f.x, b.y - f.y) <= BOAT_R + FLY_R) {
          this.give(id, f.gold ? GOLD_PTS : FLY_PTS);
          this.caught.push({ x: f.x, y: f.y, who: this.order.indexOf(id), gold: f.gold });
          scored = true;
          return false;
        }
      }
      return true;
    });
    if (scored || this.tickNo % 15 === 0) this.push(); // phones' arrows and scores update twice a second
  }

  tickMoon() {
    // The reflection drifts on a slow lissajous path.
    const t = this.tickNo / 30;
    this.moon.x = W / 2 + Math.sin(t * 0.37) * 110;
    this.moon.y = H / 2 + Math.sin(t * 0.53 + 1) * 50;
    for (const [id, b] of this.boats) {
      if (Math.hypot(b.x - this.moon.x, b.y - this.moon.y) > this.moon.r) continue;
      const a = (this.acc.get(id) || 0) + MOON_PTS_PER_S / 30;
      const whole = Math.floor(a);
      this.acc.set(id, a - whole);
      if (whole) this.give(id, whole);
    }
    if (this.tickNo % 15 === 0) this.push(); // scores tick up on the phones twice a second
  }

  tickRaft() {
    // Everyone's tilt, averaged, steers the one raft.
    const ids = this.playerIds();
    const tilts = ids.map((id) => this.tilt.get(id) || [0, 0]);
    const avg = [tilts.reduce((s, t) => s + t[0], 0) / Math.max(1, ids.length), tilts.reduce((s, t) => s + t[1], 0) / Math.max(1, ids.length)];
    const r = this.raft;
    if (stepBody(r, avg, RAFT_ACCEL, RAFT_R)) this.bumps.push({ x: r.x, y: r.y });
    for (const rock of this.rocks) {
      const d = Math.hypot(r.x - rock.x, r.y - rock.y);
      if (d < RAFT_R + rock.r && d > 0) {
        const nx = (r.x - rock.x) / d, ny = (r.y - rock.y) / d;
        r.x = rock.x + nx * (RAFT_R + rock.r); r.y = rock.y + ny * (RAFT_R + rock.r);
        const dot = r.vx * nx + r.vy * ny;
        if (dot < 0) { r.vx -= 1.8 * dot * nx; r.vy -= 1.8 * dot * ny; this.bumps.push({ x: r.x - nx * RAFT_R, y: r.y - ny * RAFT_R }); }
      }
    }
    while (this.lanterns.length < 3) this.spawnLantern();
    // Good paddling: pulling toward the nearest lantern earns a personal bonus.
    const near = this.lanterns.reduce((a, l) => (Math.hypot(l.x - r.x, l.y - r.y) < Math.hypot(a.x - r.x, a.y - r.y) ? l : a), this.lanterns[0]);
    if (near) {
      const dx = near.x - r.x, dy = near.y - r.y, d = Math.hypot(dx, dy) || 1;
      ids.forEach((id, i) => {
        const align = Math.max(0, (tilts[i][0] * dx + tilts[i][1] * dy) / d);
        const a = (this.acc.get(id) || 0) + align * 0.1; // ≈ +3/s when pulling the right way
        const whole = Math.floor(a);
        this.acc.set(id, a - whole);
        if (whole) this.give(id, whole);
      });
    }
    let got = false;
    this.lanterns = this.lanterns.filter((l) => {
      if (Math.hypot(l.x - r.x, l.y - r.y) > RAFT_R + 5) return true;
      this.raftHaul += 1;
      for (const id of ids) this.give(id, LANTERN_PTS);
      this.caught.push({ x: l.x, y: l.y, who: -1, gold: true });
      got = true;
      return false;
    });
    if (got || this.tickNo % 15 === 0) this.push();
  }

  frameData() {
    const q = (/** @type {number} */ v) => Math.round(v * 10) / 10;
    return {
      n: this.tickNo,
      scene: this.scene,
      boats: this.order.map((id) => { const b = this.boats.get(id); return b && this.room.players.has(id) ? [q(b.x), q(b.y), q(b.vx), q(b.vy)] : null; }),
      flies: this.flies.map((f) => [q(f.x), q(f.y), f.gold ? 1 : 0]),
      moon: this.scene === 'moonbeam' ? [q(this.moon.x), q(this.moon.y), this.moon.r] : null,
      raft: this.scene === 'raft' ? [q(this.raft.x), q(this.raft.y), q(this.raft.vx), q(this.raft.vy)] : null,
      rocks: this.rocks.map((r) => [q(r.x), q(r.y), q(r.r)]),
      lanterns: this.lanterns.map((l) => [q(l.x), q(l.y)]),
      tilts: this.order.map((id) => this.tilt.get(id) || [0, 0]),
      bumps: this.bumps.map((b) => [q(b.x), q(b.y)]),
      caught: this.caught.map((c) => [q(c.x), q(c.y), c.who, c.gold ? 1 : 0]),
    };
  }

  finish() {
    if (this.phase !== 'll-play') return;
    this.stopLoop();
    this.result = {
      scene: this.scene, name: SCENES[this.scene].name, haul: this.scene === 'raft' ? this.raftHaul : null,
      rows: this.playerIds().map((id) => ({ nickname: this.nick(id), gained: this.gained.get(id) || 0 })).sort((a, b) => b.gained - a.gained),
    };
    this.phase = 'll-result';
    this.setTimer(RESULT_MS, () => this.nextRound(), false);
    this.push();
  }

  onPlayerLeft() { /* their boat stops being drawn; the scene goes on */ }

  // --- views -------------------------------------------------------------------

  sceneView() { return { scene: this.scene, sceneName: SCENES[this.scene].name, rule: SCENES[this.scene].rule, world: [W, H] }; }

  hostView() {
    return {
      ...this.sceneView(),
      boats: this.order.map((id) => ({ nickname: this.nick(id), gained: this.gained.get(id) || 0 })),
      haul: this.raftHaul,
      result: this.phase === 'll-result' ? this.result : null,
    };
  }

  /** @param {string} id */
  playerOnly(id) {
    const b = this.boats.get(id);
    // Where to head (bots steer by it; the phone shows a little arrow).
    /** @type {number[] | null} */
    let target = null;
    let from = b ? [b.x, b.y] : null;
    if (this.scene === 'fireflies' && b && this.flies.length) {
      const f = this.flies.reduce((a, x) => (Math.hypot(x.x - b.x, x.y - b.y) < Math.hypot(a.x - b.x, a.y - b.y) ? x : a));
      target = [f.x, f.y];
    } else if (this.scene === 'moonbeam') target = [this.moon.x, this.moon.y];
    else if (this.scene === 'raft' && this.lanterns.length) {
      const r = this.raft;
      const l = this.lanterns.reduce((a, x) => (Math.hypot(x.x - r.x, x.y - r.y) < Math.hypot(a.x - r.x, a.y - r.y) ? x : a));
      target = [l.x, l.y];
      from = [r.x, r.y];
    }
    const me = this.result && this.result.rows.find((r) => r.nickname === this.nick(id));
    return {
      gameState: { ...this.sceneView(), result: this.phase === 'll-result' ? this.result : null },
      you: {
        colour: this.order.indexOf(id),
        gained: this.gained.get(id) || 0,
        pos: from ? from.map((v) => Math.round(v)) : null,
        target: target ? target.map((v) => Math.round(v)) : null,
        result: me || null,
      },
    };
  }
}

LanternGame.meta = {
  id: 'lantern',
  name: 'Lantern Lake',
  blurb: 'Tilt your phone to glide a lantern-boat at dusk: catch fireflies, hog the moonbeam, steer one raft together.',
  minPlayers: 2,
};
LanternGame.cleanTilt = cleanTilt;
LanternGame.stepBody = stepBody;
LanternGame.collide = collide;
LanternGame.WORLD = { W, H };

module.exports = LanternGame;
