/** The registry's HTML dashboard. Self-contained: no build step, no CDN, no fonts. */
export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Registry</title>
<style>
  :root {
    --bg:#f7f7f8; --panel:#fff; --ink:#18181b; --muted:#71717a; --line:#e4e4e7;
    --accent:#4f46e5; --local:#059669; --public:#7c3aed; --off:#a1a1aa;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg:#0b0b0e; --panel:#141418; --ink:#f4f4f5; --muted:#a1a1aa; --line:#27272b;
      --accent:#818cf8; --local:#34d399; --public:#c4b5fd; --off:#52525b;
    }
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
    padding:0 16px 64px;
  }
  header { max-width:1100px; margin:0 auto; padding:32px 0 20px; }
  h1 { margin:0 0 4px; font-size:24px; letter-spacing:-.02em; }
  .sub { color:var(--muted); font-size:14px; }
  main { max-width:1100px; margin:0 auto; }

  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin:20px 0; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .stat b { display:block; font-size:26px; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
  .stat span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.05em; }

  .controls { display:flex; gap:8px; flex-wrap:wrap; margin:18px 0; }
  input[type=search] {
    flex:1; min-width:220px; padding:10px 12px; border-radius:9px;
    border:1px solid var(--line); background:var(--panel); color:var(--ink); font-size:14px;
  }
  input[type=search]:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  button {
    padding:10px 14px; border-radius:9px; border:1px solid var(--line);
    background:var(--panel); color:var(--ink); cursor:pointer; font-size:14px;
  }
  button[aria-pressed="true"] { background:var(--accent); border-color:var(--accent); color:#fff; }

  .tags { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:18px; }
  .tags button { padding:4px 10px; font-size:12px; border-radius:99px; }

  .agent {
    background:var(--panel); border:1px solid var(--line); border-radius:11px;
    padding:14px 16px; margin-bottom:9px;
  }
  .row { display:flex; align-items:baseline; gap:9px; flex-wrap:wrap; }
  .name { font-weight:600; letter-spacing:-.01em; }
  .badge {
    font-size:11px; padding:2px 8px; border-radius:99px; font-weight:600;
    text-transform:uppercase; letter-spacing:.04em; border:1px solid currentColor;
  }
  .badge.local { color:var(--local); } .badge.public { color:var(--public); }
  .badge.offline { color:var(--off); }
  .desc { color:var(--muted); font-size:13.5px; margin:5px 0 8px; }
  .host { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; color:var(--muted); }
  .skill { font-size:13px; padding:5px 0 0; border-top:1px dashed var(--line); margin-top:7px; }
  .skill code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:var(--accent); }
  .chip {
    display:inline-block; font-size:11px; padding:1px 7px; border-radius:99px;
    background:var(--bg); border:1px solid var(--line); color:var(--muted); margin:3px 3px 0 0;
  }
  .empty { text-align:center; color:var(--muted); padding:48px 0; }
  .count { color:var(--muted); font-size:12px; margin-bottom:8px; }
  a { color:var(--accent); }
</style>
</head>
<body>
<header>
  <h1>Agent Registry</h1>
  <div class="sub">Your local swarm and agents discovered on the public internet, indexed by capability.</div>
</header>
<main>
  <div class="stats" id="stats"></div>
  <div class="controls">
    <input type="search" id="q" placeholder="Search name, description, skill or tag…" autocomplete="off">
    <button id="f-all"    aria-pressed="true">All</button>
    <button id="f-local"  aria-pressed="false">Local swarm</button>
    <button id="f-public" aria-pressed="false">Public</button>
  </div>
  <div class="tags" id="tags"></div>
  <div id="list"></div>
</main>
<script>
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
let agents = [], filter = "all", query = "", tag = null;
// Rendering 300+ cards at once produced a 200,000px-tall page. Cap it and
// let the user ask for more.
const PAGE = 40;
let shown = PAGE;

async function load() {
  const [a, s] = await Promise.all([
    fetch("/agents?includeOffline=true").then((r) => r.json()),
    fetch("/stats").then((r) => r.json()),
  ]);
  agents = a.results;
  renderStats(s);
  renderTags(s.topTags);
  render();
}

function renderStats(s) {
  document.getElementById("stats").innerHTML = [
    ["Agents", s.total], ["Local swarm", s.local], ["Public", s.public],
    ["Reachable", s.online], ["Skills", s.skills],
  ].map(([label, n]) => '<div class="stat"><b>' + n + "</b><span>" + label + "</span></div>").join("");
}

function renderTags(topTags) {
  document.getElementById("tags").innerHTML = topTags
    .map((t) => '<button data-tag="' + esc(t.tag) + '" aria-pressed="' + (tag === t.tag) + '">' +
                 esc(t.tag) + " · " + t.count + "</button>").join("");
  document.querySelectorAll("#tags button").forEach((b) => {
    b.onclick = () => { tag = tag === b.dataset.tag ? null : b.dataset.tag; shown = PAGE; renderTags(topTags); render(); };
  });
}

function matches(a) {
  if (filter !== "all" && a.source !== filter) return false;
  const skills = a.agent.skills || [];
  if (tag && !skills.some((s) => (s.tags || []).includes(tag))) return false;
  if (!query) return true;
  const hay = (a.name + " " + a.agent.description + " " +
    skills.map((s) => s.id + " " + s.name + " " + s.description + " " + (s.tags || []).join(" ")).join(" ")).toLowerCase();
  return hay.includes(query);
}

function render() {
  const all = agents.filter(matches);
  const list = document.getElementById("list");
  if (!all.length) { list.innerHTML = '<div class="empty">No agents match.</div>'; return; }
  const page = all.slice(0, shown);
  list.innerHTML = '<div class="count">showing ' + page.length + " of " + all.length + " agents</div>" + page.map((a) => {
    let host = a.cardUrl;
    try { host = new URL(a.cardUrl).host; } catch {}
    const skills = (a.agent.skills || []).map((s) =>
      '<div class="skill"><code>' + esc(s.id) + "</code> — " + esc(s.description || s.name) +
      "<div>" + (s.tags || []).map((t) => '<span class="chip">' + esc(t) + "</span>").join("") + "</div></div>").join("");
    return '<div class="agent"><div class="row">' +
      '<span class="name">' + esc(a.agent.name) + "</span>" +
      '<span class="badge ' + a.source + '">' + a.source + "</span>" +
      (a.online ? "" : '<span class="badge offline">unreachable</span>') +
      '<span class="host">' + esc(host) + "</span></div>" +
      '<div class="desc">' + esc(a.agent.description || "(no description)") + "</div>" +
      skills + "</div>";
  }).join("") +
    (all.length > page.length
      ? '<button id="more" style="width:100%;margin-top:8px">Show ' +
        Math.min(PAGE, all.length - page.length) + " more of " + (all.length - page.length) + " remaining</button>"
      : "");
  const more = document.getElementById("more");
  if (more) more.onclick = () => { shown += PAGE; render(); };
}

document.getElementById("q").oninput = (e) => { query = e.target.value.toLowerCase(); shown = PAGE; render(); };
for (const f of ["all", "local", "public"]) {
  document.getElementById("f-" + f).onclick = () => {
    filter = f; shown = PAGE;
    for (const g of ["all", "local", "public"])
      document.getElementById("f-" + g).setAttribute("aria-pressed", String(g === f));
    render();
  };
}
load();
setInterval(load, 10000);
</script>
</body>
</html>`;
