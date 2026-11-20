// static.js: only in the GitHub Pages build. There is no game server there, so the viewer's /api calls are answered
// from static files, and absolute paths ("/runs/...") are made relative to this page. Loaded before core.js.
(() => {
  const real = window.fetch.bind(window);
  const json = obj => Promise.resolve(new Response(JSON.stringify(obj), {headers: {"Content-Type": "application/json"}}));
  const cache = {};
  window.fetch = (url, opt) => {
    const u = String(typeof url === "string" ? url : url.url);
    if (u.startsWith("/api/live")) return json({running: false});
    if (u.startsWith("/api/start")) return json({error: "This is a recording: shifts run on the author's laptop."});
    if (u.startsWith("/api/lineups")) return json({});
    if (u.startsWith("/api/runs")) return json((window.STATIC.shifts || []).map(s => s.run));
    if (u.startsWith("/api/leaderboard")) return real("data/leaderboard.json", opt);
    if (u.startsWith("/api/tail")) {                 // whole file once, then nothing new (a finished shift)
      const q = new URLSearchParams(u.split("?")[1]), path = q.get("path"), from = +q.get("from") || 0;
      cache[path] ||= real("./" + path).then(r => r.ok ? r.text() : "");
      return cache[path].then(t => json({size: t.length, text: from >= t.length ? "" : t.slice(from)}));
    }
    if (u.startsWith("/")) return real("." + u, opt);
    return real(url, opt);
  };
})();
