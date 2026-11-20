// Extracted unchanged from the v3 viewer (legacy.html): parsing, characters, camera, fog, kill cam, sound.
// Shared globals live in core.js. Edited functions are redefined in world.js / ui.js (later scripts win).

async function tail(path, from) {
  const r = await fetch(`/api/tail?path=${encodeURIComponent(path)}&from=${from}`).then(r => r.json()).catch(() => null);
  if (!r) return {size: from, lines: []};
  return {size: r.size, lines: r.text.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)};
}

function feedFrames(evs) {
  FB ||= {state: null, meeting: null, ejectPending: false};
  const out = frames; let {state, meeting, ejectPending} = FB;
  const M = (e, extra = {}) => out.push({kind: "meeting", tick: e.tick, ts: e.ts, ...state, meeting: clone(meeting), ...extra});
  const pushEject = e => { out.push({kind: "eject", tick: e.tick, ts: e.ts, ...state, meeting: clone(meeting)}); ejectPending = false; };
  for (const e of evs) {
    if (["start", "tick", "state", "meeting_end"].includes(e.type)) {
      if (e.type === "meeting_end" && ejectPending) pushEject(e);
      state = {pos: e.pos, xy: e.xy, alive: e.alive, bodies: e.bodies, sabotage: e.sabotage, doors: e.doors, task_bar: e.task_bar, doing: e.doing};
      if (e.type === "meeting_end") meeting = null;
      out.push({kind: e.type === "tick" || e.type === "state" ? "tick" : e.type, tick: e.tick, ts: e.ts, ...state, events: e.events || [], actions: e.actions || {}});
    } else if (e.type === "meeting_start") {
      meeting = {n: e.n, caller: e.caller, reason: e.reason, body: e.body, body_room: e.body_room, msgs: [], ts0: e.ts, voted: []};
      out.push({kind: "meeting", tick: e.tick, ts: e.ts, ...state, pos: e.pos, alive: e.alive, meeting: clone(meeting)});
    } else if (e.type === "typing") { meeting.typers = [...(meeting.typers || []).filter(x => x !== e.pid), e.pid]; M(e, {typing: e.pid, typers: [...meeting.typers]});
    } else if (e.type === "pass") { meeting.typing = null; M(e, {passed: e.pid});
    } else if (e.type === "say") {
      meeting.typing = null; meeting.typers = (meeting.typers || []).filter(x => x !== e.pid);
      meeting.msgs.push({speaker: e.speaker, text: e.text, round: e.round, ask: e.ask, ghost: !!e.ghost});
      M(e, {latest: e.speaker, typers: [...meeting.typers]});
    } else if (e.type === "voting") { meeting.voting = true; meeting.typing = null; M(e, {voting: true});
    } else if (e.type === "voted") { meeting.voted.push(e.pid); M(e, {voting: true, justVoted: e.pid, typers: [...(meeting.typers || [])]});
    } else if (e.type === "vote_result") {
      meeting.result = e; meeting.voting = false;
      M(e, {votes: true}); ejectPending = true;
    } else if (e.type === "comment") { COMMENTS.push({ts: e.ts, text: e.text});
    } else if (e.type === "ejecting") { pushEject(e);
    } else if (e.type === "end") {
      if (ejectPending) pushEject(e);
      out.push({kind: "end", tick: e.tick, ts: e.ts, pos: e.pos, xy: e.xy, alive: e.alive, bodies: e.bodies, sabotage: null, winner: e.winner, reason: e.reason, roles: e.roles, task_bar: e.task_bar});
    }
  }
  // human-paced games play back on their real clock; fast games use fixed screen times
  const gaps = []; for (let i = Math.max(1, out.length - 60); i < out.length; i++) if (out[i].kind === "tick" && out[i - 1].kind === "tick" && out[i].ts != null) gaps.push(out[i].ts - out[i - 1].ts);
  gaps.sort((x, y) => x - y); PACED = (game && game.pace) || (gaps.length > 3 && gaps[gaps.length >> 1] > 1.2);
  Object.assign(FB, {state, meeting, ejectPending});
  return out;
}

function buildFrames(evs) { FB = null; frames = []; COMMENTS = []; return feedFrames(evs); }

const clone = o => JSON.parse(JSON.stringify(o));

const pretty = s => { let t = String(s ?? ""); if (!game) return t;
  for (const [a, b] of game.map.corridors) { const id = [a, b].sort().join("~"); t = t.split(id).join(`${a}–${b} corridor`); }
  return t; };

const rooms = () => game.map.rooms;

const box = r => ({x0: r.x - (r.w + 20) / 2, y0: r.y - (r.h + 24) / 2, w: r.w + 20, h: r.h + 24});

const NOW = () => performance.now();

function shade(hex, k) { // k < 0 darker, > 0 lighter
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255;
  const f = v => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function shape(x, y, s, kind, fill, stroke) {
  cx.beginPath();
  const poly = (n, rot = -Math.PI / 2, r = s) => { for (let i = 0; i < n; i++) { const a = rot + i * 2 * Math.PI / n; cx[i ? "lineTo" : "moveTo"](x + r * Math.cos(a), y + r * Math.sin(a)); } cx.closePath(); };
  if (kind === "circle") cx.arc(x, y, s, 0, 7);
  else if (kind === "square") cx.rect(x - s * .85, y - s * .85, s * 1.7, s * 1.7);
  else if (kind === "triangle") poly(3, -Math.PI / 2, s * 1.2);
  else if (kind === "diamond") poly(4, 0, s * 1.15);
  else if (kind === "hexagon") poly(6, 0);
  else if (kind === "pentagon") poly(5);
  else if (kind === "star") { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * .5 : s * 1.2; cx[i ? "lineTo" : "moveTo"](x + r * Math.cos(a), y + r * Math.sin(a)); } cx.closePath(); }
  else { cx.rect(x - s * .35, y - s, s * .7, s * 2); cx.rect(x - s, y - s * .35, s * 2, s * .7); }
  cx.fillStyle = fill; cx.fill(); if (stroke) { cx.lineWidth = 3; cx.strokeStyle = stroke; cx.stroke(); }
}

function roundRect(x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }

// The crew: small chibi bots. Claude family = soft clay heads with dot eyes; OpenAI family = chrome capsule heads with a
// dark visor and glowing eyes. Every model also wears its own sign (sprout, crown, headphones, star, sun, ear modules).
const ACC = p => { const m = String(p.model || p.pid || "").toLowerCase();
  return /fable/.test(m) ? "sprout" : /opus/.test(m) ? "crown" : /sonnet/.test(m) ? "phones" : /haiku/.test(m) ? "blossom"
    : /astra/.test(m) ? "star" : /-sol|\bsol\b/.test(m) ? "sun" : /gpt-5\.5/.test(m) ? "ears"
    : /oss-120b/.test(m) ? "antenna" : /oss-20b/.test(m) ? "propeller" : /qwen/.test(m) ? "bow" : /ultra/.test(m) ? "spikes"
    : /super/.test(m) ? "goggles" : /lightning/.test(m) ? "bolt" : /nano/.test(m) ? "cap" : null; };
const CLAY = "#f4e6d2", CHROME_A = "#f3f6fa", CHROME_B = "#9aa6b8";

function accessory(kind, col, back, t) {
  if (back) {                                                  // drawn behind the head
    if (kind === "sun") { cx.strokeStyle = "#ffe48a"; cx.lineWidth = 2.2; cx.lineCap = "round"; const r0 = 14, sp = t / 2500;
      for (let i = 0; i < 10; i++) { const a = sp + i * Math.PI / 5; cx.beginPath(); cx.moveTo(.5 + r0 * Math.cos(a), -13 + r0 * Math.sin(a)); cx.lineTo(.5 + (r0 + 4) * Math.cos(a), -13 + (r0 + 4) * Math.sin(a)); cx.stroke(); } }
    return;
  }
  if (kind === "sprout") { cx.strokeStyle = "#4f9a52"; cx.lineWidth = 1.6; cx.beginPath(); cx.moveTo(0, -21.5); cx.quadraticCurveTo(1, -25, 0, -28); cx.stroke();
    cx.fillStyle = "#6cc46f"; cx.beginPath(); cx.ellipse(-3.2, -28, 3.6, 1.8, -.5, 0, 7); cx.fill(); cx.beginPath(); cx.ellipse(3.2, -29, 3.6, 1.8, .5, 0, 7); cx.fill(); }
  else if (kind === "crown") { cx.fillStyle = "#f2c230"; cx.beginPath(); cx.moveTo(-6, -20.5); cx.lineTo(-7, -28); cx.lineTo(-3, -24.5); cx.lineTo(0, -30); cx.lineTo(3, -24.5); cx.lineTo(7, -28); cx.lineTo(6, -20.5); cx.closePath(); cx.fill();
    cx.fillStyle = "#e5534b"; cx.beginPath(); cx.arc(0, -23.2, 1.4, 0, 7); cx.fill(); }
  else if (kind === "phones") { cx.strokeStyle = "#2b2f36"; cx.lineWidth = 2.4; cx.beginPath(); cx.arc(.5, -13, 12, Math.PI * 1.08, Math.PI * 1.92); cx.stroke();
    cx.fillStyle = "#2b2f36"; roundRect(-13, -16, 5, 8, 2.5); cx.fill(); roundRect(9, -16, 5, 8, 2.5); cx.fill();
    cx.fillStyle = shade(col, .2); cx.beginPath(); cx.arc(11.5, -12, 1.4, 0, 7); cx.fill(); }
  else if (kind === "blossom") { cx.fillStyle = "#f7a8c8"; for (let i = 0; i < 5; i++) { const a = i * 2 * Math.PI / 5; cx.beginPath(); cx.arc(-6 + 2.2 * Math.cos(a), -20 + 2.2 * Math.sin(a), 1.8, 0, 7); cx.fill(); }
    cx.fillStyle = "#ffe08a"; cx.beginPath(); cx.arc(-6, -20, 1.2, 0, 7); cx.fill(); }
  else if (kind === "star") { cx.strokeStyle = "#c9d1d9"; cx.lineWidth = 1.4; cx.beginPath(); cx.moveTo(3, -23); cx.lineTo(4.5, -28); cx.stroke();
    const tw = 1 + .15 * Math.sin(t / 300); cx.save(); cx.translate(4.5, -31); cx.scale(tw, tw); shape(0, 0, 3.2, "star", "#ffe27a"); cx.restore(); }
  else if (kind === "antenna") { cx.strokeStyle = "#2b2f36"; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(2, -22); cx.lineTo(3.5, -29); cx.stroke();
    cx.fillStyle = `rgba(255,${Math.round(90 + 60 * Math.sin(t / 260))},60,1)`; cx.beginPath(); cx.arc(3.5, -30.5, 2.3, 0, 7); cx.fill(); cx.strokeStyle = "#11141b"; cx.lineWidth = 1; cx.stroke(); }
  else if (kind === "propeller") { cx.strokeStyle = "#2b2f36"; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(0, -22); cx.lineTo(0, -27); cx.stroke();
    const w = 7 * Math.abs(Math.cos(t / 70)); cx.fillStyle = "#ffd166"; cx.beginPath(); cx.ellipse(-w / 2 - .5, -27.5, w / 2 + .4, 1.4, 0, 0, 7); cx.fill();
    cx.fillStyle = "#4cc9f0"; cx.beginPath(); cx.ellipse(w / 2 + .5, -27.5, w / 2 + .4, 1.4, 0, 0, 7); cx.fill(); cx.fillStyle = "#2b2f36"; cx.beginPath(); cx.arc(0, -27.5, 1.2, 0, 7); cx.fill(); }
  else if (kind === "bow") { cx.fillStyle = "#ff7ab6"; cx.strokeStyle = "#11141b"; cx.lineWidth = 1;
    for (const d of [-1, 1]) { cx.beginPath(); cx.moveTo(-6, -21.5); cx.lineTo(-6 + d * 5, -25); cx.lineTo(-6 + d * 5, -18); cx.closePath(); cx.fill(); cx.stroke(); }
    cx.beginPath(); cx.arc(-6, -21.5, 1.6, 0, 7); cx.fill(); cx.stroke(); }
  else if (kind === "spikes") { cx.fillStyle = shade(col, -.3); cx.strokeStyle = "#11141b"; cx.lineWidth = 1;
    for (const [sx, h] of [[-5, 5], [0, 7.5], [5, 5]]) { cx.beginPath(); cx.moveTo(sx - 3, -21); cx.lineTo(sx, -21 - h); cx.lineTo(sx + 3, -21); cx.closePath(); cx.fill(); cx.stroke(); } }
  else if (kind === "goggles") { cx.strokeStyle = "#2b2f36"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(-11, -21); cx.quadraticCurveTo(0, -24, 11, -21); cx.stroke();
    for (const gx of [-2.5, 4.5]) { cx.fillStyle = "#9fe3ff"; cx.beginPath(); cx.arc(gx, -22, 3, 0, 7); cx.fill(); cx.strokeStyle = "#11141b"; cx.lineWidth = 1.3; cx.stroke();
      cx.fillStyle = "rgba(255,255,255,.8)"; cx.beginPath(); cx.arc(gx - .9, -23, .9, 0, 7); cx.fill(); } }
  else if (kind === "bolt") { cx.save(); cx.translate(6, -27); cx.rotate(.2); cx.fillStyle = "#ffe14a"; cx.strokeStyle = "#11141b"; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(1.5, -5); cx.lineTo(-2.5, 1); cx.lineTo(0, 1); cx.lineTo(-1.5, 5.5); cx.lineTo(3, -.5); cx.lineTo(.5, -.5); cx.closePath(); cx.fill(); cx.stroke(); cx.restore(); }
  else if (kind === "cap") { cx.fillStyle = "#1f6feb"; cx.strokeStyle = "#11141b"; cx.lineWidth = 1.2; cx.beginPath(); cx.moveTo(-9, -21.5); cx.quadraticCurveTo(0, -31, 9, -21.5); cx.closePath(); cx.fill(); cx.stroke();
    cx.beginPath(); cx.ellipse(10, -21.5, 6, 1.6, 0, 0, 7); cx.fill(); cx.stroke(); cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(0, -25, 1.3, 0, 7); cx.fill(); }
  else if (kind === "ears") { cx.fillStyle = shade(col, -.2); roundRect(-13.5, -17, 4, 9, 2); cx.fill(); roundRect(10, -17, 4, 9, 2); cx.fill();
    cx.fillStyle = shade(col, .55); cx.fillRect(10.8, -15, 2.4, 1.6); cx.fillRect(10.8, -12, 2.4, 1.6); }
}

function worker(x, y, p, o = {}) {
  // jellybean crew: one soft rounded piece for head + body, a big face, stubby arms and feet, ink outline, cel shading, waddle.
  // Claude family = clay bean with a cream face patch, dot eyes, blush and a stitched seam; OpenAI family = glossy bean with a
  // chrome band, a dark face screen with glowing eyes and a chest light. Each model adds its sign.
  const s = o.s || 1, col = colOf(p) || "#ccc", face = o.face || 1, t = NOW(), clay = p.family === "claude", open = p.family === "open", acc = ACC(p);
  const ph = t / 85 + BEAT(p.pid) * 6, sw = o.walk ? Math.sin(ph) : 0, busy = o.busy && !o.ghost && !o.dead;
  const INK = o.glow || "#11141b", LW1 = o.glow ? 2.4 : 1.7, dark = shade(col, -.32), lite = shade(col, .3);
  const part = (path, fill, cel = true) => {
    path(); cx.fillStyle = fill; cx.fill();
    if (cel) { cx.save(); path(); cx.clip(); cx.fillStyle = "rgba(10,12,30,.24)"; cx.beginPath(); cx.ellipse(-16, 0, 11, 30, 0, 0, 7); cx.fill();
      cx.fillStyle = "rgba(255,255,255,.2)"; cx.beginPath(); cx.ellipse(1, -24, 9, 5, -.2, 0, 7); cx.fill(); cx.restore(); }
    path(); cx.lineJoin = "round"; cx.lineWidth = LW1; cx.strokeStyle = INK; cx.stroke(); };
  const rr = (a, b, w, h, r) => () => roundRect(a, b, w, h, r);
  const el = (a, b, rx, ry) => () => { cx.beginPath(); cx.ellipse(a, b, rx, ry, 0, 0, 7); };
  const bean = () => { cx.beginPath(); cx.moveTo(0, -26); cx.bezierCurveTo(9.5, -26, 12.5, -15, 12.5, -3); cx.bezierCurveTo(12.5, 7, 8.5, 11.5, 0, 11.5);
    cx.bezierCurveTo(-8.5, 11.5, -12.5, 7, -12.5, -3); cx.bezierCurveTo(-12.5, -15, -9.5, -26, 0, -26); cx.closePath(); };
  const ghostTail = () => { cx.beginPath(); cx.moveTo(0, -26); cx.bezierCurveTo(9.5, -26, 12.5, -15, 12.5, -3); cx.quadraticCurveTo(12, 8, 5 + Math.sin(t / 280) * 2, 15);
    cx.quadraticCurveTo(1, 9, -3 + Math.sin(t / 250) * 2, 16); cx.quadraticCurveTo(-12, 8, -12.5, -3); cx.bezierCurveTo(-12.5, -15, -9.5, -26, 0, -26); cx.closePath(); };
  const arm = (ax, ang) => { cx.save(); cx.translate(ax, -3); cx.rotate(ang); part(rr(-2.6, -1, 5.2, 8.5, 2.6), col, false); part(el(0, 7.6, 2.8, 2.6), clay ? "#f4e6d2" : "#eef1f5", false); cx.restore(); };

  const figure = () => {
    if (!o.ghost) for (const [fx, d] of [[-5, 1], [5, -1]]) { const lift = o.walk ? Math.max(0, Math.sin(ph) * d) * 2 : 0;    // feet
      part(el(fx + sw * 2.6 * d, 12 - lift, 4.4, 2.8), shade(col, -.5), false); }
    if (!o.ghost && !o.dead) arm(-11, .35 + sw * .6);
    part(o.ghost ? ghostTail : bean, col);
    // family trims
    if (clay) { cx.strokeStyle = "rgba(255,240,220,.6)"; cx.lineWidth = 1; cx.setLineDash([1.6, 1.6]); cx.beginPath(); cx.moveTo(-10.5, 1.5); cx.quadraticCurveTo(0, 4, 11, 1.5); cx.stroke(); cx.setLineDash([]); }
    else if (open) { cx.fillStyle = "rgba(10,14,22,.55)"; for (let i = 0; i < 3; i++) { roundRect(-1 + i * 3.2, 1.5, 1.6, 6, .8); cx.fill(); }      // open-weights bean: belly grille + rivets
      cx.fillStyle = shade(col, .45); for (const [rx, ry] of [[-8.5, -1], [10, -1]]) { cx.beginPath(); cx.arc(rx, ry, 1.1, 0, 7); cx.fill(); } }
    else { cx.save(); bean(); cx.clip(); cx.fillStyle = "rgba(235,242,250,.85)"; cx.fillRect(-14, 0, 28, 2); cx.restore();
      const pulse = .6 + .4 * Math.sin(t / 380 + x); cx.fillStyle = `rgba(190,235,255,${pulse})`; roundRect(4, 4.5, 4.6, 2.2, 1.1); cx.fill(); }
    // face
    const blink = (Math.floor(t / 90 + x * 7) % 45) === 0, look = o.walk ? 1 : 0;
    if (clay) {
      part(el(4.2, -13, 8.2, 7), "#f6e8d4", false);
      cx.fillStyle = "rgba(235,120,110,.45)"; cx.beginPath(); cx.ellipse(-.6, -9.4, 1.9, 1.2, 0, 0, 7); cx.fill(); cx.beginPath(); cx.ellipse(10.4, -9.4, 1.9, 1.2, 0, 0, 7); cx.fill();
    } else if (open) {
      part(rr(-6.5, -18.5, 20, 9, 4.5), "#0f1d1a", false);                                  // one wide visor
      cx.fillStyle = "rgba(255,255,255,.35)"; cx.fillRect(-3.5, -17.2, 12, 1);
    } else {
      part(rr(-3.5, -19.5, 16, 11, 5.5), "#0b1020", false);
      cx.fillStyle = "rgba(255,255,255,.5)"; cx.beginPath(); cx.ellipse(.5, -17.6, 2.6, .9, -.3, 0, 7); cx.fill();
    }
    const eyes = clay ? [[1.6 + look, -14], [6.8 + look, -14]] : open ? [[.2 + look, -14], [7.4 + look, -14]] : [[1.4 + look, -14.2], [6.8 + look, -14.2]];
    for (const [ex, ey] of eyes) {
      if (o.dead) { cx.strokeStyle = clay ? "#3a2416" : "#dfe8ff"; cx.lineWidth = 1.4; cx.beginPath(); cx.moveTo(ex - 1.8, ey - 1.8); cx.lineTo(ex + 1.8, ey + 1.8); cx.moveTo(ex + 1.8, ey - 1.8); cx.lineTo(ex - 1.8, ey + 1.8); cx.stroke(); }
      else if (clay) { cx.fillStyle = "#2a1a10"; cx.beginPath(); cx.ellipse(ex, ey, 1.9, blink ? .3 : 2.8, 0, 0, 7); cx.fill();
        if (!blink) { cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(ex + .6, ey - 1.1, .8, 0, 7); cx.fill(); } }
      else if (open) { cx.fillStyle = shade(col, .7); cx.beginPath(); cx.ellipse(ex, ey, 2.1, blink ? .3 : 2.1, 0, 0, 7); cx.fill();
        if (!blink) { cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(ex + .7, ey - .8, .7, 0, 7); cx.fill(); } }
      else { cx.fillStyle = "rgba(160,220,255,.22)"; roundRect(ex - 2.6, ey - 3.5, 5.2, 7, 2.6); cx.fill();
        cx.fillStyle = shade(col, .75); roundRect(ex - 1.3, ey - (blink ? .4 : 2.6), 2.6, blink ? .8 : 5.2, 1.3); cx.fill(); }
    }
    if (clay && !o.dead) { cx.strokeStyle = "#2a1a10"; cx.lineWidth = 1.1; cx.lineCap = "round"; cx.beginPath(); cx.arc(4.2, -10.4, 1.8, .25, Math.PI - .25); cx.stroke(); }
    if (o.dead && !clay) { cx.strokeStyle = "rgba(255,255,255,.65)"; cx.lineWidth = .9; cx.beginPath(); cx.moveTo(-1, -18.5); cx.lineTo(3, -14); cx.lineTo(1.5, -11); cx.lineTo(6, -9.5); cx.stroke(); }
    part(el(-6.5, -21.5, 1.8, 1.8), o.lamp ? "#fff6b0" : lite, false);                     // little head lamp
    if (acc) { cx.save(); cx.translate(0, -3.5); accessory(acc, col, false, t); cx.restore(); }
    if (busy) arm(9.5, -2.3 + Math.sin(t / 90) * .35);
    else if (!o.ghost && !o.dead) arm(11, -.35 - sw * .6);
    const dn = dupNo(p);
    if (dn && !o.ghost) { cx.save(); cx.scale(face, 1); cx.font = "900 6.5px system-ui"; cx.textAlign = "center"; cx.lineWidth = 2; cx.strokeStyle = INK;
      cx.strokeText(dn, -4 * face, 7.5); cx.fillStyle = "#fff"; cx.fillText(dn, -4 * face, 7.5); cx.restore(); }
  };

  cx.save(); cx.translate(x, y); cx.scale(s * face, s);
  if (o.dead) {                                                 // flat on its back, sparks and a wisp of smoke
    cx.fillStyle = "rgba(0,0,0,.35)"; cx.beginPath(); cx.ellipse(0, 6, 22, 8, 0, 0, 7); cx.fill();
    cx.save(); cx.translate(-6, 4); cx.rotate(Math.PI / 2); figure(); cx.restore();
    const fl = Math.floor(t / 70) % 3; cx.strokeStyle = "#ffe27a"; cx.lineWidth = 1.3;
    if (fl !== 2) { cx.beginPath(); cx.moveTo(20, 2); cx.lineTo(24, -1.5); cx.moveTo(20.5, 5); cx.lineTo(25, 6); cx.moveTo(19, 0); cx.lineTo(20, -4); cx.stroke(); }
    for (let i = 0; i < 3; i++) { const k = (t / 1400 + i / 3) % 1; cx.fillStyle = `rgba(200,200,210,${.35 * (1 - k)})`; cx.beginPath(); cx.arc(18 + Math.sin(k * 6 + i) * 2, -2 - k * 16, 2 + k * 3, 0, 7); cx.fill(); }
    cx.restore(); return;
  }
  const bob = o.ghost ? Math.sin(t / 400 + x) * 3 : o.walk ? -Math.abs(Math.sin(ph)) * 1.8 : Math.sin(t / 700 + x) * .7;
  if (!o.ghost) { cx.fillStyle = "rgba(0,0,0,.35)"; cx.beginPath(); cx.ellipse(0, 14, 12.5 - Math.abs(bob), 3.6, 0, 0, 7); cx.fill(); }
  if (o.walk) { const sq = Math.abs(Math.cos(ph)) * .06; cx.translate(0, 13); cx.rotate(Math.sin(ph) * .14); cx.scale(1 + sq, 1 - sq); cx.translate(0, -13); }
  else if (!o.ghost) { const br = Math.sin(t / 650 + x) * .02; cx.translate(0, 12); cx.scale(1 - br, 1 + br); cx.translate(0, -12); }   // breathing
  cx.translate(0, bob); cx.globalAlpha *= o.ghost ? .42 : 1;
  if (acc) { cx.save(); cx.translate(0, -2); accessory(acc, col, true, t); cx.restore(); }
  figure();
  if (o.ghost) { cx.strokeStyle = "rgba(255,240,170,.9)"; cx.lineWidth = 1.6; cx.beginPath(); cx.ellipse(0, -32, 7, 2.2, 0, 0, 7); cx.stroke(); }
  cx.restore();
}

function prop(kind, x, y) {
  cx.save(); cx.translate(x, y);
  if (kind === "button") { cx.fillStyle = "#3a3f48"; roundRect(-14, 2, 28, 8, 3); cx.fill();
    cx.fillStyle = "#e5534b"; cx.beginPath(); cx.ellipse(0, 2, 10, 6, 0, 0, 7); cx.fill(); cx.fillStyle = "#ff8a80"; cx.beginPath(); cx.ellipse(-2, 0, 4, 2, 0, 0, 7); cx.fill(); }
  else if (kind === "admin") { cx.fillStyle = "#2f3a48"; roundRect(-15, -8, 30, 16, 3); cx.fill(); cx.fillStyle = "#3fb95066"; for (let i = 0; i < 6; i++) cx.fillRect(-12 + (i % 3) * 9, -5 + Math.floor(i / 3) * 6, 7, 4); }
  else if (kind === "vitals") { cx.fillStyle = "#11202a"; roundRect(-15, -9, 30, 18, 3); cx.fill(); cx.strokeStyle = "#3fb950"; cx.lineWidth = 1.5; cx.beginPath();
    const ph = (NOW() / 25) % 30; for (let i = 0; i <= 26; i++) { const xx = -13 + i, d = Math.abs(i - ph % 26); cx[i ? "lineTo" : "moveTo"](xx, d < 2 ? -6 + d * 3 : 0); } cx.stroke(); }
  else if (kind === "cams") { for (let i = 0; i < 4; i++) { cx.fillStyle = "#1a2633"; cx.fillRect(-15 + (i % 2) * 16, -10 + Math.floor(i / 2) * 11, 14, 9); cx.fillStyle = "#58a6ff44"; cx.fillRect(-14 + (i % 2) * 16, -9 + Math.floor(i / 2) * 11, 12, 7); } }
  else if (kind === "lights_fix") { cx.fillStyle = "#3a3f48"; roundRect(-9, -11, 18, 22, 2); cx.fill(); cx.fillStyle = "#e3b341"; cx.beginPath(); cx.moveTo(2, -8); cx.lineTo(-4, 1); cx.lineTo(0, 1); cx.lineTo(-2, 8); cx.lineTo(4, -1); cx.lineTo(0, -1); cx.closePath(); cx.fill(); }
  else if (kind === "comms_fix") { cx.strokeStyle = "#8b949e"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(0, 10); cx.lineTo(0, -2); cx.stroke();
    cx.beginPath(); cx.arc(0, -4, 8, Math.PI * 1.15, Math.PI * 1.85); cx.stroke(); cx.fillStyle = "#58a6ff"; cx.beginPath(); cx.arc(0, -5, 2, 0, 7); cx.fill(); }
  else if (kind === "pressure_fix") { cx.strokeStyle = "#f0883e"; cx.lineWidth = 2.5; cx.beginPath(); cx.arc(0, 0, 8, 0, 7); cx.stroke();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + NOW() / 2000; cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(8 * Math.cos(a), 8 * Math.sin(a)); cx.stroke(); } }
  else if (kind === "task") { cx.fillStyle = "#2a3340"; roundRect(-11, -7, 22, 14, 3); cx.fill(); cx.strokeStyle = "#4b5563"; cx.lineWidth = 1; cx.stroke();
    cx.fillStyle = "#e3b341aa"; cx.fillRect(-7, -3, 6, 6); cx.fillStyle = "#58a6ff88"; cx.fillRect(2, -3, 5, 2); cx.fillRect(2, 1, 5, 2); }
  else if (kind === "vent") { cx.fillStyle = "#11161d"; roundRect(-12, -6, 24, 12, 2); cx.fill(); cx.strokeStyle = "#4b5563"; cx.lineWidth = 1.5;
    for (let i = -8; i <= 8; i += 4) { cx.beginPath(); cx.moveTo(i, -4); cx.lineTo(i, 4); cx.stroke(); } }
  cx.restore();
}

function furniture(name, B) {
  const x0 = B.x0, y0 = B.y0, w = B.w, h = B.h, X = x0 + w, Y = y0 + h;
  const crate = (x, y, s = 1) => { cx.fillStyle = "#5a4630"; cx.fillRect(x, y, 16 * s, 14 * s); cx.strokeStyle = "#3b2d1e"; cx.lineWidth = 1.2; cx.strokeRect(x, y, 16 * s, 14 * s); cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + 16 * s, y + 14 * s); cx.stroke(); };
  const plant = (x, y) => { cx.fillStyle = "#4a3426"; cx.fillRect(x - 5, y, 10, 8); cx.fillStyle = "#2f7a3e"; for (let i = 0; i < 5; i++) { cx.beginPath(); cx.ellipse(x + (i - 2) * 3, y - 4 - (i % 2) * 3, 3, 6, (i - 2) * .4, 0, 7); cx.fill(); } };
  const bed = (x, y) => { cx.fillStyle = "#cfd6df"; roundRect(x, y, 30, 14, 3); cx.fill(); cx.fillStyle = "#8fb3d9"; roundRect(x + 2, y + 2, 8, 10, 2); cx.fill(); };
  const desk = (x, y) => { cx.fillStyle = "#3d4a5c"; roundRect(x, y, 30, 12, 2); cx.fill(); cx.fillStyle = "#58a6ff55"; cx.fillRect(x + 4, y - 8, 10, 7); };
  const shelf = (x, y) => { cx.fillStyle = "#4a3a2a"; cx.fillRect(x, y, 34, 10); cx.fillStyle = "#8b6b4a"; for (let i = 0; i < 6; i++) cx.fillRect(x + 2 + i * 5.3, y + 1, 3.5, 8); };
  const tank = (x, y) => { cx.fillStyle = "#33506a"; cx.beginPath(); cx.ellipse(x, y, 11, 11, 0, 0, 7); cx.fill(); cx.strokeStyle = "#5c7f9e"; cx.lineWidth = 1.5; cx.stroke(); };
  const table = (x, y) => { cx.fillStyle = "#4a5568"; cx.beginPath(); cx.arc(x, y, 12, 0, 7); cx.fill(); cx.fillStyle = "#2d3748"; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + .6; cx.beginPath(); cx.arc(x + 17 * Math.cos(a), y + 17 * Math.sin(a), 4, 0, 7); cx.fill(); } };
  const pipe = (xa, ya, xb, yb) => { cx.strokeStyle = "#5b6676"; cx.lineWidth = 4; cx.beginPath(); cx.moveTo(xa, ya); cx.lineTo(xb, yb); cx.stroke(); };
  cx.save(); cx.globalAlpha = .8;
  if (name === "Cargo") { crate(X - 26, Y - 22); crate(X - 44, Y - 22); crate(X - 35, Y - 36, .9); crate(x0 + 10, y0 + 24, .8); }
  else if (name === "Dock") { cx.strokeStyle = "#8b6b4a"; cx.lineWidth = 2; cx.beginPath(); cx.arc(X - 22, Y - 18, 8, 0, 7); cx.stroke(); cx.beginPath(); cx.arc(X - 22, Y - 18, 4, 0, 7); cx.stroke(); crate(X - 48, y0 + 24, .8); }
  else if (name === "Garden") { plant(x0 + 16, Y - 14); plant(x0 + 34, Y - 14); plant(X - 18, Y - 14); plant(X - 36, Y - 14); plant(X - 18, y0 + 34); }
  else if (name === "Lab") { desk(x0 + 10, Y - 18); cx.fillStyle = "#a371f7aa"; cx.beginPath(); cx.arc(x0 + 46, Y - 16, 3, 0, 7); cx.fill(); desk(X - 42, Y - 18); }
  else if (name === "Archive") { shelf(x0 + 10, Y - 16); shelf(x0 + 48, Y - 16); shelf(X - 44, Y - 16); }
  else if (name === "Boiler") { tank(x0 + 22, Y - 22); pipe(x0 + 33, Y - 22, X - 10, Y - 22); pipe(X - 10, Y - 22, X - 10, y0 + 24); }
  else if (name === "Office") { desk(x0 + 10, Y - 18); desk(x0 + 46, Y - 18); desk(X - 42, Y - 18); }
  else if (name === "Galley") { table(x0 + 34, Y - 30); table(X - 34, Y - 30); table(x0 + 34, y0 + 46); }
  else if (name === "Watch Room") { desk(x0 + 10, Y - 18); desk(X - 42, Y - 18); }
  else if (name === "Radio") { desk(x0 + 10, Y - 18); cx.strokeStyle = "#8b949e"; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(x0 + 25, Y - 26); cx.lineTo(x0 + 25, Y - 40); cx.stroke(); }
  else if (name === "Pumps") { pipe(x0 + 10, Y - 14, X - 10, Y - 14); tank(X - 24, y0 + 36); }
  else if (name === "Ballast") { tank(x0 + 22, Y - 20); tank(x0 + 48, Y - 20); tank(X - 24, Y - 20); }
  else if (name === "Workshop") { desk(x0 + 10, Y - 18); crate(X - 30, Y - 22, .8); cx.fillStyle = "#8b949e"; cx.fillRect(x0 + 48, Y - 20, 14, 3); }
  else if (name === "Clinic") { bed(x0 + 10, Y - 22); bed(x0 + 46, Y - 22); bed(X - 40, Y - 22); }
  else if (name === "Vault") { cx.fillStyle = "#4a5568"; roundRect(X - 34, Y - 34, 24, 24, 3); cx.fill(); cx.strokeStyle = "#a0aec0"; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(X - 22, Y - 22, 6, 0, 7); cx.stroke(); crate(x0 + 10, Y - 22, .8); }
  cx.restore();
}

function lightsOut(pts) {
  if (lightsOut.c && (lightsOut.c.width !== cv.width || lightsOut.c.height !== cv.height)) lightsOut.c = null;
  if (!lightsOut.c) { lightsOut.c = document.createElement("canvas"); lightsOut.c.width = cv.width; lightsOut.c.height = cv.height; }
  const c = lightsOut.c, o = c.getContext("2d"); o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = "source-over"; o.clearRect(0, 0, c.width, c.height); o.setTransform(cv.width / LW, 0, 0, cv.height / LH, 0, 0);
  o.fillStyle = "rgba(2,4,8,.82)"; o.fillRect(0, 0, LW, LH);
  o.globalCompositeOperation = "destination-out";
  for (const pt of pts) { const g = o.createRadialGradient(pt.x, pt.y, 4, pt.x, pt.y, 48); g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    o.fillStyle = g; o.beginPath(); o.arc(pt.x, pt.y, 48, 0, 7); o.fill(); }
  cx.drawImage(c, 0, 0, LW, LH);
}

const BEAT = pid => { let h = 7; for (const c of String(pid)) h = (h * 31 + c.charCodeAt(0)) % 997; return (h % 100) / 100; };

function drawPlayers(f, prev, t, vis = null) {
  const truth = TRUTH, P = game.players;
  const a = layout(prev.pos, prev.bodies || []), b = layout(f.pos, f.bodies || []);
  const where = {};
  if (f.xy) for (const p of P) { const A = (prev.xy || f.xy)[p.pid], B = f.xy[p.pid];
    const q = smoothXY(f, prev, t, p.pid), mv = Math.hypot(B[0] - A[0], B[1] - A[1]);
    where[p.pid] = {x: q[0], y: q[1] - 6, moving: mv > .6 && !(f.doing || {})[p.pid], busy: !!(f.doing || {})[p.pid], dx: B[0] - A[0]}; }
  else for (const p of P) { const A = a[p.pid] || b[p.pid], B = b[p.pid];
    const off = BEAT(p.pid) * .3, k = Math.max(0, Math.min(1, (t - off) / .62));   // own start time, then steady walk
    const e = k < .12 ? k * k / .24 : k > .88 ? 1 - (1 - k) * (1 - k) / .24 : k;   // soft start and stop
    const far = Math.hypot(B.x - A.x, B.y - A.y) > 2;
    where[p.pid] = {x: A.x + (B.x - A.x) * e, y: A.y + (B.y - A.y) * e, moving: far && k > 0 && k < 1, dx: B.x - A.x}; }
  // drawing only: workers standing on the same spot are spread a little so faces and names stay readable
  if (f.xy) { const ids = P.map(p => p.pid).filter(id => where[id]);
    for (let it = 0; it < 3; it++) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const A = where[ids[i]], B = where[ids[j]], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || .01;
      if (d < 26) { const push = (26 - d) / 2, ux = dx / d || 1, uy = dy / d; A.x -= ux * push; A.y -= uy * push * .5; B.x += ux * push; B.y += uy * push * .5; } } }
  // bodies
  for (const body of f.bodies || []) {
    const p = P.find(q => q.pid === body.pid), s = body.x != null ? {x: body.x, y: body.y - 4} : b["body:" + body.pid];
    if (vis && !vis(body.x, body.y)) continue;
    cx.fillStyle = "rgba(160,20,20,.35)"; cx.beginPath(); cx.ellipse(s.x, s.y + 8, 16, 6, 0, 0, 7); cx.fill();
    worker(s.x, s.y, p, {dead: true, face: 1, s: .85});
  }
  const lights = f.sabotage && f.sabotage.kind === "lights";
  const order = [...P].sort((p, q) => where[p.pid].y - where[q.pid].y);
  for (const p of order) {
    const alive = f.alive[p.pid]; if (!alive && !truth && !(vis && !f.alive[POV])) continue;
    if (vis && p.pid !== POV && (!alive ? f.alive[POV] : !vis(where[p.pid].x, where[p.pid].y + 6))) continue;
    const w = where[p.pid]; if (Math.abs(w.dx) > 2) FACE[p.pid] = w.dx > 0 ? 1 : -1;
    const glow = truth && (RT ? roleAt(p.pid, f) : p.role) === "impostor" ? "#ff4d4d" : null;
    // vent: shrink into / pop out of the grate
    const act = (f.actions || {})[p.pid] || "", vent = act.startsWith("vent:");
    cx.save(); if (vent && t < 1) cx.globalAlpha = Math.abs(1 - 2 * t);
    if (SEL === p.pid) { const pu = .5 + .5 * Math.sin(NOW() / 220);
      cx.strokeStyle = `rgba(242,194,48,${.55 + .4 * pu})`; cx.lineWidth = 2.5; cx.beginPath(); cx.ellipse(w.x, w.y + 15, 17 + 3 * pu, 6 + pu, 0, 0, 7); cx.stroke();
      cx.fillStyle = "#f2c230"; cx.beginPath(); cx.moveTo(w.x - 6, w.y - 38); cx.lineTo(w.x + 6, w.y - 38); cx.lineTo(w.x, w.y - 30); cx.fill(); }
    worker(w.x, w.y, p, {ghost: !alive, walk: w.moving, busy: w.busy, face: FACE[p.pid] || 1, glow, lamp: lights, s: crowd(f.pos, f.pos[p.pid]) > 8 ? .8 : .95});
    HIT.push({pid: p.pid, x: w.x, y: w.y});
    cx.restore();
    if (!lights || !alive) { const many = crowd(f.pos, f.pos[p.pid]) > 8;
      cx.globalAlpha = alive ? .95 : .45; cx.font = `700 ${many ? 8 : 9}px system-ui`; cx.textAlign = "center";
      cx.lineWidth = 3; cx.strokeStyle = "rgba(0,0,0,.75)"; cx.strokeText(p.name, w.x, w.y + 24); cx.fillStyle = "#e6edf3"; cx.fillText(p.name, w.x, w.y + 24); cx.globalAlpha = 1; }
  }
  if (vis) { /* POV: fog + HUD handle lights and alarms */ }
  else if (lights) { lightsOut(P.filter(p => f.alive[p.pid]).map(p => where[p.pid])); banner("LIGHTS OUT", "#e3b341"); }
  else if (f.sabotage) {
    const crit = f.sabotage.kind === "pressure";
    if (crit) { cx.fillStyle = `rgba(248,81,73,${.10 + .08 * Math.sin(NOW() / 180)})`; cx.fillRect(0, 0, LW, LH); }
    banner(crit ? `⚠ PRESSURE LEAK · ${f.sabotage.left} ticks` : "COMMS DOWN", "#f85149");
  }
  // kill flash + vent puffs (during the tick they happened)
  for (const ev of f.events || []) {
    if (ev.e === "kill" && t < 1) { const v = where[ev.victim]; if (!v || (vis && !vis(v.x, v.y + 6))) continue;
      cx.save(); cx.globalAlpha = 1 - t; cx.strokeStyle = "#ff3b3b"; cx.lineWidth = 3;
      for (let i = 0; i < 8; i++) { const ang = i * Math.PI / 4, r1 = 10 + t * 20, r2 = 18 + t * 34; cx.beginPath(); cx.moveTo(v.x + r1 * Math.cos(ang), v.y + r1 * Math.sin(ang)); cx.lineTo(v.x + r2 * Math.cos(ang), v.y + r2 * Math.sin(ang)); cx.stroke(); }
      cx.restore(); }
  }
}

function banner(text, col) {
  cx.fillStyle = "rgba(0,0,0,.6)"; roundRect(LW / 2 - 150, 6, 300, 26, 13); cx.fill();
  cx.fillStyle = col; cx.font = "800 14px system-ui"; cx.textAlign = "center"; cx.fillText(text, LW / 2, 24);
}

function wrapCount(text, w) { cx.font = "13px system-ui"; let lines = 1, line = ""; for (const word of String(text).split(" ")) { if (cx.measureText(line + word).width > w) { lines++; line = ""; } line += word + " "; } return lines; }

function wrap(text, x, y, w, lh) { let line = "", yy = y; for (const word of String(text).split(" ")) { if (cx.measureText(line + word).width > w) { cx.fillText(line, x, yy); line = ""; yy += lh; } line += word + " "; } cx.fillText(line, x, yy); }

function drawEject(f, t) {
  const r = f.meeting.result, W = LW, H = LH, tt = NOW() / 1000;
  cx.fillStyle = "#03070d"; cx.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) { const sx = (i * 137) % W, sy = (i * 71) % (H * .45); cx.fillStyle = `rgba(255,255,255,${.25 + .25 * Math.sin(tt * 2 + i)})`; cx.fillRect(sx, sy, 1.5, 1.5); }
  cx.fillStyle = "#e9e4c8"; cx.beginPath(); cx.arc(W - 140, 90, 34, 0, 7); cx.fill(); cx.fillStyle = "#03070d"; cx.beginPath(); cx.arc(W - 126, 80, 30, 0, 7); cx.fill();
  const sea = H * .62; const g = cx.createLinearGradient(0, sea, 0, H); g.addColorStop(0, "#0c2a44"); g.addColorStop(1, "#04101c");
  cx.fillStyle = g; cx.fillRect(0, sea, W, H - sea);
  cx.strokeStyle = "rgba(140,190,230,.18)"; for (let row = 0; row < 6; row++) { cx.beginPath(); for (let x = 0; x <= W; x += 16) cx[x ? "lineTo" : "moveTo"](x, sea + 10 + row * 26 + Math.sin(x / 50 + tt * 1.5 + row) * 3); cx.stroke(); }
  cx.fillStyle = "#3a2c22"; cx.fillRect(0, sea - 40, 300, 14); for (let i = 20; i < 300; i += 60) cx.fillRect(i, sea - 30, 10, 80);
  const p = r.ejected && game.players.find(q => q.name === r.ejected);
  const k = Math.min(1, t * 1.15);
  if (p) {
    const x = 260 + k * 260, y = k < .55 ? sea - 58 - Math.sin(k / .55 * Math.PI) * 70 : sea - 58 + (k - .55) / .45 * 90;
    if (k < .9) { cx.save(); cx.translate(x, y); cx.rotate(k * 6); worker(0, 0, p, {s: 2.4}); cx.restore(); }
    if (k > .82) { const s = (k - .82) / .18; cx.strokeStyle = `rgba(220,240,255,${1 - s})`; cx.lineWidth = 2; for (let i = 1; i < 4; i++) { cx.beginPath(); cx.ellipse(520, sea + 22, 20 * i * (s + .3), 6 * i * (s + .3), 0, 0, 7); cx.stroke(); } }
  }
  const txt = r.text, shown = txt.slice(0, Math.floor(txt.length * Math.min(1, t * 1.8)));
  cx.textAlign = "center"; cx.fillStyle = "#e6edf3"; cx.font = "700 28px system-ui"; cx.fillText(shown, W / 2, H * .3);
}

const roleAt = (pid, f) => { const p = pById(pid); return p && p.role === "impostor" && TURN_TS != null && f && f.ts != null && f.ts >= TURN_TS ? "impostor" : (RT ? "crew" : p && p.role); };

function posAt(f, prev, t, pid) {
  const q = smoothXY(f, prev || f, t, pid);
  return {x: q[0], y: q[1] - 6};
}
// a smooth path through the logged points (Catmull-Rom), so turns are curves, not kinks; jumps (vent, kill, meeting) stay jumps
function smoothXY(f, prev, t, pid) {
  const p1 = ((prev && prev.xy) || f.xy)[pid], p2 = f.xy[pid];
  if (!p1 || !p2) return p2 || p1 || [0, 0];
  const jump = (a, b) => !a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) > 40;
  if (jump(p1, p2) || t <= 0) return t <= 0 ? p1 : [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
  const fi = frames[idx] === f ? idx : frames.indexOf(f);
  const xy = i => frames[i] && frames[i].kind === "tick" && frames[i].xy ? frames[i].xy[pid] : null;
  let p0 = xy(fi - 2), p3 = xy(fi + 1);
  if (jump(p0, p1)) p0 = p1; if (jump(p2, p3)) p3 = p2;
  const c = k => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
  return [c(0), c(1)];
}

function areaOf(x, y) {
  for (const [n, r] of Object.entries(game.map.rooms)) { const b = box(r); if (x >= b.x0 && x <= b.x0 + b.w && y >= b.y0 && y <= b.y0 + b.h) return n; }
  for (const [n, r] of Object.entries(GEO().cors)) if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return n;
  return null;
}

function povRadius(f) {
  const s = game.settings;
  if (roleAt(POV, f) === "impostor") return s.vision_impostor;
  if (f.sabotage && f.sabotage.kind === "lights" && f.alive[POV]) return s.vision_lights;
  return s.vision;
}

function povSees(f, me, x, y) {        // same rule as the engine: vision circle + my area or the one I look into
  if (!f.alive || !f.alive[POV]) return true;   // ghosts see everything
  if (Math.hypot(me.x - x, me.y - (y - 6)) > povRadius(f)) return false;
  const a = areaOf(me.x, me.y + 6), b = areaOf(x, y);
  if (!a || !b || a === b) return true;
  return (a.includes("~") && a.split("~").includes(b)) || (b.includes("~") && b.split("~").includes(a));
}

function directorPick(f) {        // auto camera: stay with busy places, switch every ~20 s; with roles shown, follow the hunt
  const alive = game.players.filter(p => f.alive[p.pid]);
  if (!alive.length) return POV;
  const kill = (f.events || []).find(e => e.e === "kill");
  if (TRUTH && kill) { DIR = {pid: kill.by, since: f.ts}; return DIR.pid; }
  if (DIR && f.alive[DIR.pid] && f.ts - DIR.since < 20 && f.ts >= DIR.since) return DIR.pid;
  const score = p => { const [x, y] = f.xy[p.pid]; let n = 0, crewNear = 0;
    for (const q of alive) if (q !== p) { const d = Math.hypot(f.xy[q.pid][0] - x, f.xy[q.pid][1] - y); if (d < 180) { n++; if (roleAt(q.pid, f) !== "impostor") crewNear++; } }
    return n + (TRUTH && roleAt(p.pid, f) === "impostor" && crewNear === 1 ? 6 : 0) + Math.random() * 1.5 - (DIR && DIR.pid === p.pid ? 3 : 0); };
  const best = alive.reduce((a, b) => score(b) > score(a) ? b : a, alive[0]);
  DIR = {pid: best.pid, since: f.ts}; return best.pid;
}

function camFor(f, prev, t) {
  const tg = posAt(f, prev, t, POV);
  if (!CAM || CAM.pid !== POV || Math.hypot(CAM.x - tg.x, CAM.y - tg.y) > 240) CAM = {pid: POV, x: tg.x, y: tg.y};
  CAM.x += (tg.x - CAM.x) * .2; CAM.y += (tg.y - CAM.y) * .2;
  const hw = LW / 2 / Z, hh = LH / 2 / Z;
  CAM.x = Math.max(hw - 30, Math.min(LW - hw + 30, CAM.x)); CAM.y = Math.max(hh - 30, Math.min(LH - hh + 30, CAM.y));
  return CAM;
}

const worldT = () => { const k = cv.width / LW; cx.setTransform(k * Z, 0, 0, k * Z, (LW / 2 - CAM.x * Z) * k, (LH / 2 - CAM.y * Z) * k); };

const screenT = () => cx.setTransform(cv.width / LW, 0, 0, cv.height / LH, 0, 0);

const toScreen = (x, y) => ({x: (x - CAM.x) * Z + LW / 2, y: (y - CAM.y) * Z + LH / 2});

const toWorld = (x, y) => ({x: CAM.x + (x - LW / 2) / Z, y: CAM.y + (y - LH / 2) / Z});

function drawFog(f, me) {
  if (!f.alive[POV]) { cx.fillStyle = "rgba(40,60,90,.16)"; cx.fillRect(0, 0, LW, LH); return; }   // ghost: pale veil, sees all
  if (!fogC || fogC.width !== cv.width || fogC.height !== cv.height) { fogC = document.createElement("canvas"); fogC.width = cv.width; fogC.height = cv.height; }
  const o = fogC.getContext("2d"); o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, fogC.width, fogC.height);
  o.setTransform(cv.width / LW, 0, 0, cv.height / LH, 0, 0);
  o.fillStyle = "rgba(2,4,8,.84)"; o.fillRect(0, 0, LW, LH);
  o.globalCompositeOperation = "destination-out";
  const s = toScreen(me.x, me.y), R = povRadius(f) * Z, g = o.createRadialGradient(s.x, s.y, R * .72, s.x, s.y, R);
  g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
  o.fillStyle = g; o.beginPath(); o.arc(s.x, s.y, R, 0, 7); o.fill(); o.globalCompositeOperation = "source-over";
  cx.drawImage(fogC, 0, 0, LW, LH);
}

function buildPov(from = 0) {       // per-frame cooldowns and task progress for every player
  const s = game.settings;
  if (!from || !PS) { KREADY = []; SREADY = []; TASKDONE = []; TURN_TS = null; TURN_EVENT = null; PS = {kr: {}, steps: {}, sr: s.sabotage_cooldown};
    for (const p of game.players) { PS.kr[p.pid] = s.kill_cooldown_start; PS.steps[p.pid] = {}; } from = 0; }
  const kr = PS.kr; let steps = PS.steps, sr = PS.sr;
  frames.forEach((f, i) => { if (i < from) return; let changed = false;
    for (const e of f.events || []) {
      if (e.e === "kill") kr[e.by] = f.ts + s.kill_cooldown;
      if (e.e === "turn") { TURN_TS = f.ts; TURN_EVENT = e; for (const k of e.impostors) kr[k] = f.ts + s.kill_cooldown_start; sr = Math.max(sr, f.ts + s.kill_cooldown_start); }
      if (e.e === "sabotage" || e.e === "fixed") sr = f.ts + s.sabotage_cooldown;
      if (e.e === "task_step") { steps = {...steps, [e.by]: {...steps[e.by], [e.task]: (steps[e.by][e.task] || 0) + 1}}; changed = true; }
    }
    if (f.kind === "meeting_end") { for (const k in kr) kr[k] = f.ts + s.kill_cooldown; sr = f.ts + s.sabotage_cooldown; }
    KREADY.push({...kr}); SREADY.push(sr); TASKDONE.push(steps);
  });
  PS.steps = steps; PS.sr = sr;
}

function avail(f, me) {
  const s = game.settings, p = pById(POV), room = areaOf(me.x, me.y + 6), sp = room && GEO().spots[room], out = {};
  if (!f.alive[POV]) { out.use = false; return out; }
  const near = pt => pt && Math.hypot(me.x - pt[0], me.y + 6 - pt[1]) <= s.interact + 4, st = game.map.stations;
  out.report = (f.bodies || []).some(b => Math.hypot(me.x - b.x, me.y + 6 - b.y) <= s.report_range && povSees(f, me, b.x, b.y));
  const done = (TASKDONE[idx] || {})[POV] || {}, taskHere = room && p.tasks.some(t => { const st2 = game.map.tasks[t].steps, k = done[t] || 0; return k < st2.length && st2[k][0] === room; });
  const fixRooms = f.sabotage ? (f.sabotage.kind === "pressure" ? st.pressure_fix : [st[f.sabotage.kind + "_fix"]]) : [];
  out.use = !!sp && ((taskHere && near(sp.task)) || (["admin", "vitals", "cams"].some(k => st[k] === room) && near(sp.console))
    || (fixRooms.includes(room) && near(sp.panel)) || (room === st.button && near(sp.button)));
  if (roleAt(POV, f) === "impostor") {
    const left = Math.max(0, ((KREADY[idx] || {})[POV] ?? 0) - f.ts);
    out.killIn = left;
    out.kill = left <= 0 && game.players.some(q => roleAt(q.pid, f) !== "impostor" && f.alive[q.pid] && Math.hypot(f.xy[q.pid][0] - me.x, f.xy[q.pid][1] - me.y - 6) <= s.kill_range);
    out.vent = !!sp && game.map.vents.some(n => n.includes(room)) && near(sp.vent);
    out.sabotage = !f.sabotage && f.ts >= SREADY[idx];
  }
  return out;
}

function startKillcam(i) {
  const f = frames[i], e = (f.events || []).find(x => x.e === "kill"); if (!e || !f.xy) return;
  const v = f.xy[e.victim]; KILLCAM = {i, wall: performance.now(), x: v[0], y: v[1] - 6, by: e.by, victim: e.victim, room: e.room};
}

function drawKillcam() {
  const k = (performance.now() - KILLCAM.wall) / KC_MS; if (k >= 1) { KILLCAM = null; CAM = null; return false; }
  const f = frames[KILLCAM.i], z = 2.2 + 1.4 * easeOut(Math.min(1, k * 2.5)), kk = cv.width / LW;
  cx.fillStyle = "#04070c"; cx.fillRect(0, 0, LW, LH);
  cx.setTransform(kk * z, 0, 0, kk * z, (LW / 2 - KILLCAM.x * z) * kk, (LH / 2 - KILLCAM.y * z) * kk);
  drawMap(f); drawPlayers(f, f, 1);
  screenT();
  const g = cx.createRadialGradient(LW / 2, LH / 2, 120, LW / 2, LH / 2, 560); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(120,0,0,${.75 * Math.min(1, k * 4)})`);
  cx.fillStyle = g; cx.fillRect(0, 0, LW, LH);
  if (k < .08) { cx.fillStyle = `rgba(255,40,40,${.5 * (1 - k / .08)})`; cx.fillRect(0, 0, LW, LH); }
  const a = Math.min(1, k * 5) * (k > .85 ? (1 - k) / .15 : 1);
  cx.save(); cx.globalAlpha = a; cx.textAlign = "center";
  cx.fillStyle = "rgba(0,0,0,.65)"; roundRect(LW / 2 - 260, LH - 120, 520, 76, 14); cx.fill();
  cx.fillStyle = "#ff4d4d"; cx.font = "900 30px system-ui"; cx.fillText("KILL", LW / 2, LH - 84);
  cx.fillStyle = "#e6edf3"; cx.font = "700 16px system-ui"; cx.fillText(`${nameOf(KILLCAM.by)} took out ${nameOf(KILLCAM.victim)} · ${pretty(KILLCAM.room)}`, LW / 2, LH - 58);
  cx.fillStyle = "#ff8a80"; cx.font = "800 11px system-ui"; cx.fillText("● KILL CAM", 70, 30); cx.restore();
  return true;
}

function screenPos(x, y) { return POV && RT && CAM && !KILLCAM ? toScreen(x, y) : {x, y}; }

function drawBubbles(f) {         // the newest private thought over a worker's head (only with roles shown)
  if (!TRUTH || !THOUGHTS.length) return;
  const shown = [];
  for (const h of HIT) { const th = THOUGHTS.filter(x => x.pid === h.pid && x.tick <= f.tick).pop();
    if (th && f.tick - th.tick < 5) shown.push({h, th}); }
  shown.sort((a, b) => b.th.tick - a.th.tick).slice(0, 3).forEach(({h, th}) => {
    const s = screenPos(h.x, h.y), txt = pretty(th.thought), short = txt.length > 64 ? txt.slice(0, 63) + "…" : txt;
    cx.font = "italic 11px system-ui"; const w = Math.min(260, cx.measureText(short).width + 18), x = Math.max(8, Math.min(LW - w - 8, s.x - w / 2)), y = s.y - (POV && RT ? 92 : 56);
    cx.fillStyle = "rgba(255,255,255,.92)"; roundRect(x, y, w, 22, 11); cx.fill();
    cx.beginPath(); cx.arc(s.x - 4, y + 28, 3, 0, 7); cx.arc(s.x - 1, y + 34, 1.8, 0, 7); cx.fill();
    cx.fillStyle = "#1b222c"; cx.textAlign = "left"; cx.fillText(short, x + 9, y + 15); });
}

function latestComment(gt) { for (let i = COMMENTS.length - 1; i >= 0; i--) if (COMMENTS[i].ts <= gt) return gt - COMMENTS[i].ts < 9 ? COMMENTS[i] : null; return null; }

function speak(c) {               // the browser reads the commentary aloud (free, on this computer)
  if (!VOICE || !window.speechSynthesis || c.ts <= SPOKEN) return; SPOKEN = c.ts;
  try { const u = new SpeechSynthesisUtterance(c.text); u.rate = 1.08; u.pitch = 1; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
}
// music: a slow pad that changes with the phase, and a heartbeat when the impostor is alone with someone

function music(phase, tension) {
  const a = SOUND ? audio() : null; if (!a) { if (MUS) MUS.g.gain.setTargetAtTime(0, AC.currentTime, .3); return; }
  if (!MUS) { const g = a.createGain(); g.gain.value = 0; g.connect(a.destination);
    const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700; f.connect(g);
    const osc = [0, 1, 2].map(() => { const o = a.createOscillator(); o.type = "sawtooth"; const og = a.createGain(); og.gain.value = .02; o.connect(og).connect(f); o.start(); return o; });
    MUS = {g, f, osc, phase: null, beat: 0}; }
  const chords = {roam: [110, 130.8, 164.8], meeting: [87.3, 130.8, 174.6], end: [130.8, 164.8, 196], tension: [103.8, 123.5, 155.6]};
  const key = tension ? "tension" : phase;
  if (MUS.phase !== key) { MUS.phase = key; chords[key].forEach((hz, i) => MUS.osc[i].frequency.setTargetAtTime(hz, a.currentTime, .6)); }
  MUS.g.gain.setTargetAtTime(.55, a.currentTime, .8);
  MUS.f.frequency.setTargetAtTime(tension ? 1100 : 650, a.currentTime, .5);
  if (tension && performance.now() - MUS.beat > 820) { MUS.beat = performance.now(); tone(55, .18, "sine", .35, -15); tone(50, .16, "sine", .25, -12, .2); }
}

function tensionNow(f) {
  if (!RT || !TRUTH || !f.xy || f.kind !== "tick") return false;
  const imp = game.players.find(p => roleAt(p.pid, f) === "impostor" && f.alive[p.pid]); if (!imp) return false;
  const [x, y] = f.xy[imp.pid], near = game.players.filter(q => q !== imp && f.alive[q.pid] && Math.hypot(f.xy[q.pid][0] - x, f.xy[q.pid][1] - y) < 200);
  return near.length === 1 && Math.hypot(f.xy[near[0].pid][0] - x, f.xy[near[0].pid][1] - y) < 140;
}

const easeOut = x => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 4);

function poolList() {
  const ps = game.pool_style || {};
  const L = (game.pool || []).map(m => ({model: m, ...ps[m]}));
  return L.length ? L : [...new Map(game.players.map(p => [p.model, {model: p.model, name: p.name.replace(/ #\d+$/, ""), colour: p.colour, family: p.family, label: p.label}])).values()];
}

function audio() { if (!SOUND) return null; try { AC ||= new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); } catch { return null; } return AC; }

function tone(freq, dur, type = "sine", vol = .12, slide = 0, when = 0) {
  const a = audio(); if (!a) return; const t0 = a.currentTime + when, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur); o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + .02);
}

function noise(dur, vol = .1, freq = 1200, when = 0, q = 1) {
  const a = audio(); if (!a) return; const t0 = a.currentTime + when, n = a.createBufferSource(), b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const f = a.createBiquadFilter(), g = a.createGain(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  n.buffer = b; g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur); n.connect(f).connect(g).connect(a.destination); n.start(t0);
}

const SFX = {
  step: () => noise(.05, .05, 500 + Math.random() * 200, 0, 2),
  kill: () => { noise(.18, .35, 2600, 0, .7); tone(320, .5, "sawtooth", .16, -260, .03); tone(90, .6, "sine", .25, -40, .05); },
  alarm: () => { for (let i = 0; i < 3; i++) { tone(880, .18, "square", .07, 0, i * .36); tone(660, .18, "square", .07, 0, i * .36 + .18); } },
  bell: () => { tone(988, 1.2, "sine", .12); tone(1480, .9, "sine", .06); tone(1976, .5, "sine", .03); },
  blip: () => tone(740, .06, "sine", .06, 120),
  vote: () => { tone(180, .08, "square", .08); noise(.06, .12, 300, .02, 1.5); },
  reveal: () => { tone(110, .9, "sawtooth", .07, -30); tone(82, 1.2, "sine", .18, -20, .05); },
  whoosh: () => noise(1.1, .2, 700, 0, .4),
  ding: () => { tone(1046, .25, "triangle", .1); tone(1568, .35, "triangle", .08, 0, .1); },
  intro: imp => { tone(imp ? 98 : 131, 2.2, "sawtooth", .05); tone(imp ? 116 : 165, 2.2, "sine", .1, 0, .15); tone(imp ? 147 : 196, 2.2, "sine", .08, 0, .3); },
  sabotage: () => { for (let i = 0; i < 4; i++) tone(520, .12, "square", .06, 0, i * .22); },
  pass: () => {},
};

function onEnter(i) {         // play the sound for what just happened (from the watched worker's point of view)
  if (!SOUND || !AC && !playing) return;
  const f = frames[i], prev = frames[Math.max(0, i - 1)];
  if (f.kind === "start" && POV && RT) setTimeout(() => SFX.intro(false), 600);
  if (f.kind === "tick" && RT && (f.events || []).some(e => e.e === "kill") && playing) startKillcam(i);
  if (f.kind === "tick") for (const e of f.events || []) {
    const seen = !POV || !RT || !f.xy || povSees(f, posAt(f, null, 1, POV), f.xy[e.victim || e.by][0], f.xy[e.victim || e.by][1]);
    if (e.e === "kill" && seen) SFX.kill();
    if (e.e === "sabotage") SFX.sabotage();
    if (e.e === "task_step" && e.by === POV) SFX.ding();
    if (e.e === "turn" && POV && e.impostors.includes(POV)) SFX.intro(true);
  }
  if (f.kind === "meeting" && !f.latest && !f.votes && !f.typing && !f.passed && !f.voting) (f.meeting.reason === "body" ? SFX.alarm : SFX.bell)();
  if (f.latest) SFX.blip();
  if (f.justVoted) SFX.vote();
  if (f.votes) SFX.reveal();
  if (f.kind === "eject") SFX.whoosh();
}

const nameOf = pid => (game.players.find(p => p.pid === pid) || {}).name || pid;

const fmtT = t => RT ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : `t${t}`;

const pById = pid => game.players.find(p => p.pid === pid);

const pByName = n => game.players.find(p => p.name === n);

function frameLines(f) {   // [{cls, text}] for one frame; hides impostor-only facts unless roles are revealed
  const out = [], T = TRUTH;
  if (f.kind === "start") out.push({cls: "sys", text: RT ? `Seat draw: ${game.players.length} players, all crew. ${game.settings.impostors === 1 ? "One of them will" : game.settings.impostors + " of them will"} secretly become ${game.settings.impostors === 1 ? "the impostor" : "impostors"} ${game.settings.turn_after || 10} s after the shift starts.`
    : `Shift starts: ${game.players.length} workers, ${game.settings.impostors} of them are impostors.`});
  if (f.kind === "tick") for (const e of f.events) {
    if (e.e === "kill") out.push({cls: "kill", text: T ? `${nameOf(e.by)} killed ${nameOf(e.victim)} in ${e.room}` : `${nameOf(e.victim)} was killed in ${e.room}`});
    else if (e.e === "vent") { if (T) out.push({cls: "sab", text: `${nameOf(e.by)} vented ${e.from} → ${e.to}`}); }
    else if (e.e === "sabotage") out.push({cls: "sab", text: T ? `${nameOf(e.by)} sabotaged ${e.kind}` : `Sabotage: ${e.kind === "lights" ? "lights out" : e.kind === "pressure" ? "pressure leak" : e.kind + " down"}`});
    else if (e.e === "doors") out.push({cls: "sab", text: T ? `${nameOf(e.by)} locked ${e.room}` : `${e.room} doors locked`});
    else if (e.e === "turn") out.push({cls: "turn", text: T ? `${e.impostors.map(nameOf).join(" and ")} ${e.impostors.length > 1 ? "were" : "was"} secretly made ${e.impostors.length > 1 ? "impostors" : "an impostor"}`
      : `Somewhere on the station, ${e.impostors.length} worker${e.impostors.length > 1 ? "s were" : " was"} secretly turned into ${e.impostors.length > 1 ? "impostors" : "an impostor"}.`});
    else if (e.e === "fixed") out.push({cls: "sys", text: `${e.kind} fixed by ${nameOf(e.by)}`});
    else if (e.e === "reflex") out.push({cls: "meet", text: `${nameOf(e.by)} spotted a body and reported it on reflex`});
    else if (e.e === "task_step" && e.done) out.push({cls: "sys", text: `${nameOf(e.by)} finished ${String(e.task).replace(/_/g, " ")}`});
  }
  if (f.typing) out.push({cls: "tmp", text: `${nameOf(f.typing)} is typing…`});
  if (f.passed) out.push({cls: "tmp", text: `${nameOf(f.passed)} has nothing to add.`});
  if (f.voting && !f.justVoted) out.push({cls: "tmp", text: "Discussion over. Everyone is voting."});
  if (f.justVoted) out.push({cls: "tmp", text: `${nameOf(f.justVoted)} voted.`});
  if (f.kind === "meeting" && !f.votes && !f.latest && !f.typing && !f.passed && !f.voting) out.push({cls: "meet", text: f.meeting.reason === "body"
      ? `${nameOf(f.meeting.caller)} reported ${nameOf(f.meeting.body)}'s body${f.meeting.body_room ? " in " + f.meeting.body_room : ""}`
      : `${nameOf(f.meeting.caller)} pressed the emergency button`});
  if (f.kind === "meeting" && f.latest) { const m = f.meeting.msgs[f.meeting.msgs.length - 1]; out.push({cls: "say", who: m.speaker, text: m.text}); }
  if (f.kind === "meeting" && f.votes) { const r = f.meeting.result, tl = Object.entries(r.tally || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
    out.push({cls: "meet", text: `Votes are in: ${tl.join(", ") || "everyone skipped"}`}); }
  if (f.kind === "eject") out.push({cls: "meet", text: f.meeting.result.text});
  if (f.kind === "end") out.push({cls: "end", text: `${f.winner === "crew" ? "Crew wins" : f.winner === "impostor" ? "Impostors win" : f.winner === "jester" ? "The Jester wins" : "Game over"}: ${f.reason}`});
  return out;
}

function buildIndex(from = 0) {
  if (!from) { EVENTS = []; EJECT_AT = {}; }
  frames.forEach((f, i) => { if (i < from) return;
    for (const l of frameLines(f)) if (l.cls !== "tmp") EVENTS.push({i, tick: f.tick, ...l});
    if (f.kind === "eject" && f.meeting.result.ejected) EJECT_AT[f.meeting.result.ejected] = {i, role: f.meeting.result.ejected_role};
  });
}

const PHASE = f => f.kind === "start" ? ["START", ""] : f.kind === "tick" ? ["ROAMING", "roam"] : f.kind === "eject" ? ["EJECTION", "eject"]
  : f.kind === "end" ? ["GAME OVER", "end"] : f.votes || f.voting ? ["VOTING", "vote"] : ["MEETING", "meet"];

function av(p, size = 30, ghost = false) {   // the same bot as on the map, as a small SVG for the HTML panels
  const c = colOf(p), acc = ACC(p), clay = p.family === "claude", open = p.family === "open";
  const sign = {
    sprout: `<path d="M15 6v-3" stroke="#4f9a52" stroke-width="1.2"/><ellipse cx="12.8" cy="3" rx="2.6" ry="1.3" fill="#6cc46f"/><ellipse cx="17.2" cy="2.4" rx="2.6" ry="1.3" fill="#6cc46f"/>`,
    crown: `<path d="M10.5 7l-1-5 3 2.5L15 .8l2.5 3.7 3-2.5-1 5z" fill="#f2c230"/>`,
    phones: `<path d="M5.5 13a9.5 9.5 0 0 1 19 0" fill="none" stroke="#2b2f36" stroke-width="2"/><rect x="3.5" y="11" width="4" height="7" rx="2" fill="#2b2f36"/><rect x="22.5" y="11" width="4" height="7" rx="2" fill="#2b2f36"/>`,
    blossom: `<circle cx="9" cy="6" r="2.6" fill="#f7a8c8"/><circle cx="9" cy="6" r="1" fill="#ffe08a"/>`,
    star: `<path d="M17 6l1.5-3" stroke="#c9d1d9" stroke-width="1.2"/><path d="M18.8 -.4l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#ffe27a"/>`,
    sun: `<circle cx="15" cy="12" r="12.5" fill="none" stroke="#ffd24a" stroke-width="1.8" stroke-dasharray="2.2 2.6"/>`,
    ears: `<rect x="3" y="8" width="3.4" height="8" rx="1.7" fill="${c}"/><rect x="23.6" y="8" width="3.4" height="8" rx="1.7" fill="${c}"/>`,
    antenna: `<path d="M16 3l1-3" stroke="#2b2f36" stroke-width="1.2"/><circle cx="17.2" cy="-.6" r="1.9" fill="#ff6a3c" stroke="#11141b" stroke-width=".8"/>`,
    propeller: `<path d="M15 2.5v-2.5" stroke="#2b2f36" stroke-width="1.2"/><ellipse cx="12" cy="0" rx="3" ry="1" fill="#ffd166"/><ellipse cx="18" cy="0" rx="3" ry="1" fill="#4cc9f0"/>`,
    bow: `<path d="M9 5l-4-3v6zM9 5l4-3v6z" fill="#ff7ab6" stroke="#11141b" stroke-width=".8"/>`,
    spikes: `<path d="M9 4l2-4 2 4zM13 3l2-5 2 5zM17 4l2-4 2 4z" fill="${shade(c, -.3)}" stroke="#11141b" stroke-width=".8"/>`,
    goggles: `<circle cx="12.5" cy="5" r="2.4" fill="#9fe3ff" stroke="#11141b" stroke-width=".9"/><circle cx="18.5" cy="5" r="2.4" fill="#9fe3ff" stroke="#11141b" stroke-width=".9"/>`,
    bolt: `<path d="M21 -1l-3 4.5h2l-1.2 3.6 3.6-4.6h-2z" fill="#ffe14a" stroke="#11141b" stroke-width=".7"/>`,
    cap: `<path d="M7.5 6q7.5-9 15 0z" fill="#1f6feb" stroke="#11141b" stroke-width=".9"/><ellipse cx="24" cy="6" rx="4" ry="1.1" fill="#1f6feb" stroke="#11141b" stroke-width=".8"/>`}[acc] || "";
  const face = clay
    ? `<ellipse cx="17.5" cy="11.5" rx="6.6" ry="5.6" fill="#f6e8d4" stroke="#11141b" stroke-width="1"/>
       <ellipse cx="15.4" cy="10.8" rx="1.4" ry="2.1" fill="#2a1a10"/><ellipse cx="19.6" cy="10.8" rx="1.4" ry="2.1" fill="#2a1a10"/>
       <path d="M16.2 13.8q1.3 1.2 2.6 0" fill="none" stroke="#2a1a10" stroke-width=".9" stroke-linecap="round"/>
       <path d="M4.5 18q10.5 2.6 21 0" fill="none" stroke="rgba(255,240,220,.6)" stroke-width=".9" stroke-dasharray="1.4 1.4"/>`
    : open ? `<rect x="8.5" y="7" width="16" height="7.5" rx="3.7" fill="#0f1d1a" stroke="#11141b" stroke-width="1"/>
       <circle cx="13" cy="10.8" r="1.7" fill="${shade(c, .7)}"/><circle cx="19.5" cy="10.8" r="1.7" fill="${shade(c, .7)}"/>
       <rect x="14" y="19" width="1.3" height="4.5" rx=".6" fill="rgba(10,14,22,.55)"/><rect x="16.6" y="19" width="1.3" height="4.5" rx=".6" fill="rgba(10,14,22,.55)"/>`
    : `<rect x="10.5" y="6.5" width="13" height="9" rx="4.5" fill="#0b1020" stroke="#11141b" stroke-width="1"/>
       <rect x="13.4" y="8.4" width="2.2" height="4.6" rx="1.1" fill="#dfe8ff"/><rect x="18" y="8.4" width="2.2" height="4.6" rx="1.1" fill="#dfe8ff"/>
       <rect x="4.5" y="17" width="21" height="1.6" fill="rgba(235,242,250,.85)"/>`;
  return `<svg class="av" width="${size}" height="${size}" viewBox="-1 -1 32 32" stroke-linejoin="round" aria-hidden="true" style="opacity:${ghost ? .55 : 1}">
    <ellipse cx="11" cy="28.6" rx="3.6" ry="2" fill="${c}" stroke="#11141b" stroke-width="1"/><ellipse cx="19" cy="28.6" rx="3.6" ry="2" fill="${c}" stroke="#11141b" stroke-width="1"/>
    <path d="M15 2C22.6 2 25 11 25 18.5S21.6 28 15 28 5 25.7 5 18.5 7.4 2 15 2z" fill="${c}" stroke="#11141b" stroke-width="1.2"/>${face}${sign}</svg>`;
}

function status(p, f) {
  if (f.alive && f.alive[p.pid]) return "alive";
  const ej = EJECT_AT[p.name]; return ej && ej.i <= idx ? "ejected" : "dead";
}

const fixedMs = f => (f.kind === "meeting" ? (f.latest ? 2600 : f.votes ? 3000 : f.typing ? 900 : f.passed ? 500 : f.voting ? 350 : 1800) : f.kind === "eject" ? 3200 : f.kind === "end" ? 5000 : f.kind === "start" ? 1800 : 700);

function frameMs(i) {
  const f = frames[i], g = frames[i + 1];
  if (PACED && g && f.ts != null && g.ts != null) return Math.max(120, Math.min(15000, (g.ts - f.ts) * 1000));
  if (PACED && !g) return f.kind === "end" ? 5000 : f.kind === "eject" ? 6000 : 3000;   // live edge: hold one human beat
  return fixedMs(f);
}
