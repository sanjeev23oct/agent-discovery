export const UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A2A: Prod Support</title>
<style>
  :root {
    --bg:#f7f7f8; --panel:#fff; --ink:#18181b; --muted:#71717a; --line:#e4e4e7;
    --commander:#4f46e5; --splunk:#059669; --servicenow:#0ea5e9; --jira:#dc2626;
    --pagerduty:#d97706; --registry:#64748b; --ui:#a855f7;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg:#0b0b0e; --panel:#141418; --ink:#f4f4f5; --muted:#a1a1aa; --line:#27272b;
      --commander:#818cf8; --splunk:#34d399; --servicenow:#38bdf8; --jira:#f87171;
      --pagerduty:#fbbf24; --registry:#94a3b8; --ui:#c084fc;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; padding:0 16px 48px; }
  header { max-width:1080px; margin:0 auto; padding:28px 0 6px; }
  h1 { margin:0 0 4px; font-size:22px; letter-spacing:-.02em; }
  .sub { color:var(--muted); font-size:13.5px; }
  .badge-mock { display:inline-block; font-size:10.5px; padding:1px 7px; border-radius:99px; background:var(--bg); border:1px solid var(--line); color:var(--muted); margin-left:6px; vertical-align:middle; }
  main { max-width:1080px; margin:0 auto; }

  h3 { font-size:12.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:20px 0 8px; }

  .cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:10px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:11px; padding:13px; }
  .card h2 { margin:0 0 2px; font-size:14.5px; display:flex; align-items:center; gap:6px; }
  .dot { width:8px; height:8px; border-radius:50%; display:inline-block; flex-shrink:0; }
  .url { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10.5px; color:var(--muted); margin:2px 0 8px; word-break:break-all; }
  .desc { font-size:12px; color:var(--muted); margin-bottom:8px; }
  .skill { font-size:11.5px; border-top:1px dashed var(--line); padding-top:6px; margin-top:6px; }
  .skill code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--ink); font-weight:600; font-size:11px; }
  .chip { display:inline-block; font-size:10px; padding:1px 6px; border-radius:99px; background:var(--bg); border:1px solid var(--line); color:var(--muted); margin:3px 3px 0 0; }
  .offline { color:#dc2626; font-size:11.5px; }

  .registry { background:var(--panel); border:1px solid var(--line); border-top:3px solid var(--registry); border-radius:11px; padding:13px 16px; }
  .registry .rurl { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:var(--muted); margin-bottom:10px; }
  .rgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:6px 14px; }
  .rtag { font-size:12.5px; }
  .rtag b { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--registry); font-weight:600; }
  .rtag span { color:var(--muted); }

  .ask { display:flex; gap:8px; margin:6px 0 0; }
  input[type=text] { flex:1; padding:11px 13px; border-radius:9px; border:1px solid var(--line); background:var(--panel); color:var(--ink); font-size:14px; }
  input[type=text]:focus { outline:2px solid var(--commander); outline-offset:-1px; }
  button { padding:11px 18px; border-radius:9px; border:1px solid var(--commander); background:var(--commander); color:#fff; cursor:pointer; font-size:14px; font-weight:600; }
  button:disabled { opacity:.5; cursor:default; }
  .presets { display:flex; gap:6px; flex-wrap:wrap; margin:10px 0 0; }
  .presets button { background:var(--panel); color:var(--ink); border:1px solid var(--line); font-weight:400; font-size:12.5px; padding:5px 10px; }

  .answer { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-top:14px; font-size:13.5px; white-space:pre-wrap; display:none; }
  .answer.show { display:block; }

  .timeline { position:relative; padding-left:22px; }
  .timeline::before { content:""; position:absolute; left:6px; top:4px; bottom:4px; width:1px; background:var(--line); }
  .ev { position:relative; padding:0 0 13px; font-size:13px; }
  .ev::before { content:""; position:absolute; left:-22px; top:3px; width:9px; height:9px; border-radius:50%; background:var(--dot, var(--line)); border:2px solid var(--panel); }
  .ev .who { font-weight:700; }
  .ev .kind { color:var(--muted); font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; margin-left:6px; }
  .ev .detail { margin-top:2px; word-break:break-word; }
  .empty { color:var(--muted); font-size:13px; padding:10px 0; }
</style>
</head>
<body>
<header>
  <h1>A2A: Prod Support Agent</h1>
  <div class="sub">Reports an issue in plain English. Discovers Splunk, ServiceNow, Jira and PagerDuty through a registry -- never knows their addresses.<span class="badge-mock">all specialist data is mocked</span></div>
</header>
<main>
  <h3>Agents (each card fetched live from its own /.well-known/agent-card.json)</h3>
  <div class="cards" id="cards"></div>

  <h3>Registry (who is currently discoverable, by tag)</h3>
  <div class="registry" id="registry"></div>

  <h3>Report an issue</h3>
  <div class="presets" id="presets"></div>
  <div class="ask">
    <input type="text" id="q" placeholder="Describe a production issue…" value="Investigate error spike on checkout-service">
    <button id="go">Investigate</button>
  </div>
  <div class="answer" id="answer"></div>

  <h3>Live trace</h3>
  <div class="timeline" id="timeline"><div class="empty">Report an issue to see discovery and delegation happen.</div></div>
</main>
<script>
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const COLOR = { commander:"var(--commander)", splunk:"var(--splunk)", servicenow:"var(--servicenow)",
  jira:"var(--jira)", pagerduty:"var(--pagerduty)", "prod-support":"var(--commander)",
  registry:"var(--registry)", ui:"var(--ui)" };
const colorFor = (actor) => COLOR[actor] || COLOR[(actor||"").replace(/ \(mock\)$/,"")] || "var(--muted)";

async function loadCards() {
  let d;
  try {
    const r = await fetch("/cards");
    d = await r.json();
  } catch (err) {
    // Leave whatever was last rendered rather than blanking the panel on one
    // transient failure (e.g. the dashboard server mid-restart).
    return;
  }
  document.getElementById("cards").innerHTML = d.agents.map((e) => {
    const col = colorFor(e.key);
    if (!e.ok) return '<div class="card" style="border-top:3px solid ' + col + '"><h2><span class="dot" style="background:' + col + '"></span>' + esc(e.key) + '</h2><div class="offline">not reachable at ' + esc(e.base) + '</div></div>';
    const c = e.card;
    const skills = (c.skills||[]).map((s) =>
      '<div class="skill"><code>' + esc(s.id) + '</code> — ' + esc(s.description) + '<div>' +
      (s.tags||[]).map((t) => '<span class="chip">' + esc(t) + '</span>').join("") + '</div></div>').join("");
    return '<div class="card" style="border-top:3px solid ' + col + '"><h2><span class="dot" style="background:' + col + '"></span>' + esc(c.name) + '</h2>' +
      '<div class="url">' + esc(e.base) + '</div>' +
      '<div class="desc">' + esc(c.description) + '</div>' + skills + '</div>';
  }).join("");
}

async function loadRegistry() {
  let d;
  try {
    const r = await fetch("/registry");
    d = await r.json();
  } catch (err) {
    return; // same reasoning as loadCards(): keep the last good render
  }
  const box = document.getElementById("registry");
  if (!d.ok) { box.innerHTML = '<div class="offline">registry not reachable at ' + esc(d.url) + '</div>'; return; }
  const tags = Object.entries(d.index || {}).sort((a,b) => a[0].localeCompare(b[0]));
  box.innerHTML = '<div class="rurl">GET ' + esc(d.url) + '/index  —  ' + d.agents + ' agent(s) registered</div>' +
    '<div class="rgrid">' + tags.map(([tag, agents]) =>
      '<div class="rtag"><b>' + esc(tag) + '</b><br><span>' + agents.map(esc).join(", ") + '</span></div>').join("") + '</div>';
}

const PRESETS = ["Investigate error spike on checkout-service", "Check payment-service for anomalies", "Check auth-service health"];
document.getElementById("presets").innerHTML = PRESETS.map((p) => '<button data-q="' + esc(p) + '">' + esc(p) + '</button>').join("");
document.querySelectorAll("#presets button").forEach((b) => b.onclick = () => { document.getElementById("q").value = b.dataset.q; ask(); });

const timeline = document.getElementById("timeline");
function addEvent(e) {
  if (timeline.querySelector(".empty")) timeline.innerHTML = "";
  const col = colorFor(e.actor);
  const row = document.createElement("div");
  row.className = "ev";
  row.style.setProperty("--dot", col);
  row.innerHTML = '<span class="who" style="color:' + col + '">' + esc(e.actor) + '</span><span class="kind">' + esc(e.kind) + '</span>' +
    '<div class="detail">' + esc(e.detail) + '</div>';
  timeline.appendChild(row);
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * Events arrive over independent HTTP connections from up to six different
 * processes, so *receipt order at this browser* is not the same thing as
 * *true program order*. A specialist's own "received"/"answered" trace can
 * physically land here after the caller's NEXT step, even though the caller
 * awaited that specialist's actual protocol response before taking that
 * step -- the trace POST and the protocol response are two unrelated races.
 *
 * Every trace event already carries "at", a timestamp taken synchronously
 * at the moment it genuinely happened, in-process. All agents run on this
 * one machine, so there is no clock skew to worry about across them. So:
 * buffer arrivals for a short window, then flush in "at" order. This adds
 * an imperceptible ~120ms of latency to the live view in exchange for a
 * timeline that is actually causally correct, not just arrival-ordered.
 */
let buffer = [];
let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    buffer.sort((a, b) => a.at - b.at);
    for (const e of buffer) addEvent(e);
    buffer = [];
    flushTimer = null;
  }, 120);
}

const es = new EventSource("/events");
es.onmessage = (m) => { buffer.push(JSON.parse(m.data)); scheduleFlush(); };

const btn = document.getElementById("go");
async function ask() {
  const text = document.getElementById("q").value.trim();
  if (!text) return;
  btn.disabled = true;
  btn.textContent = "Investigating…";
  addEvent({ actor: "ui", kind: "sending", detail: 'POST prod-support /  "' + text + '"' });
  const ans = document.getElementById("answer");
  ans.className = "answer";
  // A hung fetch() with no explicit timeout is exactly what "stuck on
  // Investigating" looks like -- neither success nor failure ever fires, so
  // the finally block below never runs either. Bound it so the UI always
  // recovers within a fixed window even if the server or network wedges.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch("/ask", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }), signal: controller.signal,
    });
    const d = await r.json();
    ans.className = "answer show";
    ans.textContent = d.error ? "Error: " + d.error.message : (d.result?.artifacts?.[0]?.parts?.[0]?.text ?? "(no answer)");
    loadRegistry();
  } catch (err) {
    // Whatever went wrong -- network drop, server restart, a bad JSON body --
    // surface it instead of leaving the button disabled with no explanation.
    ans.className = "answer show";
    ans.textContent = "Request failed: " + (err && err.name === "AbortError" ? "timed out after 25s" : String(err && err.message || err));
  } finally {
    clearTimeout(timeout);
    btn.disabled = false;
    btn.textContent = "Investigate";
  }
}
btn.onclick = ask;
document.getElementById("q").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });

loadCards();
loadRegistry();
setInterval(loadCards, 8000);
setInterval(loadRegistry, 8000);
</script>
</body>
</html>`;
