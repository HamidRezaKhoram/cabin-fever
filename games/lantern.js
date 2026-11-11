/*
 * "Lantern Lake" — tilt your phone to glide a paper lantern-boat across the lake at dusk.
 * Six scenes (a game plays four, picked by its seed): Firefly Catch, Moonbeam (king of the hill),
 * Raft Run (everyone steers one raft with the average of their tilts), Lily Pad Tag (bump to pass
 * "it"), Shrinking Pad (stay on, bump others off) and Duckling Herding (nudge ducklings home).
 * Design: docs/design/tilt-game-plan.md.
 * The server runs the physics at a fixed 30 Hz and streams compact frames to the TV only.
 * Original game; genre mechanics only. AGPLv3 — see LICENSE.
 */
'use strict';

const { BaseGame, guarded } = require('./base');

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
const FREE_PTS_PER_S = 6, TAG_IMMUNE = 30;                 // tag: points while you're not "it"; no tag-backs for 1 s
const PAD_START = 82, PAD_END = 26, PAD_PTS_PER_S = 5, PAD_SURVIVOR = 60;
const DUCK_R = 5, DUCKS = 5, NEST_R = 20, DUCK_PTS = 40;

/** @typedef {'fireflies' | 'moonbeam' | 'raft' | 'tag' | 'sumo' | 'herd'} SceneId */
/** @type {Record<SceneId, { name: string, rule: string }>} */
const SCENES = {
  fireflies: { name: 'Firefly Catch', rule: 'Glide into the fireflies — gold ones are worth triple!' },
  moonbeam: { name: 'Moonbeam', rule: 'Stay in the moon’s reflection. Bump the others out!' },
  raft: { name: 'Raft Run', rule: 'One raft, everyone steers. Tilt together to catch the lanterns!' },
  tag: { name: 'Lily Pad Tag', rule: 'The glowing boat is IT. Bump someone to pass it on — points for every second you’re not it!' },
  sumo: { name: 'Shrinking Pad', rule: 'Stay on the giant lily pad as it shrinks. Bump the others off!' },
  herd: { name: 'Duckling Herding', rule: 'Nudge the ducklings into the nest. Last boat to touch one scores it!' },
};
/** RUMPUS_LL_ORDER=a,b,c fixes the scenes (tests); otherwise each game picks its own. */
const ORDER = /** @type {SceneId[]} */ ((process.env.RUMPUS_LL_ORDER || '').split(',').filter((x) => x in SCENES));

/** @typedef {{ x: number, y: number, vx: number, vy: number }} Body */

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
    this.totalRounds = ORDER.length || Math.min(6, this.rounds(4));
    /** @type {SceneId[]} this game's scenes (always one co-op raft run, the rest by seed) */
    this.scenes = ORDER.length ? ORDER : (() => {
      const others = this.rng.shuffle(/** @type {SceneId[]} */ (['fireflies', 'moonbeam', 'tag', 'sumo', 'herd'])).slice(0, Math.max(0, this.totalRounds - 1));
      // The raft (everyone together) comes second-to-last: a breather before the finale.
      others.splice(Math.max(0, others.length - 1), 0, 'raft');
      return others;
    })();
    /** @type {string | null} tag: who is "it" */
    this.it = null;
    this.tagCooldown = 0;
    this.pad = { x: W / 2, y: H / 2, r: PAD_START };
    /** @type {Set<string>} sumo: who fell off */
    this.out = new Set();
    /** @type {(Body & { last: string | null })[]} */
    this.ducks = [];
    this.noPaceVotes = true;
    /** @type {SceneId} */
    this.scene = 'fireflies';
    /** @type {string[]} boat order (frames refer to boats by index) */
    this.order = [];
    /** @type {Map<string, Body>} */
    this.boats = new Map();
    /** @type {Map<string, number>} each phone's latest steering counter */
    this.tiltSeq = new Map();
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

  mult() { return this.totalRounds === 3 ? (this.round >= 3 ? 3 : this.round === 2 ? 2 : 1) : super.mult(); }
  rnd() { return this.rng.next(); }

  destroy() { this.stopLoop(); super.destroy(); }
  stopLoop() { if (this.loop) clearInterval(this.loop); this.loop = null; }

  start() { this.nextRound(); }

  nextRound() {
    if (this.round >= this.totalRounds) return this.gameOver();
    this.round += 1;
    this.scene = this.scenes[(this.round - 1) % this.scenes.length];
    this.order = this.playerIds();
    // Boats start spread around the shore — except on the Shrinking Pad, where they start in a
    // ring well inside the pad (the shore is off it: they would all splash on the first tick).
    const [rx, ry] = this.scene === 'sumo' ? [PAD_START * 0.6, PAD_START * 0.6] : [110, 60];
    this.boats = new Map(this.order.map((id, i) => {
      const a = (i / Math.max(1, this.order.length)) * Math.PI * 2;
      return [id, { x: W / 2 + Math.cos(a) * rx, y: H / 2 + Math.sin(a) * ry, vx: 0, vy: 0 }];
    }));
    this.tilt = new Map();
    this.flies = [];
    this.gained = new Map();
    this.acc = new Map();
    this.raft = { x: 40, y: H / 2, vx: 0, vy: 0 };
    this.raftHaul = 0;
    this.lanterns = [];
    this.rocks = this.scene === 'raft' ? Array.from({ length: ROCKS }, (_, i) => ({ x: 90 + i * 45 + this.rnd() * 20, y: 25 + this.rnd() * (H - 50), r: 8 + this.rnd() * 6 })) : [];
    this.it = this.scene === 'tag' && this.order.length ? this.rng.pick(this.order) : null;
    this.tagCooldown = TAG_IMMUNE;
    this.pad = { x: W / 2, y: H / 2, r: PAD_START };
    this.out = new Set();
    this.ducks = this.scene === 'herd' ? Array.from({ length: DUCKS }, () => this.duckAtShore()) : [];
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
    this.loop = setInterval(() => guarded(() => this.tick(), 'lantern tick'), TICK_MS);
    this.push();
  }

  /** @param {string} id @param {Record<string, any>} payload */
  handleSubmit(id, payload) {
    if (this.phase !== 'll-play' && this.phase !== 'll-intro') return;
    const t = cleanTilt(payload.tilt);
    if (!t) return;
    // Steering may arrive out of order (the fast channel): an older one never replaces a newer one.
    // (A counter far below the last one is a phone that reloaded: start again from it.)
    const n = Number(payload.n);
    if (Number.isFinite(n)) {
      const last = this.tiltSeq.get(id);
      if (last !== undefined && n <= last && n > last - 5000) return;
      this.tiltSeq.set(id, n);
    }
    this.tilt.set(id, t);
  }

  /** @param {string} id @param {number} pts */
  give(id, pts) {
    if (!pts) return;
    this.gained.set(id, (this.gained.get(id) || 0) + this.award(id, pts));
  }

  spawnFly() {
    this.flies.push({ x: 20 + this.rnd() * (W - 40), y: 20 + this.rnd() * (H - 40), gold: this.rnd() < 0.15, ph: this.rnd() * 6.28 });
  }

  /** A duckling paddling in from somewhere along the shore. */
  duckAtShore() {
    const side = this.rng.int(0, 3);
    const t = this.rnd();
    const x = side === 0 ? 12 : side === 1 ? W - 12 : 20 + t * (W - 40);
    const y = side === 2 ? 12 : side === 3 ? H - 12 : 20 + t * (H - 40);
    return { x, y, vx: 0, vy: 0, last: null };
  }

  spawnLantern() {
    for (let k = 0; k < 20; k++) {
      const l = { x: 30 + this.rnd() * (W - 60), y: 20 + this.rnd() * (H - 40) };
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
      for (const [id, b] of this.boats) if (!this.out.has(id)) stepBody(b, this.tilt.get(id) || zero, ACCEL, BOAT_R);
      const list = [...this.boats.entries()].filter(([id]) => !this.out.has(id));
      if (this.tagCooldown > 0) this.tagCooldown--;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const [ia, a] = list[i], [ib, b] = list[j];
        const speed = Math.hypot(a.vx - b.vx, a.vy - b.vy);
        if (!collide(a, b, BOAT_R)) continue;
        if (speed > 1.2) this.bumps.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        // Tag: touching "it" passes it on (after a second, so there are no instant tag-backs).
        if (this.scene === 'tag' && this.tagCooldown === 0 && (ia === this.it || ib === this.it)) {
          this.it = ia === this.it ? ib : ia;
          this.tagCooldown = TAG_IMMUNE;
          this.caught.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, who: this.order.indexOf(this.it), gold: false });
          this.push();
        }
      }
      if (this.scene === 'fireflies') this.tickFlies();
      else if (this.scene === 'moonbeam') this.tickMoon();
      else if (this.scene === 'tag') this.tickTag();
      else if (this.scene === 'sumo') this.tickSumo();
      else this.tickHerd();
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

  /** Points trickle in (whole points, fractions carried) for everyone `who` says. @param {(id: string) => boolean} who @param {number} perS */
  trickle(who, perS) {
    for (const id of this.boats.keys()) {
      if (!who(id)) continue;
      const a = (this.acc.get(id) || 0) + perS / 30;
      const whole = Math.floor(a);
      this.acc.set(id, a - whole);
      if (whole) this.give(id, whole);
    }
  }

  tickTag() {
    if (this.it && !this.room.players.has(this.it)) this.it = this.rng.pick(this.playerIds());
    this.trickle((id) => id !== this.it, FREE_PTS_PER_S);
    if (this.tickNo % 15 === 0) this.push();
  }

  tickSumo() {
    // The pad shrinks from PAD_START to PAD_END over the scene; off the pad = splash (out).
    const t = Math.min(1, (this.tickNo * TICK_MS) / PLAY_MS);
    this.pad.r = PAD_START - (PAD_START - PAD_END) * t;
    for (const [id, b] of this.boats) {
      if (this.out.has(id)) continue;
      if (Math.hypot(b.x - this.pad.x, b.y - this.pad.y) > this.pad.r + BOAT_R * 0.4) {
        this.out.add(id);
        this.bumps.push({ x: b.x, y: b.y });
        this.push();
      }
    }
    this.trickle((id) => !this.out.has(id), PAD_PTS_PER_S);
    const left = [...this.boats.keys()].filter((id) => !this.out.has(id) && this.room.players.has(id));
    if (left.length <= 1 && this.boats.size > 1) { for (const id of left) this.give(id, PAD_SURVIVOR); return this.finish(); }
    if (this.tickNo % 15 === 0) this.push();
  }

  tickHerd() {
    const zero = [0, 0];
    const nest = { x: W / 2, y: H / 2 };
    for (const d of this.ducks) {
      // Ducklings drift a little on their own, and get pushed by boats.
      stepBody(d, zero, 0, DUCK_R);
      d.vx *= 0.97; d.vy *= 0.97;
      for (const [id, b] of this.boats) {
        if (collide(b, d, (BOAT_R + DUCK_R) / 2)) { d.last = id; d.vx += b.vx * 0.3; d.vy += b.vy * 0.3; }
      }
    }
    let got = false;
    this.ducks = this.ducks.map((d) => {
      if (Math.hypot(d.x - nest.x, d.y - nest.y) > NEST_R) return d;
      if (d.last) { this.give(d.last, DUCK_PTS); this.caught.push({ x: d.x, y: d.y, who: this.order.indexOf(d.last), gold: true }); got = true; }
      return this.duckAtShore();
    });
    if (got || this.tickNo % 15 === 0) this.push();
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
      it: this.scene === 'tag' && this.it ? this.order.indexOf(this.it) : -1,
      pad: this.scene === 'sumo' ? [q(this.pad.x), q(this.pad.y), q(this.pad.r)] : null,
      out: this.scene === 'sumo' ? this.order.map((id) => (this.out.has(id) ? 1 : 0)) : null,
      ducks: this.ducks.map((d) => [q(d.x), q(d.y)]),
      nest: this.scene === 'herd' ? [W / 2, H / 2, NEST_R] : null,
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
    else if (this.scene === 'sumo') target = [this.pad.x, this.pad.y];
    else if (this.scene === 'tag' && b && this.it && this.it !== id) {
      // Run away from "it": point the arrow the other way.
      const it = this.boats.get(this.it);
      if (it) target = [clamp(b.x * 2 - it.x, 0, W), clamp(b.y * 2 - it.y, 0, H)];
    } else if (this.scene === 'tag' && b && this.it === id) {
      const others = [...this.boats.entries()].filter(([x]) => x !== id).map(([, o]) => o);
      if (others.length) { const o = others.reduce((a, x) => (Math.hypot(x.x - b.x, x.y - b.y) < Math.hypot(a.x - b.x, a.y - b.y) ? x : a)); target = [o.x, o.y]; }
    } else if (this.scene === 'herd' && b && this.ducks.length) {
      // Get behind the nearest duckling (on the far side from the nest) and push it in.
      const d = this.ducks.reduce((a, x) => (Math.hypot(x.x - b.x, x.y - b.y) < Math.hypot(a.x - b.x, a.y - b.y) ? x : a));
      const away = Math.hypot(d.x - W / 2, d.y - H / 2) || 1;
      const bx = d.x + ((d.x - W / 2) / away) * 12, by = d.y + ((d.y - H / 2) / away) * 12;
      target = Math.hypot(b.x - bx, b.y - by) > 10 ? [bx, by] : [W / 2, H / 2];
    }
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
        it: this.scene === 'tag' && this.it === id,
        out: this.out.has(id),
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
  blurb: 'Tilt your phone to glide a lantern-boat at dusk: fireflies, moonbeams, tag, a shrinking lily pad, ducklings — and one raft steered together.',
  minPlayers: 2,
};
LanternGame.cleanTilt = cleanTilt;
LanternGame.stepBody = stepBody;
LanternGame.collide = collide;
LanternGame.WORLD = { W, H };

module.exports = LanternGame;
