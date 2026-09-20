export const UI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A2A: Alice & Bob</title>
<style>
  :root {
    --bg:#f7f7f8; --panel:#fff; --ink:#18181b; --muted:#71717a; --line:#e4e4e7;
    --alice:#4f46e5; --bob:#059669; --ui:#d97706;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg:#0b0b0e; --panel:#141418; --ink:#f4f4f5; --muted:#a1a1aa; --line:#27272b;
      --alice:#818cf8; --bob:#34d399; --ui:#fbbf24;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; padding:0 16px 48px; }
  header { max-width:1000px; margin:0 auto; padding:28px 0 6px; }
  h1 { margin:0 0 4px; font-size:22px; letter-spacing:-.02em; }
  .sub { color:var(--muted); font-size:13.5px; }
  main { max-width:1000px; margin:0 auto; }

  .cards { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:18px 0; }
  @media (max-width:640px) { .cards { grid-template-columns:1fr; } }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .card.alice { border-top:3px solid var(--alice); } .card.bob { border-top:3px solid var(--bob); }
  .card h2 { margin:0 0 2px; font-size:16px; display:flex; align-items:center; gap:7px; }
  .dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
  .dot.alice { background:var(--alice); } .dot.bob { background:var(--bob); }
  .url { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; color:var(--muted); margin:2px 0 10px; }
  .desc { font-size:13px; color:var(--muted); margin-bottom:10px; }
  .skill { font-size:12.5px; border-top:1px dashed var(--line); padding-top:6px; margin-top:6px; }
  .skill code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--ink); font-weight:600; }
  .chip { display:inline-block; font-size:10.5px; padding:1px 6px; border-radius:99px; background:var(--bg); border:1px solid var(--line); color:var(--muted); margin:3px 3px 0 0; }
  .offline { color:#dc2626; font-size:12px; }

  .ask { display:flex; gap:8px; margin:18px 0; }
  input[type=text] { flex:1; padding:11px 13px; border-radius:9px; border:1px solid var(--line); background:var(--panel); color:var(--ink); font-size:14px; }
  input[type=text]:focus { outline:2px solid var(--alice); outline-offset:-1px; }
  button { padding:11px 18px; border-radius:9px; border:1px solid var(--alice); background:var(--alice); color:#fff; cursor:pointer; font-size:14px; font-weight:600; }
  button:disabled { opacity:.5; cursor:default; }
  .presets { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 14px; }
  .presets button { background:var(--panel); color:var(--ink); border:1px solid var(--line); font-weight:400; font-size:12.5px; padding:5px 10px; }

  .answer { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:14px; font-size:14px; display:none; }
  .answer.show { display:block; }

  h3 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:22px 0 8px; }
  .timeline { position:relative; padding-left:22px; }
  .timeline::before { content:""; position:absolute; left:6px; top:4px; bottom:4px; width:1px; background:var(--line); }
  .ev { position:relative; padding:0 0 14px; font-size:13.5px; }
  .ev::before { content:""; position:absolute; left:-22px; top:3px; width:9px; height:9px; border-radius:50%; background:var(--line); border:2px solid var(--panel); }
  .ev.alice::before { background:var(--alice); } .ev.bob::before { background:var(--bob); } .ev.ui::before { background:var(--ui); }
  .ev .who { font-weight:700; text-transform:capitalize; }
  .ev.alice .who { color:var(--alice); } .ev.bob .who { color:var(--bob); } .ev.ui .who { color:var(--ui); }
  .ev .kind { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; margin-left:6px; }
  .ev .detail { margin-top:2px; }
  .ev .detail code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; background:var(--bg); padding:1px 4px; border-radius:4px; }
  .empty { color:var(--muted); font-size:13px; padding:10px 0; }
</style>
</head>
<body>
<header>
  <h1>A2A: Alice &amp; Bob</h1>
  <div class="sub">Two agents, two ports. Alice can't do maths; Bob can. Watch her discover him and delegate, live.</div>
</header>
<main>
  <div class="cards" id="cards"></div>

  <div class="presets" id="presets"></div>
  <div class="ask">
    <input type="text" id="q" placeholder="Ask Alice something…" value="What is 12 * 34 + 7?">
    <button id="go">Ask</button>
  </div>
  <div class="answer" id="answer"></div>

  <h3>Live trace</h3>
  <div class="timeline" id="timeline"><div class="empty">Ask a question to see discovery and delegation happen.</div></div>
</main>
<script>
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

async function loadCards() {
  const r = await fetch("/cards"); const d = await r.json();
  document.getElementById("cards").innerHTML = ["alice","bob"].map((who) => {
    const e = d[who];
    if (!e.ok) return '<div class="card ' + who + '"><h2><span class="dot ' + who + '"></span>' + who + '</h2><div class="offline">not reachable at ' + esc(e.base) + '</div></div>';
    const c = e.card;
    const skills = (c.skills||[]).map((s) =>
      '<div class="skill"><code>' + esc(s.id) + '</code> — ' + esc(s.description) + '<div>' +
      (s.tags||[]).map((t) => '<span class="chip">' + esc(t) + '</span>').join("") + '</div></div>').join("");
    return '<div class="card ' + who + '"><h2><span class="dot ' + who + '"></span>' + esc(c.name) + '</h2>' +
      '<div class="url">GET ' + esc(e.base) + '/.well-known/agent-card.json</div>' +
      '<div class="desc">' + esc(c.description) + '</div>' + skills + '</div>';
  }).join("");
}

const PRESETS = ["What is 12 * 34 + 7?", "What is (5 + 3) * 2?", "What is your favorite color?"];
document.getElementById("presets").innerHTML = PRESETS.map((p) => '<button data-q="' + esc(p) + '">' + esc(p) + '</button>').join("");
document.querySelectorAll("#presets button").forEach((b) => b.onclick = () => { document.getElementById("q").value = b.dataset.q; ask(); });

const timeline = document.getElementById("timeline");
function addEvent(e) {
  if (timeline.querySelector(".empty")) timeline.innerHTML = "";
  const row = document.createElement("div");
  row.className = "ev " + (e.actor || "ui");
  row.innerHTML = '<span class="who">' + esc(e.actor) + '</span><span class="kind">' + esc(e.kind) + '</span>' +
    '<div class="detail">' + esc(e.detail) + '</div>';
  timeline.appendChild(row);
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const es = new EventSource("/events");
es.onmessage = (m) => addEvent(JSON.parse(m.data));

const btn = document.getElementById("go");
async function ask() {
  const text = document.getElementById("q").value.trim();
  if (!text) return;
  btn.disabled = true;
  addEvent({ actor: "ui", kind: "sending", detail: 'POST alice /  "' + text + '"' });
  const ans = document.getElementById("answer");
  ans.className = "answer";
  const r = await fetch("/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const d = await r.json();
  ans.className = "answer show";
  ans.textContent = d.error ? "Error: " + d.error.message : (d.result.artifacts?.[0]?.parts?.[0]?.text ?? "(no answer)");
  btn.disabled = false;
}
btn.onclick = ask;
document.getElementById("q").addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });

loadCards();
setInterval(loadCards, 8000);
</script>
</body>
</html>`;
