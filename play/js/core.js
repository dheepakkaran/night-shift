// core.js: shared state, the live log stream, and the one game clock every screen reads.
// Classic scripts (no build step); load order: core.js, lib.js, audio.js, world.js, ui.js, main.js.

const $ = id => document.getElementById(id);
let cv = $("world"), cx = cv.getContext("2d");          // swapped briefly when drawing portraits or the PIP
const LW = 1000, LH = 640;                              // logical world size
const PALETTE = {red: "#e5534b", blue: "#4c8dff", green: "#3fb950", orange: "#f0883e", purple: "#a371f7", teal: "#2bb3a3",
  pink: "#f778ba", brown: "#9e6a3a", white: "#e6edf3", yellow: "#e3b341", grey: "#8b949e", lime: "#a5d63f", navy: "#3b5bdb",
  maroon: "#a33a3a", olive: "#8a8a2e"};
const colOf = p => PALETTE[p.colour] || (String(p.colour || "").startsWith("#") ? p.colour : "#ccc");
const dupNo = p => { const m = /#(\d+)$/.exec(p.name || ""); return m ? m[1] : null; };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const store = { get(k, d) { try { const v = localStorage.getItem("ns." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem("ns." + k, JSON.stringify(v)); } catch {} } };

// game + frames (filled by feedFrames in lib.js)
let game = null, frames = [], idx = 0, runDir = null, RT = true, TASK_ROOMS = new Set(), PACED = true;
let FB = null, PS = null, KREADY = [], SREADY = [], TASKDONE = [], TURN_TS = null, TURN_EVENT = null;
let EVENTS = [], EJECT_AT = {}, THOUGHTS = [], COMMENTS = [], HIT = [];
// view state
let TRUTH = false, SEL = null, AUTO = true, DIR = null, POV = null, CAM = null, KILLCAM = null;
let SOUND = store.get("sound", true), VOICE = store.get("voice", false), AC = null, MUS = null, SPOKEN = 0;
let MODE = store.get("mode", "spectator");              // spectator: the audience is told the impostor; detective: guess
let GUESS = null;                                       // detective mode: the player the viewer suspects
const Z = 2.2, KC_MS = 2800, FACE = {};
let fogC = null, seaCache = null, DRAW_SND = {run: null, locked: -1, hl: -1, spun: null};
const GEO = () => game.map.geometry;
// legacy names some lib.js functions still read
let playing = true, liveTimer = null, lastSide = -1, CAPTION_COMMENT = null;

// ---------- clock: game time shown = wall time + offset; live runs ~0.8 s behind the newest event
let CLOCK = null, GT = 0, TF = 1;                       // GT = game seconds on screen, TF = fraction inside frames[idx]
const LIVE_DELAY = 1.2;                                 // a small buffer so late log lines never freeze the picture
function clockStart(live) {
  const first = frames.length ? (live ? frames[frames.length - 1].ts : frames[0].ts) : 0;
  CLOCK = {live, off: first - performance.now() / 1000};
  if (live) idx = Math.max(0, frames.length - 1); else idx = 0;
}
function clockTick() {                                  // advance idx to the displayed time; returns newly entered frames
  if (!CLOCK || !frames.length) return [];
  const last = frames[frames.length - 1].ts;
  let target = performance.now() / 1000 + CLOCK.off - (CLOCK.live ? LIVE_DELAY : 0);
  if (target > last) { target = last; if (!CLOCK.live) CLOCK.done = true; }
  if (CLOCK.live && frames[idx].ts < target - 8) idx = frames.length - 1;       // tab was hidden: jump to now
  const entered = [];
  while (idx < frames.length - 1 && frames[idx + 1].ts <= target) { idx++; entered.push(idx); }
  const f = frames[idx], g = frames[idx + 1];
  TF = g && g.ts > f.ts ? Math.max(0, Math.min(1, (target - f.ts) / (g.ts - f.ts))) : 1;
  GT = g && g.ts > f.ts ? f.ts + (g.ts - f.ts) * TF : f.ts;
  return entered;
}

// ---------- loading: whole log once, then only the new bytes
let TAIL = {ev: 0, pr: 0, gameAt: 0}, LOADING = false, POLL = null;
async function openRun(dir, {live = null} = {}) {
  clearInterval(POLL); POLL = null;
  runDir = dir; TAIL = {ev: 0, pr: 0, gameAt: 0}; THOUGHTS = []; COMMENTS = []; frames = []; FB = null; PS = null;
  TURN_TS = null; TURN_EVENT = null; KILLCAM = null; CAM = null; DIR = null; GUESS = null; DRAW_SND = {run: null, locked: -1, hl: -1, spun: null};
  TRUTH = MODE === "spectator" ? false : false;          // roles are revealed by the impostor draw (spectator mode)
  await pull(true);
  const running = live ?? !game.winner;
  clockStart(running);
  if (running) POLL = setInterval(() => pull(false), 300);
  UI.onOpen(running);
}
async function pull(fresh) {
  if (LOADING || !runDir) return; LOADING = true;
  try {
    const dir = runDir;
    if (fresh || Date.now() - TAIL.gameAt > 2000) {
      game = await fetch(`/${dir}/game.json?t=${Date.now()}`).then(r => r.json()); TAIL.gameAt = Date.now();
      RT = game.mode === "realtime";
      TASK_ROOMS = new Set(Object.values(game.map.tasks || {}).flatMap(t => t.steps.map(s => s[0])));
    }
    const ev = await tail(`${dir}/events.jsonl`, TAIL.ev); TAIL.ev = ev.size;
    const pr = await tail(`${dir}/private.jsonl`, TAIL.pr); TAIL.pr = pr.size;
    for (const x of pr.lines) if (x.thought) THOUGHTS.push(x);
    if (!fresh && !ev.lines.length) { if (game.winner != null && CLOCK && CLOCK.live) finishLive(); return; }
    const n0 = frames.length;
    if (fresh) buildFrames(ev.lines); else feedFrames(ev.lines);
    if (TURN_TS == null && frames.some(f => (f.events || []).some(e => e.e === "turn"))) {      // roles are now in game.json
      game = await fetch(`/${dir}/game.json?t=${Date.now()}`).then(r => r.json()); TAIL.gameAt = Date.now(); PS = null; }
    buildIndex(fresh ? 0 : n0); buildPov(fresh || !PS ? 0 : n0);
    if (CLOCK && CLOCK.live && frames.length) CLOCK.off = Math.max(CLOCK.off, frames[frames.length - 1].ts - performance.now() / 1000);
    if (game.winner != null && CLOCK && CLOCK.live) finishLive();
  } finally { LOADING = false; }
}
function finishLive() { clearInterval(POLL); POLL = null; if (CLOCK) CLOCK.live = false; UI.onLiveEnd(); }

// ---------- small shared helpers
const sortedAlive = f => game.players.filter(p => f.alive && f.alive[p.pid]);
const impostorOf = () => TURN_EVENT ? TURN_EVENT.impostors : [];
function audienceKnows() { return MODE === "spectator" && TURN_TS != null && GT >= TURN_TS + 4.2; }
