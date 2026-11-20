// world.js: the station on the canvas. A baked static map (3/4 view walls, room palettes, furniture, spots),
// light (room lamps, headlamps, lights-out), cameras (director / POV / whole map), the impostor PIP, kill cam.

// lib.js's drawPlayers still asks for these tick-mode helpers; real-time games carry exact x/y
function layout() { return {}; }
function crowd() { return 1; }
function lightsOut() {}          // light is drawn by drawLight below
function banner() {}             // alerts are shown in the HTML HUD

const ROOM_TINT = {Dock: "#26313a", Cargo: "#30291f", Garden: "#1f2e22", Lab: "#1c2a38", Archive: "#2b2532", Boiler: "#33241a",
  Office: "#232a36", Galley: "#2b2e24", "Watch Room": "#1f2633", Radio: "#212a31", Pumps: "#1b2e31", Ballast: "#212834",
  Workshop: "#2e271e", Clinic: "#1d302e", Vault: "#2d2c22"};
const LAMP = {Dock: "#ffd9a0", Cargo: "#ffcf8a", Garden: "#d8ffb0", Lab: "#bfe3ff", Archive: "#e6d0ff", Boiler: "#ffb070",
  Office: "#ffe8c0", Galley: "#fff0c8", "Watch Room": "#c8dcff", Radio: "#cfe8ff", Pumps: "#b8fff4", Ballast: "#c8d8ff",
  Workshop: "#ffd8a0", Clinic: "#c8fff0", Vault: "#fff2b0"};

let BAKE = null, BAKE_KEY = "";
function withCtx(canvas, fn) { const sv = cv, sx = cx; cv = canvas; cx = canvas.getContext("2d"); try { fn(); } finally { cv = sv; cx = sx; } }

function bakeMap(scale) {
  const key = runDir + "|" + scale;
  if (BAKE && BAKE_KEY === key) return BAKE;
  const c = document.createElement("canvas"); c.width = Math.round(LW * scale); c.height = Math.round(LH * scale);
  withCtx(c, () => {
    cx.setTransform(scale, 0, 0, scale, 0, 0);
    // night sea
    const sea = cx.createLinearGradient(0, 0, 0, LH); sea.addColorStop(0, "#07121d"); sea.addColorStop(1, "#04090f");
    cx.fillStyle = sea; cx.fillRect(0, 0, LW, LH);
    cx.strokeStyle = "rgba(120,170,220,.06)"; cx.lineWidth = 1.2;
    for (let y = 8; y < LH; y += 16) { cx.beginPath(); for (let x = 0; x <= LW; x += 20) cx.lineTo(x, y + Math.sin(x / 37 + y) * 2.5); cx.stroke(); }
    const R = rooms();
    // walkways: planks with rails
    cx.lineCap = "butt";
    for (const [a, b] of game.map.corridors) {
      cx.strokeStyle = "#0a0f15"; cx.lineWidth = 30; cx.beginPath(); cx.moveTo(R[a].x, R[a].y); cx.lineTo(R[b].x, R[b].y); cx.stroke();
      cx.strokeStyle = "#3a2f25"; cx.lineWidth = 24; cx.stroke();
      cx.setLineDash([2, 9]); cx.strokeStyle = "#2a2119"; cx.lineWidth = 24; cx.stroke(); cx.setLineDash([]);
      cx.strokeStyle = "rgba(255,220,170,.08)"; cx.lineWidth = 1; cx.stroke();
    }
    // rooms: drop shadow, floor with its own tint and tiles, a north wall with height, side walls
    for (const [name, r] of Object.entries(R)) {
      const B = box(r), x0 = B.x0, y0 = B.y0, w = B.w, h = B.h, tint = ROOM_TINT[name] || "#222c3a";
      cx.fillStyle = "rgba(0,0,0,.55)"; roundRect(x0 + 4, y0 + 8, w, h, 10); cx.fill();
      const g = cx.createLinearGradient(0, y0, 0, y0 + h); g.addColorStop(0, shade(tint, .18)); g.addColorStop(1, shade(tint, -.12));
      cx.fillStyle = g; roundRect(x0, y0, w, h, 10); cx.fill();
      cx.save(); roundRect(x0, y0, w, h, 10); cx.clip();
      cx.strokeStyle = "rgba(255,255,255,.035)"; cx.lineWidth = 1;
      for (let gx = x0 + 16; gx < x0 + w; gx += 16) { cx.beginPath(); cx.moveTo(gx, y0); cx.lineTo(gx, y0 + h); cx.stroke(); }
      for (let gy = y0 + 16; gy < y0 + h; gy += 16) { cx.beginPath(); cx.moveTo(x0, gy); cx.lineTo(x0 + w, gy); cx.stroke(); }
      const wall = cx.createLinearGradient(0, y0, 0, y0 + 20); wall.addColorStop(0, shade(tint, .45)); wall.addColorStop(1, shade(tint, .05));
      cx.fillStyle = wall; cx.fillRect(x0, y0, w, 20);                                  // the wall you look at
      cx.fillStyle = "rgba(0,0,0,.35)"; cx.fillRect(x0, y0 + 20, w, 4);                 // its shadow on the floor
      cx.fillStyle = "rgba(255,255,255,.12)"; cx.fillRect(x0, y0, w, 2);
      cx.restore();
      cx.strokeStyle = shade(tint, .5); cx.lineWidth = 2.5; roundRect(x0, y0, w, h, 10); cx.stroke();
      cx.fillStyle = "rgba(230,237,243,.78)"; cx.font = "800 10.5px system-ui"; cx.textAlign = "left"; cx.fillText(name.toUpperCase(), x0 + 9, y0 + 14);
      furniture(name, B);
    }
    // the useful spots, where they really are
    const st = game.map.stations, tags = {};
    for (const [k, v] of Object.entries(st)) for (const r of [].concat(v)) (tags[r] ||= []).push(k);
    for (const name of Object.keys(R)) {
      const sp = GEO().spots[name], at = k => k === "button" ? sp.button : ["admin", "vitals", "cams"].includes(k) ? sp.console : sp.panel;
      if (TASK_ROOMS.has(name)) prop("task", sp.task[0], sp.task[1]);
      for (const k of tags[name] || []) if (k !== "vitals" && k !== "pressure_fix") prop(k, at(k)[0], at(k)[1]);
      if (game.map.vents.some(n => n.includes(name))) prop("vent", sp.vent[0], sp.vent[1]);
    }
  });
  withCtx(c, () => { cx.setTransform(1, 0, 0, 1, 0, 0); cx.drawImage(bakeLamps(scale), 0, 0); });   // lamp light baked into the floor
  BAKE = c; BAKE_KEY = key; return c;
}

let BAKE_SCALE = 2;                                    // set from the main canvas each frame (the PIP reuses it)
function drawMap(f) {
  cx.drawImage(bakeMap(BAKE_SCALE), 0, 0, LW, LH);
  const st = game.map.stations;
  for (const r of [].concat(st.vitals)) { const sp = GEO().spots[r]; prop("vitals", sp.console[0], sp.console[1]); }       // animated props
  for (const r of [].concat(st.pressure_fix)) { const sp = GEO().spots[r]; prop("pressure_fix", sp.panel[0], sp.panel[1]); }
  if (f.sabotage) {                                    // the broken panel blinks
    const k = f.sabotage.kind, where = k === "pressure" ? st.pressure_fix : [st[k + "_fix"]];
    for (const r of where) { const p = GEO().spots[r].panel, a = .4 + .4 * Math.sin(NOW() / 150);
      cx.strokeStyle = `rgba(248,81,73,${a})`; cx.lineWidth = 2.5; cx.beginPath(); cx.arc(p[0], p[1], 14, 0, 7); cx.stroke(); }
  }
  for (const [room, left] of Object.entries(f.doors || {})) {                         // shut doors: red bars at the doorways
    for (const [a, b] of game.map.corridors) { if (a !== room && b !== room) continue;
      const d = GEO().spots && game.map.geometry && doorPoint(room, a === room ? b : a); if (!d) continue;
      cx.fillStyle = "#f85149"; cx.fillRect(d[0] - 9, d[1] - 9, 18, 18); cx.fillStyle = "#3a0d0d"; cx.fillRect(d[0] - 6, d[1] - 6, 12, 12); }
  }
  if (audienceKnows() || (TRUTH && MODE === "spectator")) for (const net of game.map.vents) {      // vent links, for the audience
    cx.setLineDash([4, 6]); cx.strokeStyle = "rgba(210,153,34,.45)"; cx.lineWidth = 1.6; cx.beginPath();
    net.forEach((r, i) => { const v = GEO().spots[r].vent; cx[i ? "lineTo" : "moveTo"](v[0], v[1]); }); cx.stroke(); cx.setLineDash([]); }
}
function doorPoint(room, other) {
  const r = game.map.rooms[room], o = game.map.rooms[other], B = box(r);
  if (Math.abs(r.y - o.y) < 1) return [o.x > r.x ? B.x0 + B.w : B.x0, r.y];
  return [r.x, o.y > r.y ? B.y0 + B.h : B.y0];
}

// ---------- light: dim harbor night with warm room lamps (baked once); lights out = only headlamps (per frame)
let LAMP_BAKE = null, LAMP_KEY = "";
function bakeLamps(scale) {
  const key = runDir + "|" + scale; if (LAMP_BAKE && LAMP_KEY === key) return LAMP_BAKE;
  const c = document.createElement("canvas"); c.width = Math.round(LW * scale); c.height = Math.round(LH * scale);
  const o = c.getContext("2d"); o.setTransform(scale, 0, 0, scale, 0, 0);
  o.fillStyle = "rgba(3,6,14,.34)"; o.fillRect(0, 0, LW, LH);
  o.globalCompositeOperation = "destination-out";
  for (const r of Object.values(rooms())) { const rad = Math.max(r.w, r.h) * .78, g = o.createRadialGradient(r.x, r.y - 10, rad * .2, r.x, r.y - 10, rad);
    g.addColorStop(0, "rgba(0,0,0,.95)"); g.addColorStop(1, "rgba(0,0,0,0)"); o.fillStyle = g; o.beginPath(); o.arc(r.x, r.y - 10, rad, 0, 7); o.fill(); }
  o.globalCompositeOperation = "lighter";
  for (const [name, r] of Object.entries(rooms())) { const g = o.createRadialGradient(r.x, r.y - 20, 4, r.x, r.y - 20, 90);
    g.addColorStop(0, (LAMP[name] || "#fff0c8") + "22"); g.addColorStop(1, "rgba(0,0,0,0)"); o.fillStyle = g; o.fillRect(r.x - 90, r.y - 110, 180, 180); }
  LAMP_BAKE = c; LAMP_KEY = key; return c;
}
const LIGHTS = new WeakMap();                          // lights-out buffer per target canvas
function drawLight(f, view) {
  const out = f.sabotage && f.sabotage.kind === "lights";
  if (!out) return;                                    // normal light is already in the baked map
  let L = LIGHTS.get(cv);
  if (!L || L.width !== cv.width || L.height !== cv.height) { L = document.createElement("canvas"); L.width = cv.width; L.height = cv.height; LIGHTS.set(cv, L); }
  const o = L.getContext("2d"); o.globalCompositeOperation = "source-over"; o.setTransform(1, 0, 0, 1, 0, 0);
  o.fillStyle = "rgba(1,2,6,.9)"; o.fillRect(0, 0, L.width, L.height);
  o.setTransform(...view.m); o.globalCompositeOperation = "destination-out";
  for (const h of HIT) if (f.alive && f.alive[h.pid]) { const x = h.x + 6 * (FACE[h.pid] || 1), y = h.y - 4, g = o.createRadialGradient(x, y, 8, x, y, 46);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)"); o.fillStyle = g; o.beginPath(); o.arc(x, y, 46, 0, 7); o.fill(); }
  cx.save(); cx.setTransform(1, 0, 0, 1, 0, 0); cx.drawImage(L, 0, 0); cx.restore();
}

// ---------- cameras
function viewMatrix(cam, canvas = cv) {
  const k = canvas.width / LW;
  if (!cam) return [k, 0, 0, canvas.height / LH, 0, 0];
  return [k * cam.z, 0, 0, k * cam.z, (LW / 2 - cam.x * cam.z) * k, (LH / 2 - cam.y * cam.z) * k];
}
let DCAM = null;                                       // the director camera (smooth, follows the action, no fog)
function directorCam(f, prev, t) {
  const pid = directorPick(f), p = posAt(f, prev, t, pid), now = performance.now();
  if (!DCAM || Math.hypot(DCAM.x - p.x, DCAM.y - p.y) > 520) DCAM = {pid, x: p.x, y: p.y, z: 2.0, vx: 0, vy: 0, wall: now};
  const dt = Math.min(.1, (now - DCAM.wall) / 1000); DCAM.wall = now;
  // look a little ahead of where the subject is walking
  const q = posAt(f, prev, Math.min(1, t + .6), pid), tx = p.x + (q.x - p.x) * 1.2, ty = p.y + (q.y - p.y) * 1.2;
  // critically damped spring: no jitter, no overshoot, the same feel at any frame rate; slower when switching subject
  const w = DCAM.pid === pid ? 5.5 : 2.6;
  const ax = w * w * (tx - DCAM.x) - 2 * w * DCAM.vx, ay = w * w * (ty - DCAM.y) - 2 * w * DCAM.vy;
  DCAM.vx += ax * dt; DCAM.vy += ay * dt; DCAM.x += DCAM.vx * dt; DCAM.y += DCAM.vy * dt;
  if (Math.hypot(tx - DCAM.x, ty - DCAM.y) < 30) DCAM.pid = pid;
  const hw = LW / 2 / DCAM.z, hh = LH / 2 / DCAM.z;
  DCAM.x = Math.max(hw - 20, Math.min(LW - hw + 20, DCAM.x)); DCAM.y = Math.max(hh - 20, Math.min(LH - hh + 20, DCAM.y));
  return DCAM;
}
function directorPick(f) {                             // stay with busy places; once the audience knows, follow the hunt
  const alive = game.players.filter(p => f.alive[p.pid]); if (!alive.length) return game.players[0].pid;
  const knows = audienceKnows();
  const kill = (f.events || []).find(e => e.e === "kill");
  if (knows && kill) { DIR = {pid: kill.by, since: f.ts}; return DIR.pid; }
  if (DIR && f.alive[DIR.pid] && f.ts - DIR.since < 18 && f.ts >= DIR.since) return DIR.pid;
  const score = p => { const [x, y] = f.xy[p.pid]; let n = 0, crewNear = 0;
    for (const q of alive) if (q !== p) { const d = Math.hypot(f.xy[q.pid][0] - x, f.xy[q.pid][1] - y); if (d < 180) { n++; if (roleAt(q.pid, f) !== "impostor") crewNear++; } }
    return n + (knows && roleAt(p.pid, f) === "impostor" && crewNear === 1 ? 7 : 0) + Math.random() * 1.5 - (DIR && DIR.pid === p.pid ? 3 : 0); };
  const best = alive.reduce((a, b) => score(b) > score(a) ? b : a, alive[0]);
  DIR = {pid: best.pid, since: f.ts}; return best.pid;
}

// ---------- the world, for one view
function renderWorld(f, prev, t, view) {
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = "#04070c"; cx.fillRect(0, 0, cv.width, cv.height);
  cx.setTransform(...view.m);
  HIT = [];
  drawMap(f);
  drawPlayers(f, prev, t, view.vis || null);
  drawLight(f, view);
  if (view.fog) { cx.setTransform(cv.width / LW, 0, 0, cv.height / LH, 0, 0); drawFog(f, view.me); }
}
function currentView(f, prev, t) {
  if (UI.view.kind === "pov" && f.xy && f.alive) {
    POV = UI.view.pid; const me = posAt(f, prev, t, POV); const cam = camFor(f, prev, t); cam.z = Z;
    return {m: viewMatrix({x: CAM.x, y: CAM.y, z: Z}), fog: true, me, vis: (x, y) => povSees(f, me, x, y), cam: {x: CAM.x, y: CAM.y, z: Z}};
  }
  POV = null;
  if (UI.view.kind === "director" && f.xy) { const c = directorCam(f, prev, t); return {m: viewMatrix(c), cam: c}; }
  return {m: viewMatrix(null), cam: null};
}
let LAST_VIEW = null;
function screenPos(x, y) { return LAST_VIEW ? screenOf(LAST_VIEW, x, y) : {x, y}; }
function screenOf(view, x, y) { const m = view.m, k = cv.width / LW; return {x: (m[0] * x + m[4]) / k, y: (m[3] * y + m[5]) / k}; }

// ---------- kill cam with a little shake
function startKillcam(i) {
  if (MODE === "detective") return;                    // it would show who did it
  const f = frames[i], e = (f.events || []).find(x => x.e === "kill"); if (!e || !f.xy) return;
  if (GT - f.ts > 1.0) return;                         // catching up after a jump: no stale kill cams
  const v = f.xy[e.victim]; KILLCAM = {i, wall: performance.now(), x: v[0], y: v[1] - 6, by: e.by, victim: e.victim, room: e.room};
  UI.flash("kill");
}
function renderKillcam() {
  const k = (performance.now() - KILLCAM.wall) / KC_MS;
  const sx = KILLCAM.x, sy = KILLCAM.y, shake = k < .12 ? (1 - k / .12) * 5 : 0;
  KILLCAM.x = sx + (Math.random() - .5) * shake; KILLCAM.y = sy + (Math.random() - .5) * shake;
  const still = drawKillcam(); if (KILLCAM) { KILLCAM.x = sx; KILLCAM.y = sy; }
  return still;
}

// ---------- the impostor cam (picture in picture)
let PIPC = null;
let PIP_N = 0;
function renderPip(f, prev, t) {
  const el = $("pip");
  if ((PIP_N++ & 1) && el.classList.contains("on")) return;      // 30 fps is plenty for the small window
  const imp = impostorOf()[0], show = MODE === "spectator" && audienceKnows() && imp && f.alive && f.alive[imp] && f.xy &&
    (f.kind === "tick" || f.kind === "meeting_end") && !(UI.view.kind === "pov" && UI.view.pid === imp) && !(UI.view.kind === "director" && DCAM && DCAM.pid === imp);
  el.classList.toggle("on", !!show); if (!show) return;
  const c = el.querySelector("canvas"), dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(c.clientWidth * dpr), h = Math.round(w * LH / LW);
  if (c.width !== w) { c.width = w; c.height = h; }
  const p = posAt(f, prev, t, imp);
  withCtx(c, () => { const view = {m: viewMatrix({x: p.x, y: p.y, z: 2.6}, c)}; const keepHit = HIT; renderWorld(f, prev, t, view); HIT = keepHit; });
  el.querySelector(".who").textContent = nameOf(imp);
}

// ---------- portraits for the HTML screens (drawn once per look, cached)
const PORTRAIT = {};
function portrait(p, o = {}) {
  const key = `${p.pid}|${o.dead ? 1 : 0}|${o.ghost ? 1 : 0}|${o.glow ? 1 : 0}|${p.colour}|${p.family}`;
  if (PORTRAIT[key]) return PORTRAIT[key];
  const c = document.createElement("canvas"); c.width = c.height = 128;
  withCtx(c, () => { cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, 128, 128);
    worker(64, 82, p, {s: 3.3, dead: o.dead, ghost: o.ghost, glow: o.glow ? "#ff4d4d" : null}); });
  return (PORTRAIT[key] = c.toDataURL());
}
