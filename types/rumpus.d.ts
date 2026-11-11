/**
 * Shared types for HomeJack (checked with `tsc --checkJs`, see scripts/typecheck.sh).
 * Server/game objects are typed here; the browser code is typed via the DOM lib
 * plus the small conveniences at the bottom.
 */

// ------------------------------------------------------------------ server side
interface RoomSettings {
  rounds: number | null;
  timerScale: 0.6 | 1 | 1.5 | 2 | number;
  spicy: boolean;
  /** Red vs Blue team mode. */
  teams: boolean;
  /** UI + content language (French pack for prompt games). */
  lang?: 'en' | 'fr';
}

interface Player {
  id: string;
  token: string;
  nickname: string;
  socket: any;
  score: number;
  connected: boolean;
  avatar: number;
  team?: 'red' | 'blue' | null;
  look?: Record<string, number> | null;
  dropTimer?: NodeJS.Timeout | null;
  lastReact?: number;
  /** Test bot (driven by games/bot-brain.js). */
  bot?: boolean;
  botTimer?: NodeJS.Timeout | null;
  /** The phone's own id (kept in its browser): reconnects from any tab get this seat back. */
  device?: string | null;
}

interface PaceVotes {
  key: string | null;
  ready: Set<string>;
  hurry: Set<string>;
  wrap: Set<string>;
  skipq: Set<string>;
}

interface Room {
  code: string;
  hostToken: string;
  hostSocket: any;
  players: Map<string, Player>;
  /** Tonight's best moments (games/stats.js). */
  /** Set on a room restored after a restart: the game that was cut short (told to the TV once). */
  interrupted?: string | null;
  highlights?: { game: string, prompt?: string, text?: string, image?: string, by: string, note: string, at?: number }[];
  /** Game night playlist (server.js) or null. */
  night?: { total: number, played: string[], points: Map<string, number>, timer?: NodeJS.Timeout | null, nextAt?: number } | null;
  game: GameLike | null;
  closed: boolean;
  settings: RoomSettings;
  pace: PaceVotes;
  closeTimer?: NodeJS.Timeout | null;
  /** Pending coalesced state update (core/rooms.js broadcast). */
  flushTimer?: NodeJS.Timeout | null;
  lastFlush?: number;
  dbgKey?: string;
}

interface GameMeta {
  id: string;
  name: string;
  blurb: string;
  minPlayers: number;
}

/** What server.js relies on from every game module. */
interface GameLike {
  room: Room;
  phase: string;
  round: number;
  totalRounds: number;
  endsAt: number | null;
  timerFn: (() => void) | null;
  timer: NodeJS.Timeout | null;
  matchIndex?: number;
  revealIndex?: number;
  /** Game night: this game's placings were already added. */
  nightCounted?: boolean;
  /** All-time stats already recorded for this game over. */
  statsRecorded?: boolean;
  skipSeq?: number;
  subject?: string;
  skippablePhases?: string[];
  /** Real-time game (tap/tilt/rhythm): phones vote to end the round rather than hurry answers. */
  realtime?: boolean;
  /** Content pool + item currently on screen (for skip/answer telemetry). */
  poolName?: string;
  item?: { id?: string; src?: string } | null;
  start(): void;
  destroy(): void;
  skip(): void;
  skipQuestion?(): void;
  setTimer(ms: number, fn: () => void, scale?: boolean): void;
  mult?(): number;
  handleSubmit(playerId: string, payload: Record<string, any>): void;
  onPlayerLeft(playerId: string): void;
  hostGameState(): Record<string, any>;
  playerView(playerId: string): { gameState: Record<string, any>; you: Record<string, any> };
}

/** Content-pool item (games/data/pools/*.json). */
interface PoolItem {
  id: string;
  /** 18+ */
  a: boolean;
  text?: string;
  q?: string;
  /** Content language ('en' when absent). */
  lang?: string;
  [k: string]: any;
}

// ------------------------------------------------------------------ browser side
interface RumpusClock {
  FPS: number;
  add(fn: (frame: number) => void): () => void;
  frame(): number;
  stats(): { fps: number; medianFps: number; avgMs: number; maxMs: number; samples: number };
  resetStats(): void;
}

/** window.Rumpus — modules attach themselves as each script loads, so every member is optional at the type level. */
// Each page loads these modules before its own code runs, so they're declared present
// (not optional): `window.Rumpus = window.Rumpus || {}` in every module just builds it up.
interface RumpusNS {
  clock: RumpusClock;
  /** QR code image URL for a join link (server /qr.svg, or drawn in the page in the browser build). */
  qrSrc(text: string): string;
  /** A buzz on the phone (Android vibrate; iPhone switch-tick fallback). */
  haptic(pattern: number | number[]): void;
  /** Server clock: `now()` is server time in ms (synced over the socket). */
  time: { sync(socket: any): void; now(): number; offset(): number; rtt(): number | null };
  /** Game-night leaderboard (games.js). */
  nightTable(night: any, between?: boolean): string;
  esc(s: unknown): string;
  store(key: string, val?: any): any;
  morph(target: Element, html: string): void;
  fit(el: HTMLElement, opts?: { max?: number; min?: number; maxLines?: number }): void;
  fitAll(root: Element): void;
  register(id: string, impl: { host(s: any): string; player(s: any): string; bind?(root: HTMLElement, api: any): void; narrate?(s: any): string | null; moment?(s: any): { shakeAt?: number, confettiAt?: number } | null }): void;
  games: Record<string, any>;
  /** The remaining modules (sprites, music, fx, debug, …) are attached at runtime. */
  [module: string]: any;
}

interface Window {
  Rumpus: RumpusNS;
  webkitAudioContext?: typeof AudioContext;
  io: (...args: any[]) => any;
}

/** socket.io client global (loaded from /socket.io/socket.io.js). */
declare var io: (...args: any[]) => any;

interface Performance {
  /** Chrome-only heap stats (debug panel). */
  memory?: { usedJSHeapSize: number };
}
