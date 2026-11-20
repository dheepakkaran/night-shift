// ui.js: every HTML screen and HUD piece. Canvas = the world; everything with words = here.
const UI = (() => {
  const view = {kind: store.get("view", "director"), pid: null};
  let screen = null, built = {}, lastIdx = -1, feedKeys = "", tbMeeting = null, tbMsgs = 0, tbVotesShown = null;
  const show = name => {
    const groups = {live: "live", spin: "live", casting: "intro", splash: "meet", tribunal: "meet", eject: "meet", results: "end", lobby: "lobby"};
    if (screen && groups[screen] !== groups[name] && screen !== "lobby" && name !== "lobby") { const w = $("wipe"); w.classList.remove("go"); void w.offsetWidth; w.classList.add("go"); }
    screen = name;
    for (const id of ["lobby", "casting", "spin", "splash", "tribunal", "ejectcap", "results"]) $(id).classList.toggle("on", id === name || (id === "ejectcap" && name === "eject"));
    $("hud").style.display = name === "live" || name === "spin" ? "" : "none";
    if (name !== "live") $("pip").classList.remove("on");
  };
  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const P = () => game.players;
  const img = (p, o = {}) => `<img src="${portrait(p, o)}" alt="">`;

  const STYLE_NAMES = {detective: "🔎 The Detective", buddy: "🤝 The Buddy", watchman: "📹 The Watchman", speedrunner: "⚡ The Speedrunner",
    skeptic: "🧐 The Skeptic", leader: "🧭 The Captain", quiet: "🤫 The Quiet One", timeline: "⏱ The Timekeeper", ventwatch: "🕳 The Vent Watcher", fixer: "🔧 The Fixer"};

  // ---------------- lobby
  function staticLobby(over) {               // GitHub Pages: recorded shifts to watch, no START (see js/static.js)
    const S = window.STATIC; let pick = S.shifts[0].run;
    document.body.classList.add("static");
    $("models").className = "models shifts";
    $("models").innerHTML = S.shifts.map(sh => `<div class="shift glass ${sh.run === pick ? "on" : ""}" data-r="${sh.run}">
      <div class="tag">${esc(sh.tag)}</div><b>${esc(sh.title)}</b><small>${esc(sh.sub)}</small>
      <div class="crew">${sh.players.map(p => av(p, 26)).join("")}</div></div>`).join("");
    $("models").onclick = e => { const d = e.target.closest(".shift"); if (!d) return; pick = d.dataset.r; for (const x of $("models").children) x.classList.toggle("on", x === d); };
    $("models").ondblclick = e => { const d = e.target.closest(".shift"); if (d) openRun(d.dataset.r, {live: false}); };
    for (const b of $("modeSeg").children) b.classList.toggle("on", b.dataset.m === MODE);
    $("modeSeg").onclick = e => { const m = e.target.closest("button"); if (!m) return; MODE = m.dataset.m; store.set("mode", MODE); for (const b of $("modeSeg").children) b.classList.toggle("on", b === m); };
    $("startNote").textContent = over ? "Watch another one." : "Recorded live: every move, chat line and vote came from the models themselves.";
    $("past").innerHTML = "";
    $("start").disabled = false; $("start").textContent = "WATCH THIS SHIFT";
    $("start").onclick = () => { audio(); openRun(pick, {live: false}); };
  }

  async function showLobby(over = false) {
    show("lobby"); document.body.classList.remove("tv");
    if (window.STATIC) return staticLobby(over);
    const [L, LB, runs] = await Promise.all([fetch("/api/lineups").then(r => r.json()).catch(() => ({})),
      fetch("/api/leaderboard").then(r => r.json()).catch(() => ({models: {}})), fetch("/api/runs").then(r => r.json()).catch(() => [])]);
    const lu = Object.keys(L)[0], pool = (L[lu] && L[lu].pool_style) || {};
    let pick = store.get("lineup", lu); if (!L[pick]) pick = lu;
    const VAR = [["classic", "🛰", "CLASSIC", "The standard rules"], ["blackout", "🌑", "BLACKOUT", "Small vision, lights go out often"],
      ["rush", "⚡", "RUSH", "Fast feet, short tasks, quick kills"], ["double", "👥", "DOUBLE", "Two impostors who know each other"],
      ["jester", "🃏", "JESTER", "A secret fool wins by being voted out"], ["marathon", "🏃", "MARATHON", "More tasks, slower kills, long game"]];
    let variant = store.get("variant", "classic"), brain = store.get("brain", "coached"), seatsN = store.get("seats", 10);
    $("variants").innerHTML = VAR.map(([k, i, t, d]) => `<div class="vr ${k === variant ? "on" : ""}" data-v="${k}"><b><i>${i}</i>${t}</b><small>${d}</small></div>`).join("");
    $("variants").onclick = e => { const d = e.target.closest(".vr"); if (!d) return; variant = d.dataset.v; store.set("variant", variant); for (const x of $("variants").children) x.classList.toggle("on", x === d); };
    const segPick = (id, key, val, set) => { const el = $(id); for (const b of el.children) b.classList.toggle("on", b.dataset[key] == val);
      el.onclick = e => { const b = e.target.closest("button"); if (!b) return; set(b.dataset[key]); for (const x of el.children) x.classList.toggle("on", x === b); }; };
    segPick("brainSeg", "b", brain, v => { brain = v; store.set("brain", v); });
    segPick("seatSeg", "n", seatsN, v => { seatsN = +v; store.set("seats", +v); });
    const drawModels = () => { const sel = L[pick] || {}, ms = sel.models || [];
      $("models").className = "models" + (ms.length > 6 ? " n7" : "");
      $("seatOpt").classList.toggle("off", !sel.draw);
      $("models").innerHTML = ms.map(m => { const s = (LB.models || {})[m.model] || {};
      const fake = {pid: m.model, name: m.name, colour: m.colour, family: m.family};
      const pc = (a, b) => b ? Math.round(100 * a / b) + "%" : "–";
      return `<div class="mc glass" style="--c:${m.colour}">${img(fake)}<b>${esc(m.name)}</b><small>${esc(m.label)}</small>
        <div class="st"><span><em>${s.games || 0}</em>games</span><span><em>${pc(s.imp_wins, s.imp_games)}</em>impostor wins</span><span><em>${pc(s.crew_wins, s.crew_games)}</em>crew wins</span></div></div>`; }).join(""); };
    drawModels();
    $("lineups").innerHTML = Object.entries(L).map(([k, v]) => `<div class="lu glass ${k === pick ? "on" : ""}" data-k="${k}"><b>${esc(v.title)}</b><small>${esc(v.estimate)}${v.free ? "" : " · cap $" + v.cap.toFixed(2) + " per 6 seats"}</small></div>`).join("");
    $("lineups").onclick = e => { const d = e.target.closest(".lu"); if (!d) return; pick = d.dataset.k; store.set("lineup", pick); for (const x of $("lineups").children) x.classList.toggle("on", x === d); drawModels(); };
    for (const b of $("modeSeg").children) b.classList.toggle("on", b.dataset.m === MODE);
    $("modeSeg").onclick = e => { const m = e.target.closest("button"); if (!m) return; MODE = m.dataset.m; store.set("mode", MODE); for (const b of $("modeSeg").children) b.classList.toggle("on", b === m); };
    $("startNote").textContent = over ? "That shift is over. Start another one." : "Every shift is saved as an experiment.";
    const past = runs.filter(r => r.includes("/live-")).slice(0, 4);
    $("past").innerHTML = past.length ? "Watch a past shift again: " + past.map(r => `<a data-r="${r}">${r.split("/")[1].replace("live-", "")}</a>`).join(" · ") : "";
    $("past").onclick = e => { const a = e.target.closest("a"); if (a) openRun(a.dataset.r, {live: false}); };
    $("start").disabled = false; $("start").textContent = "START SHIFT";
    $("start").onclick = async () => {
      $("start").disabled = true; $("start").textContent = "STARTING…"; audio();
      const r = await fetch("/api/start", {method: "POST", body: JSON.stringify({lineup: pick, seats: seatsN, variant, brain})}).then(r => r.json()).catch(e => ({error: String(e)}));
      if (!r.run && r.running && r.error) { $("startNote").textContent = "A shift is already running: joining it."; openRun(r.run || (await fetch("/api/live").then(x => x.json())).run, {live: true}); return; }
      if (!r.run) { $("start").disabled = false; $("start").textContent = "START SHIFT"; $("startNote").textContent = "Could not start: " + (r.error || "server error"); return; }
      for (let i = 0; i < 120; i++) { if (await fetch(`/${r.run}/game.json?t=${Date.now()}`, {method: "HEAD"}).then(x => x.ok).catch(() => false)) break; await new Promise(res => setTimeout(res, 400)); }
      openRun(r.run, {live: true});
    };
  }

  // ---------------- seat draw
  function casting(f) {
    const T = GT - (frames[0].ts || 0), pool = poolList(), n = P().length;
    if (built.cast !== runDir) {
      built.cast = runDir;
      $("castSub").textContent = `${n} seats, each drawn at random from ${pool.length} models. The same model can come up more than once.`;
      $("pool").innerHTML = pool.map(m => `<span class="chip" style="--c:${m.colour}"><i></i>${esc(m.name || m.label)}</span>`).join("");
      $("cards").innerHTML = P().map((p, i) => `<div class="card" id="card${i}" style="--c:${colOf(p)}"><div class="front"><span class="seat">SEAT ${i + 1}</span><img alt=""><span class="reel"></span></div>
        <div class="back"><span class="seat">SEAT ${i + 1}</span>${img(p)}<b>${esc(p.name)}</b><small>${esc(p.label || p.model)}</small>${p.style ? `<span class="style">${STYLE_NAMES[p.style] || ""}</span>` : ""}</div></div>`).join("");
      $("cards").style.gridTemplateColumns = n <= 6 ? "repeat(3, 1fr)" : n <= 8 ? "" : "repeat(5, 1fr)"; $("cards").style.width = n <= 6 ? "66%" : "";
      $("cards").classList.toggle("many", n > 8);
      $("castFoot").innerHTML = `Everyone starts as crew. ${game.settings.turn_after || 10} seconds after the shift starts, one of them is drawn as the <b>IMPOSTOR</b>.`;
    }
    let locked = -1;
    P().forEach((p, i) => {
      const stop = 1.0 + i * .85, card = $("card" + i), done = T >= stop;
      card.classList.toggle("flip", done); if (done) { locked = i; return; }
      const speed = 16 * (1 - .75 * easeOut((T - (stop - 1.1)) / 1.1)), m = pool[Math.floor(T * speed + i * 2.3) % pool.length];
      const fr = card.querySelector(".front"); fr.querySelector(".reel").textContent = m.name || m.label;
      fr.querySelector("img").src = portrait({pid: m.model || m.name, name: m.name, colour: m.colour, family: m.family});
    });
    if (locked > DRAW_SND.locked) { DRAW_SND.locked = locked; SFX.ding(); }
    $("castFoot").classList.toggle("on", T > 1.0 + n * .85 + .3);
  }

  // ---------------- the impostor draw
  function spin(tau) {
    const ps = P(), n = ps.length, chosen = TURN_EVENT ? ps.findIndex(p => p.pid === TURN_EVENT.impostors[0]) : 0, det = MODE === "detective";
    if (built.spin !== runDir) {
      built.spin = runDir;
      $("spinRow").innerHTML = ps.map((p, i) => `<div class="st-tile" id="tile${i}">${img(p)}<span>${esc(p.name)}</span></div>`).join("");
    }
    const steps = 3 * n + (det ? Math.floor(n / 2) : chosen), pos = steps * easeOut(tau / 4.2), hl = Math.min(steps, Math.floor(pos)) % n, landed = tau >= 4.2;
    if (hl !== DRAW_SND.hl && !landed) { DRAW_SND.hl = hl; SFX.blip(); }
    ps.forEach((p, i) => { const t = $("tile" + i);
      t.classList.toggle("hl", !landed && i === hl); t.classList.toggle("win", landed && !det && i === chosen); t.classList.toggle("lose", landed && !det && i !== chosen); });
    $("spinTitle").textContent = landed ? (det ? "THE IMPOSTOR HAS BEEN CHOSEN" : "THE IMPOSTOR IS") : "CHOOSING THE IMPOSTOR";
    if (landed && DRAW_SND.spun !== runDir) { DRAW_SND.spun = runDir; SFX.reveal(); if (!det) SFX.kill(); }
    const p = ps[chosen];
    $("verdict").innerHTML = !landed ? "" : det
      ? `<b>?</b><p class="sub">Only the impostor got the private message. Watch closely and find them. Right-click a worker to mark your suspect.</p>`
      : `<b style="color:#ff8a80">${esc(p.name)}</b><p class="sub">Only ${esc(p.name)} got the private message. Everyone else still thinks they are all crew.</p>`;
  }

  // ---------------- meeting: splash, then the tribunal
  const isSplash = f => f.kind === "meeting" && !f.latest && !f.votes && !f.typing && !f.passed && !f.voting && !f.justVoted;
  function splash(f) {
    const m = f.meeting, body = m.reason === "body", who = pById(body ? m.body : m.caller);
    $("splash").classList.toggle("button", !body);
    $("splashImg").src = portrait(who, {dead: body}); $("splashTitle").textContent = body ? "DEAD BODY REPORTED" : "EMERGENCY MEETING";
    $("splashSub").textContent = body ? `${nameOf(m.caller)} found ${who.name} in ${pretty(m.body_room)}` : `${who.name} pressed the button`;
  }
  function tribunal(f) {
    const m = f.meeting, ps = P(), S = game.settings;
    if (tbMeeting !== runDir + m.n) {                 // a new meeting: seat everyone around the table
      tbMeeting = runDir + m.n; tbMsgs = 0; tbVotesShown = null; $("tbLog").innerHTML = ""; $("tbResult").textContent = "";
      const n = ps.length;
      $("tbTable").querySelectorAll(".seatx,.token").forEach(x => x.remove());
      ps.forEach((p, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n, el = document.createElement("div");
        el.className = "seatx"; el.id = "seat_" + p.pid; el.style.left = (50 + 41 * Math.cos(a)) + "%"; el.style.top = (50 + 40 * Math.sin(a)) + "%";
        el.innerHTML = `<img alt=""><div class="nm">${esc(p.name)}</div><div class="tag"></div><div class="heat"><i style="width:0"></i></div>`;
        $("tbTable").appendChild(el); });
      $("tbTitle").textContent = m.reason === "body" ? `Who killed ${nameOf(m.body)}?` : "Emergency meeting";
      $("tbSub").textContent = `called by ${nameOf(m.caller)}${m.body_room ? " · body found in " + pretty(m.body_room) : ""}`;
    }
    const secs = Math.max(0, GT - m.ts0), disc = 3.5 + (S.discussion_s || 15), end = disc + (S.voting_s || 90);
    const phase = f.votes ? "RESULT" : secs < disc ? "DISCUSSION" : "VOTING", left = phase === "DISCUSSION" ? disc - secs : end - secs;
    $("tbPhase").className = "pill " + (phase === "DISCUSSION" ? "blue" : phase === "VOTING" ? "amber" : "red");
    $("tbPhase").textContent = phase === "RESULT" ? "VOTES ARE IN" : `${phase} · ${fmt(Math.max(0, left))}`;
    const alive = ps.filter(p => f.alive[p.pid]).length;
    $("tbVoted").textContent = `${f.votes ? alive : (m.voted || []).length}/${alive} VOTED`; $("tbVoted").style.display = phase === "DISCUSSION" ? "none" : "";
    if (idxChanged) {
      const mention = {}; for (const msg of m.msgs) for (const p of ps) if (p.name !== msg.speaker && !msg.ghost && msg.text.toLowerCase().includes(p.name.toLowerCase().replace(/ #\d+$/, ""))) mention[p.pid] = (mention[p.pid] || 0) + 1;
      const mx = Math.max(1, ...Object.values(mention)), typers = f.typers || (f.typing ? [f.typing] : []);
      for (const p of ps) { const el = $("seat_" + p.pid); if (!el) continue; const isAlive = f.alive[p.pid], out = f.votes && m.result && m.result.ejected === p.name;
        el.querySelector("img").src = portrait(p, {dead: !isAlive, glow: TRUTH && roleAt(p.pid, f) === "impostor"});
        el.classList.toggle("dead", !isAlive); el.classList.toggle("speak", f.latest === p.name || typers.includes(p.pid));
        el.classList.toggle("imp", TRUTH && roleAt(p.pid, f) === "impostor"); el.classList.toggle("out", !!out);
        const tag = el.querySelector(".tag"), voted = (m.voted || []).includes(p.pid);
        tag.className = "tag " + (!isAlive ? "dead" : typers.includes(p.pid) ? "typing" : voted && !f.votes ? "voted" : "");
        tag.textContent = !isAlive ? "DEAD" : typers.includes(p.pid) ? "typing…" : voted && !f.votes ? "I VOTED" : p.pid === m.caller ? "called it" : "";
        el.querySelector(".heat i").style.width = (100 * (mention[p.pid] || 0) / mx) + "%"; }
      for (; tbMsgs < m.msgs.length; tbMsgs++) {      // new chat lines
        const msg = m.msgs[tbMsgs], p = ps.find(q => q.name === msg.speaker), d = document.createElement("div");
        d.className = "msg new" + (msg.ghost ? " ghost" : "");
        d.innerHTML = `${img(p, {ghost: msg.ghost})}<div class="b"><b style="color:${colOf(p)}">${esc(msg.speaker)}${msg.ghost ? " · ghost chat" : ""}</b><span>${esc(pretty(msg.text))}</span></div>`;
        $("tbLog").querySelectorAll(".msg.new").forEach(x => x.classList.remove("new")); $("tbLog").appendChild(d); $("tbLog").scrollTop = 1e9; }
      const nm = typers.map(x => nameOf(x)).filter(Boolean);
      $("tbTyping").innerHTML = nm.length ? `<span class="dots"><i></i><i></i><i></i></span>${esc(nm.length > 1 ? nm.slice(0, -1).join(", ") + " and " + nm[nm.length - 1] + " are typing…" : nm[0] + " is typing…")}` : "";
      if (f.votes && m.result && tbVotesShown !== tbMeeting) { tbVotesShown = tbMeeting; flyVotes(m.result); }
    }
  }
  function flyVotes(r) {                              // a token from each voter's seat to their pick (or the skip pile)
    const table = $("tbTable"), rect = table.getBoundingClientRect(), skips = [];
    let k = 0;
    for (const [voter, v] of Object.entries(r.votes || {})) {
      const vp = pByName(voter); if (!vp) continue;
      if (v === "skip") { skips.push(vp); continue; }
      const from = $("seat_" + vp.pid), to = $("seat_" + (pByName(v.replace("vote:", "")) || {}).pid); if (!from || !to) continue;
      const t = document.createElement("img"); t.className = "token"; t.src = portrait(vp);
      t.style.left = from.style.left; t.style.top = from.style.top; table.appendChild(t);
      const off = (k++ % 4) * 9 - 13;
      setTimeout(() => { t.style.left = `calc(${to.style.left} + ${off}px)`; t.style.top = `calc(${to.style.top} - 34px)`; SFX.vote();
        setTimeout(() => { to.classList.remove("hit"); void to.offsetWidth; to.classList.add("hit"); }, 380); }, 120 + k * 160);
    }
    $("tbPile").innerHTML = skips.length ? `SKIPPED<div>${skips.map(p => img(p)).join("")}</div>` : "";
    setTimeout(() => { const ej = r.ejected && $("seat_" + (pByName(r.ejected) || {}).pid); if (ej) ej.classList.add("doom");
      $("tbResult").textContent = r.ejected ? `${r.ejected} is voted out` : r.outcome === "tie" ? "Tie: nobody is voted out" : "Skipped: nobody is voted out"; }, 400 + k * 160);
  }

  // ---------------- results
  async function results(f) {
    if (built.res === runDir) return; built.res = runDir;
    const ps = P(), imp = ps.filter(p => p.role === "impostor"), crewWin = f.winner === "crew";
    const votesFor = {}, tasks = {}, talks = {};
    for (const fr of frames) { for (const e of fr.events || []) if (e.e === "task_step") tasks[e.by] = (tasks[e.by] || 0) + 1;
      if (fr.kind === "eject") { for (const [v, t] of Object.entries(fr.meeting.result.votes || {})) { const tgt = pByName((t || "").replace("vote:", "")); const vp = pByName(v);
        if (vp && tgt && tgt.role === "impostor") votesFor[vp.pid] = (votesFor[vp.pid] || 0) + 1; }
        for (const msg of fr.meeting.msgs) { const sp = pByName(msg.speaker); if (sp && !msg.ghost) talks[sp.pid] = (talks[sp.pid] || 0) + 1; } } }
    const kills = EVENTS.filter(e => e.cls === "kill").length;
    const top = (obj, pool) => pool.slice().sort((a, b) => (obj[b.pid] || 0) - (obj[a.pid] || 0))[0];
    const crew = ps.filter(p => p.role !== "impostor"), det = top(votesFor, crew), work = top(tasks, crew), talk = top(talks, ps);
    const firstKill = EVENTS.find(e => e.cls === "kill"), victim = firstKill && frames[firstKill.i].events.find(x => x.e === "kill");
    const card = (k, p, line) => p ? `<div class="mvp glass">${img(p)}<div class="k">${k}</div><b>${esc(p.name)}</b><small>${line}</small></div>` : "";
    const guess = MODE === "detective" ? (GUESS ? `<p class="sub">Your suspect was <b>${esc(nameOf(GUESS))}</b>: ${imp.some(p => p.pid === GUESS) ? "<b class='win-crew'>you were right</b>" : "<b class='win-impostor'>wrong</b>"}.</p>` : `<p class="sub">You did not mark a suspect.</p>`) : "";
    const hl = [];
    for (const fr of frames) {
      for (const e of fr.events || []) if (e.e === "kill") { const th = THOUGHTS.filter(x => x.pid === e.by && x.tick <= fr.ts + .5).pop();
        hl.push(`<div class="hl"><span class="t">${fmt(fr.ts)}</span><div><b style="color:#ff8a80">${esc(nameOf(e.by))}</b> killed ${esc(nameOf(e.victim))} in ${esc(pretty(e.room))}${th ? `<q>“${esc(pretty(th.thought))}”</q>` : ""}</div></div>`); }
      if (fr.kind === "eject") { const r = fr.meeting.result, il = fr.meeting.msgs.find(x => imp.some(p => p.name === x.speaker));
        hl.push(`<div class="hl"><span class="t">${fmt(fr.ts)}</span><div>${esc(r.text)}${il ? `<q>${esc(il.speaker)} said: “${esc(pretty(il.text))}”</q>` : ""}</div></div>`); }
    }
    const seats = game.seats || {}, cost = Object.values(seats).reduce((a, s) => a + (s.cost_usd || 0), 0);
    const LB = await fetch("/api/leaderboard").then(r => r.json()).catch(() => ({models: {}}));
    const lbRows = Object.entries(LB.models || {}).sort((a, b) => (b[1].games || 0) - (a[1].games || 0)).slice(0, 8).map(([m, s]) =>
      `<tr><td>${esc(s.name || m)}</td><td class="n">${s.games}</td><td class="n">${s.imp_games ? s.imp_wins + "/" + s.imp_games : "–"}</td><td class="n">${s.crew_games ? s.crew_wins + "/" + s.crew_games : "–"}</td><td class="n">${s.kills}</td><td class="n">${s.right_votes}/${s.votes}</td></tr>`).join("");
    $("resultsIn").innerHTML = `
      <div class="kicker">SHIFT OVER · ${fmt(f.ts)}</div>
      <div class="title ${crewWin ? "win-crew" : "win-impostor"}">${crewWin ? "CREW WIN" : f.winner === "impostor" ? (imp.length > 1 ? "THE IMPOSTORS WIN" : "THE IMPOSTOR WINS") : f.winner === "jester" ? "THE JESTER WINS" : "NO WINNER"}</div>
      <p class="sub">${esc(f.reason)} · the impostor was <b>${imp.map(p => esc(p.name)).join(", ")}</b> (${imp.map(p => esc(p.label || p.model)).join(", ")})</p>${guess}
      <div class="mvps">${card("THE IMPOSTOR", imp[0], `${kills} kill${kills === 1 ? "" : "s"} · ${crewWin ? "caught or out-tasked" : "got away with it"}`)}
        ${card("SHARPEST DETECTIVE", det && votesFor[det.pid] ? det : null, `${votesFor[det && det.pid] || 0} vote(s) on the impostor`)}
        ${card("HARDEST WORKER", work, `${tasks[work && work.pid] || 0} task steps`)}
        ${card(victim ? "FIRST BLOOD" : "LOUDEST", victim ? pById(victim.victim) : talk, victim ? "the first one taken out" : `${talks[talk && talk.pid] || 0} messages`)}</div>
      <div class="cols"><div class="panel glass"><h4>HIGHLIGHTS</h4>${hl.join("") || "<p class='fine'>A quiet shift.</p>"}</div>
        <div class="panel glass"><h4>THIS SHIFT · $${cost.toFixed(2)}</h4><table class="lb">${ps.map(p => `<tr><td>${esc(p.name)}</td><td>${p.role === "impostor" ? "<b style='color:#ff8a80'>impostor</b>" : p.role === "jester" ? "<b style='color:#c77dff'>jester</b>" : "crew"}${p.style ? ` <small style="color:var(--muted)">${STYLE_NAMES[p.style] || ""}</small>` : ""}</td><td class="n">${(seats[p.pid] || {}).calls || 0} calls</td><td class="n">$${((seats[p.pid] || {}).cost_usd || 0).toFixed(2)}</td></tr>`).join("")}</table>
        <h4 style="margin-top:12px">LEADERBOARD · ALL SHIFTS</h4><table class="lb"><tr><th>MODEL</th><th>GAMES</th><th>IMP WINS</th><th>CREW WINS</th><th>KILLS</th><th>RIGHT VOTES</th></tr>${lbRows}</table></div></div>
      <div class="lobby-row"><button id="again" class="ibtn" style="width:auto;padding:0 16px">WATCH AGAIN</button><button id="story" class="ibtn" style="width:auto;padding:0 16px">FULL STORY</button>
        <button id="next" class="ibtn" style="width:auto;padding:0 16px;border-color:var(--accent);color:var(--accent)">NEW SHIFT</button></div>`;
    $("again").onclick = () => { built = {}; openRun(runDir, {live: false}); };
    $("story").onclick = () => { drawer(true, "story"); };
    $("next").onclick = () => showLobby(true);
  }

  // ---------------- live HUD
  let idxChanged = false;
  function hud(f, vw) {
    $("livePill").className = "pill" + (CLOCK && CLOCK.live ? " live" : ""); $("livePill").textContent = CLOCK && CLOCK.live ? "LIVE" : "REPLAY";
    $("clock").textContent = fmt(GT);
    const ph = !TURN_TS || GT < TURN_TS ? ["EVERYONE IS CREW", "blue"] : ["HUNT", "red"];
    $("phasePill").className = "pill " + ph[1]; $("phasePill").textContent = ph[0];
    const pct = Math.round((f.task_bar || 0) * 100); $("taskBar").style.width = pct + "%"; $("taskPct").textContent = pct + "%";
    $("modeBadge").textContent = MODE === "detective" ? "DETECTIVE" : "SPECTATOR"; $("modeBadge").className = "pill " + (MODE === "detective" ? "amber" : "");
    const al = $("alert"), sab = f.sabotage;
    if (sab) { al.className = "on " + (sab.kind === "pressure" ? "crit" : "warn"); al.textContent = sab.kind === "pressure" ? `⚠ PRESSURE LEAK · ${Math.max(0, Math.round(sab.left || 0))} s` : sab.kind === "lights" ? "LIGHTS OUT · fix panel in Boiler" : "COMMS DOWN · fix panel in Radio"; }
    else if (f.doors && Object.keys(f.doors).length) { al.className = "on warn"; al.textContent = "DOORS SHUT · " + Object.keys(f.doors).join(", "); } else al.className = "";
    // feed: the last moments
    const items = EVENTS.filter(e => ["kill", "meet", "sab", "turn", "end"].includes(e.cls) && frames[e.i] && frames[e.i].ts <= GT && GT - frames[e.i].ts < 8 && !/^Votes/.test(e.text)).slice(-4);
    const key = items.map(e => e.i + e.cls).join();
    if (key !== feedKeys) { feedKeys = key; $("feed").innerHTML = items.map(e => { const ev = (frames[e.i].events || []).find(x => x.e === "kill");
      const face = ev && TRUTH ? pById(ev.by) : ev ? pById(ev.victim) : null;
      return `<div class="fi glass ${e.cls}">${face ? img(face, {dead: !TRUTH}) : ""}<span>${esc(pretty(e.text))}</span></div>`; }).join(""); }
    // caption: the commentator (never in detective mode: it knows who the impostor is)
    const c = MODE === "spectator" ? latestComment(GT) : null;
    const cap = c ? `<span class="mic">🎙</span>${esc(c.text)}` : "";
    if ($("caption").innerHTML !== cap) $("caption").innerHTML = cap;
    if (c && MODE === "spectator") speak(c);
    if (idxChanged) roster(f);
    pov(f, vw);
  }
  function roster(f) {
    $("roster").innerHTML = P().map(p => { const alive = f.alive && f.alive[p.pid], imp = TRUTH && roleAt(p.pid, f) === "impostor";
      return `<div class="rc ${alive ? "" : "dead"} ${imp ? "imp" : ""} ${view.kind === "pov" && view.pid === p.pid ? "sel" : ""}" data-pid="${p.pid}" title="${esc(p.label || "")}">
        ${img(p, {ghost: !alive})}<span>${esc(p.name)}</span>${GUESS === p.pid ? '<b class="guess">🔍</b>' : ""}</div>`; }).join("");
  }
  function pov(f, vw) {
    const on = view.kind === "pov" && view.pid && f.xy && vw && vw.me;
    $("povhud").classList.toggle("on", !!on); if (!on) return;
    const p = pById(view.pid), imp = roleAt(p.pid, f) === "impostor", done = (TASKDONE[idx] || {})[p.pid] || {};
    if (idxChanged) {
      $("tasks").innerHTML = (imp ? `<h4 class="imp">KILL THE CREW · DON'T GET CAUGHT</h4><div style="color:var(--muted)">Fake tasks:</div>` : "<h4>TASKS</h4>") + p.tasks.map(t => {
        const T = game.map.tasks[t], k = done[t] || 0, fin = k >= T.steps.length;
        return `<div class="${fin && !imp ? "done" : ""}">${esc(fin ? T.steps[T.steps.length - 1][0] : T.steps[k][0])}: ${esc(T.name)}${T.steps.length > 1 ? ` (${Math.min(k, T.steps.length)}/${T.steps.length})` : ""}</div>`; }).join("");
      $("roletag").innerHTML = `${img(p, {ghost: !f.alive[p.pid]})}<span style="color:${imp ? "#ff8a80" : "#9ccaff"}">${esc(p.name)} · ${imp ? "IMPOSTOR" : "CREW"}${f.alive[p.pid] ? "" : " · GHOST"}</span>`;
    }
    const a = f.alive[p.pid] ? avail(f, vw.me) : {};
    const b = (label, on, c, extra = "") => `<div class="act ${on ? "on" : ""}" style="--c:${c}">${label}${extra}</div>`;
    const acts = imp ? [b("KILL", a.kill, "#ff4d4d", a.killIn > 0 ? `<b>${Math.ceil(a.killIn)}</b>` : ""), b("VENT", a.vent, "#f0b429"), b("SABOTAGE", a.sabotage, "#f0883e"), b("REPORT", a.report, "#ff4d4d"), b("USE", a.use, "#e8edf3")]
                     : [b("USE", a.use, "#e8edf3"), b("REPORT", a.report, "#ff4d4d")];
    const html = f.alive[p.pid] ? acts.join("") : ""; if ($("actions").innerHTML !== html) $("actions").innerHTML = html;
    // minimap
    const mm = $("minimap"), dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(mm.clientWidth * dpr);
    if (mm.width !== w) { mm.width = w; mm.height = Math.round(w * LH / LW); }
    const m = mm.getContext("2d"), k = mm.width / LW; m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, mm.width, mm.height); m.setTransform(k, 0, 0, k, 0, 0);
    for (const r of Object.values(game.map.rooms)) { const B = box(r); m.fillStyle = "#2a3442"; m.fillRect(B.x0, B.y0, B.w, B.h); }
    m.fillStyle = colOf(p); m.beginPath(); m.arc(vw.me.x, vw.me.y + 6, 16, 0, 7); m.fill(); m.strokeStyle = "#fff"; m.lineWidth = 4; m.stroke();
    // the private message, and the worker's thought once roles are shown
    const tau = TURN_TS != null ? GT - TURN_TS : -1, wh = imp && tau >= 7 && tau < 11;
    $("whisper").classList.toggle("on", wh);
    if (wh) { const mates = P().filter(q => q.pid !== p.pid && roleAt(q.pid, f) === "impostor").map(q => q.name); $("whisperSub").textContent = mates.length ? `Only you and ${mates.join(", ")} know.` : "Only you know."; }
    const th = TRUTH ? THOUGHTS.filter(x => x.pid === p.pid && x.tick <= GT).pop() : null, showT = th && GT - th.tick < 9;
    $("thought").classList.toggle("on", !!showT); if (showT) $("thought").textContent = "💭 " + pretty(th.thought);
  }

  // ---------------- drawer
  let tab = "players";
  function drawer(on, t) { $("drawer").classList.toggle("on", on); if (t) tab = t; for (const b of $("drawer").querySelectorAll(".tabs button[data-t]")) b.classList.toggle("on", b.dataset.t === tab); fillDrawer(); }
  function fillDrawer() {
    if (!$("drawer").classList.contains("on") || !game || !frames.length) return;
    const f = frames[idx], over = f.kind === "end", secret = !TRUTH && !over;
    let h = "";
    if (tab === "players") h = P().map(p => { const alive = f.alive && f.alive[p.pid], rl = TRUTH || over ? (over ? p.role : roleAt(p.pid, f)) : null;
      return `<div class="pl" data-pid="${p.pid}">${img(p, {ghost: !alive})}<div><b>${esc(p.name)}</b><small>${esc(p.label || p.model)} · ${alive ? esc(pretty(f.pos ? f.pos[p.pid] : "")) : "dead"}</small></div>
        <span class="pill ${rl === "impostor" ? "red" : alive ? "green" : ""}">${rl === "impostor" ? "IMPOSTOR" : alive ? "ALIVE" : "DEAD"}</span></div>`; }).join("");
    else if (tab === "events") h = EVENTS.filter(e => e.i <= idx).slice().reverse().slice(0, 200).map(e => `<div class="ev ${e.cls}"><span class="t">${fmt(e.tick)}</span>${e.who ? `<b>${esc(e.who)}:</b> ` : ""}${esc(pretty(e.text))}</div>`).join("");
    else if (secret) h = `<p class="fine" style="text-align:left">${tab === "minds" ? "What the models are thinking" : "The story"} gives away the impostor. It opens once the audience is told (spectator mode) or when the shift ends.</p>`;
    else if (tab === "minds") { const last = {}; for (const x of THOUGHTS) if (x.tick <= GT) last[x.pid] = x;
      h = P().filter(p => last[p.pid]).map(p => `<div class="mind"><b style="color:${colOf(p)}">${esc(p.name)}</b> <span class="t">${fmt(last[p.pid].tick)}</span><p>${esc(pretty(last[p.pid].thought))}</p></div>`).join(""); }
    else h = EVENTS.filter(e => e.i <= idx && ["kill", "meet", "turn", "sab", "end"].includes(e.cls)).map(e => { const fr = frames[e.i], kill = (fr.events || []).find(x => x.e === "kill");
      const th = kill ? THOUGHTS.filter(x => x.pid === kill.by && x.tick <= fr.ts + .5).pop() : null;
      return `<div class="ev ${e.cls}"><span class="t">${fmt(fr.ts)}</span>${esc(pretty(e.text))}${th ? `<p style="color:#c9d1d9;font-style:italic;margin:3px 0 0">“${esc(pretty(th.thought))}”</p>` : ""}</div>`; }).join("");
    $("pane").innerHTML = h || `<p class="fine">Nothing yet.</p>`;
  }

  // ---------------- view switching + wiring
  function setView(kind, pid = null) {
    if (kind === "pov") { pid = pid || view.pid || (frames.length && P().find(p => frames[idx].alive && frames[idx].alive[p.pid]) || P()[0]).pid; }
    view.kind = kind; view.pid = kind === "pov" ? pid : null; store.set("view", kind); CAM = null; DCAM = null;
    for (const b of $("viewSeg").children) b.classList.toggle("on", b.dataset.v === kind);
    if (frames.length) roster(frames[idx]); lastIdx = -1;
  }
  $("viewSeg").onclick = e => { const b = e.target.closest("button"); if (b) setView(b.dataset.v); };
  $("roster").onclick = e => { const c = e.target.closest(".rc"); if (c) setView("pov", c.dataset.pid); };
  $("roster").oncontextmenu = e => { const c = e.target.closest(".rc"); if (!c || MODE !== "detective") return; e.preventDefault(); GUESS = GUESS === c.dataset.pid ? null : c.dataset.pid; roster(frames[idx]); };
  $("soundBtn").onclick = () => { SOUND = !SOUND; store.set("sound", SOUND); $("soundBtn").textContent = SOUND ? "🔊" : "🔇"; if (SOUND) audio(); };
  $("voiceBtn").onclick = () => { VOICE = !VOICE; store.set("voice", VOICE); $("voiceBtn").classList.toggle("on", VOICE); if (!VOICE && window.speechSynthesis) speechSynthesis.cancel(); };
  $("tvBtn").onclick = () => { document.body.classList.toggle("tv"); $("tvBtn").classList.toggle("on", document.body.classList.contains("tv")); };
  $("drawerBtn").onclick = () => drawer(!$("drawer").classList.contains("on"));
  $("drawerClose").onclick = () => drawer(false);
  $("drawer").querySelector(".tabs").onclick = e => { const b = e.target.closest("button[data-t]"); if (b) drawer(true, b.dataset.t); };
  $("pane").onclick = e => { const r = e.target.closest(".pl"); if (r) setView("pov", r.dataset.pid); };
  $("helpBtn").onclick = () => $("help").classList.toggle("on"); $("help").onclick = e => { if (e.target.id === "help") $("help").classList.remove("on"); };
  $("soundBtn").textContent = SOUND ? "🔊" : "🔇"; $("voiceBtn").classList.toggle("on", VOICE);

  // ---------------- per frame
  function render(f, vw) {
    idxChanged = idx !== lastIdx; lastIdx = idx;
    const tau = TURN_TS != null ? GT - TURN_TS : -1;
    if (f.kind === "start") { show("casting"); casting(f); }
    else if (f.kind === "end") { show("results"); results(f); }
    else if (f.kind === "eject") show("eject");
    else if (f.kind === "meeting") { if (isSplash(f)) { show("splash"); if (idxChanged) splash(f); } else { show("tribunal"); tribunal(f); } }
    else if (tau >= 0 && tau < 7) { show("spin"); spin(tau); }
    else show("live");
    if (screen === "live" || screen === "spin") hud(f, vw);
    if (idxChanged) fillDrawer();
  }
  function flash(kind) { const el = $("flash"); el.className = ""; void el.offsetWidth; el.className = kind; }

  return {view, render, showLobby, setView, flash, drawer,
    onOpen(running) { built = {}; tbMeeting = null; feedKeys = ""; lastIdx = -1; const st = (game && game.settings) || {}; $("shiftName").textContent = [(st.variant || "classic").toUpperCase(), (st.brain || "pure").toUpperCase() + " BRAIN", `${(game && game.players || []).length} SEATS`].join(" · "); if (view.kind === "pov") view.kind = "director"; setView(view.kind); },
    onLiveEnd() {}, get screen() { return screen; }};
})();
