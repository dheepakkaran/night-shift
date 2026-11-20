// main.js: boot, the one frame loop, input.
function fitCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.max(400, Math.round(cv.clientWidth * dpr)), h = Math.round(w * LH / LW);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
}
try { new ResizeObserver(fitCanvas).observe(cv); } catch { addEventListener("resize", fitCanvas); }
fitCanvas();

function frame() {
  requestAnimationFrame(frame);
  if (!game || !frames.length || !CLOCK) return;
  for (const i of clockTick()) onEnter(i);                    // sounds, kill cam
  const f = frames[idx], prev = frames[Math.max(0, idx - 1)], pv = prev.kind === "tick" || prev.kind === "start" ? prev : f;
  TRUTH = f.kind === "end" || audienceKnows();
  if (KILLCAM && f.kind !== "tick") KILLCAM = null;           // a meeting cuts the kill cam
  BAKE_SCALE = Math.min(3, (cv.width / LW) * Z);
  let vw = null;
  if (f.kind === "eject") { cx.setTransform(cv.width / LW, 0, 0, cv.height / LH, 0, 0); drawEject(f, TF); }
  else if (KILLCAM && renderKillcam()) { /* kill cam owns the screen */ }
  else if (f.kind === "tick" || f.kind === "meeting_end") {
    vw = currentView(f, pv, TF); LAST_VIEW = vw;
    renderWorld(f, pv, TF, vw);
    cx.setTransform(cv.width / LW, 0, 0, cv.height / LH, 0, 0); drawBubbles(f);
    renderPip(f, pv, TF);
  } else { LAST_VIEW = {m: viewMatrix(null)}; renderWorld(f, f, 1, LAST_VIEW); }
  UI.render(f, vw);
  if (game && RT) {
    music(f.kind === "meeting" || f.kind === "eject" ? "meeting" : f.kind === "end" ? "end" : "roam", MODE === "spectator" && tensionNow(f));
    if (MUS && window.speechSynthesis && speechSynthesis.speaking && AC) MUS.g.gain.setTargetAtTime(.15, AC.currentTime, .2);   // duck under the voice
  }
}
requestAnimationFrame(frame);

// click a worker on the map to watch them
cv.addEventListener("click", e => {
  if (!LAST_VIEW || !HIT.length) return;
  const r = cv.getBoundingClientRect(), k = cv.width / LW, sx = (e.clientX - r.left) / r.width * cv.width, sy = (e.clientY - r.top) / r.height * cv.height;
  const m = LAST_VIEW.m, wx = (sx - m[4]) / m[0], wy = (sy - m[5]) / m[3];
  let best = null, bd = 28; for (const h of HIT) { const d = Math.hypot(h.x - wx, h.y - wy); if (d < bd) { bd = d; best = h; } }
  if (best) UI.setView("pov", best.pid);
});
cv.addEventListener("contextmenu", e => {
  if (MODE !== "detective" || !LAST_VIEW) return; e.preventDefault();
  const r = cv.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * cv.width, sy = (e.clientY - r.top) / r.height * cv.height, m = LAST_VIEW.m;
  const wx = (sx - m[4]) / m[0], wy = (sy - m[5]) / m[3];
  for (const h of HIT) if (Math.hypot(h.x - wx, h.y - wy) < 28) { GUESS = GUESS === h.pid ? null : h.pid; break; }
});

addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === "INPUT") return;
  const k = e.key;
  if (k === "1") UI.setView("director"); else if (k === "2") UI.setView("pov"); else if (k === "3") UI.setView("map");
  else if ((k === "[" || k === "]") && game) { const ids = game.players.map(p => p.pid), i = Math.max(0, ids.indexOf(UI.view.pid)); UI.setView("pov", ids[(i + (k === "]" ? 1 : ids.length - 1)) % ids.length]); }
  else if (k === "t" || k === "T") $("tvBtn").click();
  else if (k === "d" || k === "D") $("drawerBtn").click();
  else if (k === "s" || k === "S") $("soundBtn").click();
  else if (k === "v" || k === "V") $("voiceBtn").click();
  else if (k === "?") $("help").classList.toggle("on");
  else if (k === "Escape") { $("help").classList.remove("on"); UI.drawer(false); document.body.classList.remove("tv"); $("tvBtn").classList.remove("on"); }
});
addEventListener("pointerdown", () => audio(), {once: true});    // browsers start sound only after a click

// boot: join a running shift, or open ?run=..., or show the lobby
(async () => {
  const q = new URLSearchParams(location.search), want = q.get("run");
  const live = await fetch("/api/live").then(r => r.json()).catch(() => ({}));
  if (live.running && live.run) return openRun(live.run, {live: true});
  if (want) return openRun(want, {live: false});
  UI.showLobby();
})();
