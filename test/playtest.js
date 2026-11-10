/*
 * Playtest report: 4 bot players play every game end-to-end with human-ish
 * reaction times, and we measure what the design research says matters:
 * session length, how often each player gets to act, the longest stretch a
 * player sits idle ("dead air"), and the number of reveal moments.
 *
 * Runs at 10× speed (server timers and bot delays are divided by SPEED) and
 * reports real-time equivalents.   node test/playtest.js
 * AGPLv3 — see LICENSE.
 */
'use strict';

const SPEED = 10;
const T = (ms) => String(Math.round(ms / SPEED));
const { startServer, until, sleep, makeHost, makePlayer } = require('./helpers');
const { decide, thinkMs } = require('../games/bot-brain');

const GAMES = (process.env.GAMES || 'quiplash,fibbage,trivia,closest,majority,mostlikely,imposter,twotruths,telephone,cah,minigames,crush').split(',');
const NAMES = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'].slice(0, +(process.env.PLAYERS || 4));

(async () => {
  const srv = await startServer({
    RUMPUS_ANSWER_MS: T(75000), RUMPUS_VOTE_MS: T(20000), RUMPUS_RESULTS_MS: T(7000), RUMPUS_ROUNDS: '2',
    RUMPUS_TRIVIA_QUESTION_MS: T(20000), RUMPUS_TRIVIA_REVEAL_MS: T(8000), RUMPUS_TRIVIA_CATEGORY_MS: T(12000), RUMPUS_TRIVIA_ROUNDS: '10',
    RUMPUS_FIB_BLUFF_MS: T(45000), RUMPUS_FIB_CHOOSE_MS: T(30000), RUMPUS_FIB_REVEAL_MS: T(10000), RUMPUS_FIB_ROUNDS: '5',
    RUMPUS_CAH_REVEAL_MS: T(10000), RUMPUS_CAH_ROUNDS: '8', RUMPUS_REVEAL_MS: T(7000),
    RUMPUS_CG_GUESS_MS: T(30000), RUMPUS_MR_ANSWER_MS: T(30000), RUMPUS_ML_VOTE_MS: T(25000),
    RUMPUS_IMP_CLUE_MS: T(40000), RUMPUS_IMP_VOTE_MS: T(40000), RUMPUS_IMP_GUESS_MS: T(20000),
    RUMPUS_TT_WRITE_MS: T(90000), RUMPUS_TT_GUESS_MS: T(25000),
    RUMPUS_TEL_WRITE_MS: T(45000), RUMPUS_TEL_DRAW_MS: T(60000), RUMPUS_TEL_DESCRIBE_MS: T(40000), RUMPUS_TEL_ENTRY_MS: T(3500), RUMPUS_TEL_VOTE_MS: T(30000),
    RUMPUS_TEL_FAV_MS: T(10000),
    RUMPUS_MG_INTRO_MS: T(3500), RUMPUS_MG_RESULT_MS: T(4500), RUMPUS_MG_TUG_MS: T(15000), RUMPUS_MG_DRAW_WINDOW: T(4000), RUMPUS_MG_DRAW_MIN: T(2000), RUMPUS_MG_DRAW_MAX: T(5000),
    RUMPUS_MG_FLY_SHOW_MS: T(5000), RUMPUS_MG_FLY_GUESS_MS: T(10000), RUMPUS_MG_ROAST_MS: T(12000),
    RUMPUS_WZ_PICK_MS: T(12000), RUMPUS_WZ_STEP_MS: T(900), RUMPUS_WZ_FINAL_MS: T(7000),
    RUMPUS_ST_ROLES_MS: T(20000), RUMPUS_ST_TALK_MS: T(60000), RUMPUS_ST_VOTE_MS: T(20000), RUMPUS_ST_VOTE_SHOW_MS: T(5000), RUMPUS_ST_CREW_MS: T(20000), RUMPUS_ST_CARD_MS: T(1600), RUMPUS_ST_ACCUSE_MS: T(25000), RUMPUS_ST_FINAL_MS: T(9000),
    RUMPUS_LL_INTRO_MS: T(4000), RUMPUS_LL_PLAY_MS: T(40000), RUMPUS_LL_RESULT_MS: T(5000), RUMPUS_LL_TICK_MS: T(1000 / 30),
    RUMPUS_LC_LEAD_MS: T(1800), RUMPUS_LC_RESULT_MS: T(5000), RUMPUS_LC_GRACE_MS: T(600), RUMPUS_LC_TEMPO: String(SPEED),
    RUMPUS_CR_MINGLE_MS: T(45000), RUMPUS_CR_REPLY_MS: T(25000), RUMPUS_MR_BET_WINDOW_MS: T(8000), RUMPUS_CR_PICK_MS: T(20000), RUMPUS_CR_REVEAL_STEP_MS: T(1800),
  });
  const rows = [];
  try {
    for (const gameId of GAMES) {
      const h = await makeHost(srv);
      const bots = [];
      for (const n of NAMES) bots.push(await makePlayer(srv, h.code, n));
      await until(() => h.state.players.length === NAMES.length, 'joined');
      const stats = new Map(bots.map((b) => [b.nickname, { actions: 0, lastActive: 0, maxIdle: 0, lastAt: 'start', idleAt: '' }]));
      const where = () => `${h.state.phase}${h.state.gameState && h.state.gameState.mini ? ':' + h.state.gameState.mini : ''}`;
      let reveals = 0, phases = 0, lastPhase = null;
      const t0 = Date.now();
      h.emit('host:startGame', { gameId });
      // Each bot: whenever its phone shows something to do, think a bit, then act.
      const busy = new Set();
      const act = async (b) => {
        const s = b.state;
        if (!s || busy.has(b.nickname)) return;
        const html = JSON.stringify(s.gameState) + JSON.stringify(s.you);
        const d = decide(s);
        const payload = d && d.payload;
        if (!payload) return;
        busy.add(b.nickname);
        // Human-ish think time: writing takes longer than tapping.
        await sleep(thinkMs(d.kind) / SPEED);
        busy.delete(b.nickname);
        // A person whose screen moved on doesn't act; a live counter ticking over doesn't stop them.
        const again = decide(b.state);
        const sameAction = again && Object.keys(again.payload).join() === Object.keys(payload).join();
        if (JSON.stringify(b.state.gameState) + JSON.stringify(b.state.you) !== html && !sameAction) return;
        b.submit(payload);
        const st = stats.get(b.nickname);
        const now = Date.now();
        if (now - (st.lastActive || t0) > st.maxIdle) { st.maxIdle = now - (st.lastActive || t0); st.idleAt = `${st.lastAt} → ${where()}`; }
        st.lastActive = now;
        st.lastAt = where();
        st.actions++;
      };
      while (h.state.phase !== 'gameover') {
        if (h.state.phase !== lastPhase) { phases++; if (/reveal|results|result$/.test(h.state.phase)) reveals++; lastPhase = h.state.phase; }
        bots.forEach(act);
        await sleep(15);
        if (Date.now() - t0 > 25 * 60000 / SPEED) break;
      }
      const dur = (Date.now() - t0) * SPEED;
      const end = Date.now();
      const st = [...stats.values()].map((x) => (end - (x.lastActive || t0) > x.maxIdle ? { ...x, maxIdle: end - (x.lastActive || t0), idleAt: `${x.lastAt} → end` } : x));
      const worst = st.reduce((a, b) => (b.maxIdle > a.maxIdle ? b : a));
      rows.push({
        game: gameId,
        minutes: +(dur / 60000).toFixed(1),
        actionsPerPlayer: +(st.reduce((n, x) => n + x.actions, 0) / st.length).toFixed(1),
        actionsPerMin: +((st.reduce((n, x) => n + x.actions, 0) / st.length) / (dur / 60000)).toFixed(1),
        worstIdleSec: Math.round(worst.maxIdle * SPEED / 1000),
        worstIdleAt: worst.idleAt, // the screen where that player last acted → where they next could
        reveals,
        screens: phases,
      });
      bots.forEach((b) => b.sock.disconnect());
      h.sock.disconnect();
    }
  } finally {
    await srv.stop();
  }
  console.table(rows);
  console.log(JSON.stringify(rows));
})().catch((e) => { console.error(e); process.exit(1); });
