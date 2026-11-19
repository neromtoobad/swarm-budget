// Swarm Budget front end. Everything shown comes from the server: /api/state for history, /api/stream for live events.
import { createScene, machineThumb } from "/scene.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (v) => (v == null || Number.isNaN(Number(v)) ? "?" : String(Math.round(Number(v) * 10) / 10));
const sleep = (ms) => (document.hidden ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const desktop = () => innerWidth > 1020;

const ROLE = { kite: "Spray drone", lark: "Scout drone", mule: "Field rover", haul: "Delivery truck", ledger: "Auditor" };
const INTENT = {
  STORM_ALERT_GENERAL: "Storm alert", WEATHER_FORECAST_GENERAL: "Rain forecast", GRID_POWER_PRICE_GENERAL: "Power price",
  ROUTE_ETA_GENERAL: "Drive time", SATELLITE_IMAGERY_ANALYSIS_GENERAL: "Satellite read", WEATHER_FORECAST_VERIFY_GENERAL: "Yesterday's weather",
  TASK_EXECUTION_QUALITY_GENERAL: "Decision audit", WEATHER_CHECK_TEMPERATURE: "Temperature",
};
const ASK = {
  STORM_ALERT_GENERAL: "Is a storm or strong wind coming?", WEATHER_FORECAST_GENERAL: "How likely is rain in the next 6 hours?",
  GRID_POWER_PRICE_GENERAL: "What does power cost this hour?", ROUTE_ETA_GENERAL: "How long is the drive to the packhouse?",
  SATELLITE_IMAGERY_ANALYSIS_GENERAL: "Is there standing water in the fields?", WEATHER_FORECAST_VERIFY_GENERAL: "What did the weather do yesterday?",
  TASK_EXECUTION_QUALITY_GENERAL: "Was yesterday's spray call right?",
};
const OUT = { act: "Acted", hold: "Held", unverified: "Stayed put" };
const BREAK = {
  mule: "Send the first purchase to an Estonian grid miner that answered for a California node before",
  lark: "Send the first purchase to a satellite miner that answered for the wrong place before",
};
const ICON = {
  ok: '<svg viewBox="0 0 16 16"><path d="M3.5 8.6l3 3 6-7.2"/></svg>',
  no: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  ext: '<svg viewBox="0 0 16 16"><path d="M6 3.5h6.5V10M12.5 3.5L4 12"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.2v9.6l7.8-4.8z" fill="currentColor" stroke="none"/></svg>',
};

let state, scene, NODE = "https://devnode.telegraphprotocol.com", selected = null;
const THUMB = {}, tags = {}, units = {}, tagState = {};
const nameOf = (id) => state.machines.find((m) => m.id === id)?.name ?? id;
const isHome = (farm) => farm === state.farm.id;

// ───────── formatting
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 50) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const short = (h, n = 10) => `${String(h).slice(0, n)}…`;
function said(p) {
  const r = p.result;
  if (p.status !== 200 || !r) return `No answer: ${noAnswer(p)}`;
  const place = typeof r.location === "string" && /[a-z]/i.test(r.location) ? ` for ${r.location}` : "";
  switch (p.intent) {
    case "STORM_ALERT_GENERAL": return `Gusts up to ${num(r.peak_gust_kmh)} km/h, risk ${String(r.risk_level ?? "?").toLowerCase()}${place}`;
    case "WEATHER_FORECAST_GENERAL": return `${num(r.precipitation_probability_pct)}% chance of rain${place}`;
    case "GRID_POWER_PRICE_GENERAL": return r.lmp_usd_per_mwh != null ? `$${Number(r.lmp_usd_per_mwh).toFixed(2)} per MWh${r.node_or_zone ? ` at ${r.node_or_zone}` : ", with no node named"}` : "A price with no number in it";
    case "ROUTE_ETA_GENERAL": return r.duration != null ? `${Math.round(r.duration / 60)} minutes by road` : "No drive time in the answer";
    case "SATELLITE_IMAGERY_ANALYSIS_GENERAL": return clip(r.brief || r.summary || "No reading in the answer", 130);
    case "WEATHER_FORECAST_VERIFY_GENERAL": return `${num(r.precipitation_mm)} mm of rain, high of ${num(r.temp_max_c)} °C`;
    case "TASK_EXECUTION_QUALITY_GENERAL": return clip(`${r.verdict ?? ""}. ${r.reason ?? ""}`.replace(/^\. /, "") || "No verdict in the answer", 130);
  }
  return "An answer came back";
}
const whyOf = (p) => {
  const fails = (p.checks || []).filter((c) => !c.pass).map((c) => c.why);
  return p.verdict === "accepted" ? (p.checks || []).map((c) => c.why).join(" · ") : fails.join(" · ") || "no usable answer";
};
const noAnswer = (p) => {
  const e = p.result?.error ? String(p.result.error).replace(/_/g, " ") : "";
  return p.status ? `the node returned ${p.status}${e ? ` (${e})` : ""}` : e || "the request timed out";
};
function countTo(el, to, fmt = (v) => String(Math.round(v))) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = to;
  if (from === to || reduced || document.hidden) return void (el.textContent = fmt(to));
  let t0;
  const step = (now) => {
    t0 ??= now;
    const k = Math.max(0, Math.min(1, (now - t0) / 800));
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ───────── ledger
function buyRow(p) {
  const li = document.createElement("li");
  li.className = `by ${p.verdict}`;
  const route = p.attempt > 1 ? `<em>asked again</em>` : p.routed === "direct" ? `<em>sent direct</em>` : "";
  const proof = [
    p.signal_hash ? `<a href="${NODE}/engine/v1/signal/${encodeURIComponent(p.signal_hash)}" target="_blank" rel="noopener" title="Open this answer's record on the Telegraph node">signal ${esc(short(p.signal_hash))}${ICON.ext}</a>` : "",
    p.receipt_hash ? `<span title="Escrow receipt ${esc(p.receipt_hash)}">receipt ${esc(short(p.receipt_hash))}</span>` : "",
    p.epoch_id != null ? `<span>epoch ${esc(p.epoch_id)}</span>` : "",
  ].join("");
  li.innerHTML = `<span class="mk">${p.verdict === "accepted" ? ICON.ok : ICON.no}</span>
    <div class="by-main"><b>${esc(INTENT[p.intent] ?? p.intent)}</b> <span>${p.miner_name ? `from ${esc(p.miner_name)}` : "no miner answered"}</span>${route}</div>
    <span class="by-cost">${p.cost_usd ? usd(p.cost_usd) : "no charge"}</span>
    <div class="by-why">${p.verdict === "accepted" ? esc(said(p)) : p.verdict === "failed" ? `No answer: ${esc(noAnswer(p))}` : `Refused: ${esc(whyOf(p))}`}</div>
    ${proof ? `<div class="by-proof">${proof}</div>` : ""}`;
  return li;
}
function receipt(d) {
  const li = document.createElement("li");
  const ps = d.purchases || [];
  const refused = ps.filter((p) => p.verdict !== "accepted").length;
  li.className = `rc ${d.outcome ?? "thinking"}${refused ? " has-refusal" : ""}`;
  if (d.id) li.dataset.id = d.id;
  const where = d.farm && state && !isHome(d.farm) ? `<span class="where">${esc(d.farm.replace(/-/g, " "))}</span>` : "";
  li.innerHTML = `<div class="rc-head"><img src="${THUMB[d.machine] ?? ""}" alt="" /><b>${esc(nameOf(d.machine))}</b>
      <span class="chip ${d.outcome ?? "thinking"}">${d.outcome ? OUT[d.outcome] : "Buying answers"}</span>${where}
      <time ${d.at ? `datetime="${esc(d.at)}"` : ""}>${d.at ? ago(d.at) : ""}</time></div>
    <p class="rc-sum">${esc(d.summary ?? "")}</p><ul class="rc-buys"></ul><div class="rc-foot"></div>`;
  const ul = $(".rc-buys", li);
  ps.forEach((p) => ul.appendChild(buyRow(p)));
  if (d.outcome) {
    const how = { visitor: "run by a visitor", "break-a-miner": "bad-miner test", "try-your-farm": "visitor's farm", auto: "on its own schedule" }[d.trigger] ?? "";
    const got = ps.filter((p) => p.status === 200).length, rej = ps.filter((p) => p.verdict === "rejected").length, none = ps.length - got;
    const bits = [got ? `Paid ${usd(d.cost_usd)} for ${got} answer${got === 1 ? "" : "s"}` : "Nothing paid", rej ? `${rej} refused` : "", none ? `${none} ask${none === 1 ? "" : "s"} got no answer` : ""].filter(Boolean);
    $(".rc-foot", li).innerHTML = `<span>${bits.join(", ")}</span><span>${how}</span>`;
  }
  return li;
}
function renderFeed() {
  const feed = $("#feed");
  feed.replaceChildren(...state.decisions.map(receipt));
  if (!state.decisions.length) feed.innerHTML = `<li class="feed-empty">No decisions yet. Pick a machine and run it.</li>`;
}
function renderStats() {
  const t = state.totals, b = state.budget;
  countTo($("#s-spent"), b.spent_today_usd, (v) => usd(v));
  $("#s-cap").textContent = `of ${usd(b.daily_usd)}`;
  $("#s-bar").style.width = `${Math.min(100, (b.spent_today_usd / b.daily_usd) * 100)}%`;
  countTo($("#s-bought"), t.answered ?? 0);
  countTo($("#s-junk"), t.rejected ?? 0);
  countTo($("#s-rebuys"), t.rebuys ?? 0);
}
function setBusy(label) {
  const b = $("#busy");
  b.hidden = !label;
  b.textContent = label ? `${label} is buying` : "";
}

// ───────── dock and tags
function renderDock() {
  $("#dock").replaceChildren(...state.machines.map((m, i) => {
    const el = document.createElement("article");
    el.className = "unit";
    el.dataset.id = m.id;
    el.style.animationDelay = `${0.25 + i * 0.07}s`;
    el.innerHTML = `<i class="state"></i>
      <div class="unit-top"><img src="${THUMB[m.id]}" alt="" /><div><h3>${esc(m.name)}</h3><small>${ROLE[m.id] ?? ""}</small></div></div>
      <p class="unit-say job">${esc(m.job)}</p>
      <div class="unit-btns"><button class="btn" data-run="${m.id}">${ICON.play}Run now</button>${BREAK[m.id] ? `<button class="btn quiet" data-break="${m.id}" title="${esc(BREAK[m.id])}">Bad miner</button>` : ""}</div>`;
    units[m.id] = el;
    return el;
  }));
}
function setUnit(id, cls, text) {
  const el = units[id];
  if (!el) return;
  el.className = `unit ${cls}${selected === id ? " sel" : ""}`;
  if (text != null) {
    const p = $(".unit-say", el);
    p.textContent = text;
    p.classList.toggle("job", cls === "idle");
  }
}
function makeTag(m) {
  const el = document.createElement("div");
  el.innerHTML = `<div class="tag-in"><i class="dot"></i><span>${esc(m.name)}</span><span class="st"></span></div><div class="insp"></div>`;
  el.addEventListener("click", () => select(m.id));
  $("#tags").appendChild(el);
  tags[m.id] = el;
  tagState[m.id] = { cls: "idle", text: "", open: false };
  paintTag(m.id);
}
function paintTag(id) {
  const s = tagState[id], el = tags[id];
  el.className = `tag ${s.cls}${selected === id ? " sel" : ""}${s.open ? " open" : ""}`;
  $(".st", el).textContent = s.text;
}
function setTag(id, patch) {
  Object.assign(tagState[id], patch);
  paintTag(id);
}
// The camera goes to the machine the visitor picked, else to the one that is deciding, else back to the whole farm.
function aim() {
  const id = selected ?? auto;
  scene.focus(id);
  $(".hero").classList.toggle("zoom", Boolean(id));
  $("#whole").hidden = !selected;
}
function select(id) {
  selected = selected === id ? null : id;
  for (const k of Object.keys(tags)) { paintTag(k); units[k]?.classList.toggle("sel", selected === k); }
  aim();
}

// ───────── the inspection card over a machine
let waitTimer;
function inspClose(id) {
  clearInterval(waitTimer);
  setTag(id, { open: false });
  $("#tags").classList.remove("solo");
}
function inspAsk(id, a) {
  setTag(id, { open: true });
  $("#tags").classList.add("solo");
  clearInterval(waitTimer);
  const t0 = Date.now();
  // real seconds since the request left; some miners take most of a minute
  waitTimer = setInterval(() => { const w = $(".insp .wait", tags[id]); if (w) w.textContent = `${Math.round((Date.now() - t0) / 1000)} s`; }, 1000);
  $(".insp", tags[id]).innerHTML = `<div class="insp-top"><b>${esc(nameOf(id))}</b><span>${a.attempt > 1 ? `asks again, try ${a.attempt} of 3` : "pays to ask"}</span><em class="wait"></em></div>
    <div class="insp-q">${esc(ASK[a.intent] ?? INTENT[a.intent] ?? a.intent)}</div>
    <div class="insp-from">${a.routed === "direct" ? `Sent to ${esc(a.miner_name ?? "a different miner")}` : "Telegraph picks the miner"}<span class="dots"><i></i><i></i><i></i></span></div>`;
}
async function inspAnswer(id, p) {
  if (!tagState[id].open) inspAsk(id, p);
  clearInterval(waitTimer);
  const box = $(".insp", tags[id]);
  $(".insp-top span", box).textContent = p.status === 200 ? "got an answer" : "got nothing back";
  $(".wait", box).textContent = p.cost_usd ? `paid ${usd(p.cost_usd)}` : "no charge";
  $(".insp-from", box).textContent = p.miner_name ? `Answered by ${p.miner_name}` : "No miner answered";
  box.insertAdjacentHTML("beforeend", `<div class="insp-said">${esc(said(p))}</div><ul class="insp-checks"></ul>`);
  const ul = $(".insp-checks", box);
  for (const c of p.checks || []) {
    await sleep(240);
    ul.insertAdjacentHTML("beforeend", `<li class="${c.pass ? "pass" : "fail"}">${c.pass ? ICON.ok : ICON.no}<span>${esc(cap(p.verdict === "failed" ? "Nothing to check" : c.why))}</span></li>`);
  }
  await sleep(280);
  box.insertAdjacentHTML("beforeend", `<div class="insp-end"><span class="stamp ${p.verdict}">${p.verdict === "accepted" ? "Accepted" : p.verdict === "failed" ? "No answer" : "Refused"}</span></div>`);
  await sleep(1500);
}

// ───────── sections below the fold
function renderGuard() {
  const t = state.totals;
  countTo($("#g-refused"), t.rejected ?? 0);
  $("#g-total").textContent = t.answered ?? 0;
  $("#g-bars").innerHTML = state.junk.map((j) => `<li><span>${esc(INTENT[j.intent] ?? j.intent)}</span><small>${j.junk} of ${j.bought} refused</small>
      <div class="track"><i data-w="${(j.junk / j.bought) * 100}"></i></div></li>`).join("") || `<li>No answers bought yet.</li>`;
  requestAnimationFrame(() => $$("#g-bars i").forEach((i) => (i.style.width = `${i.dataset.w}%`)));
  $("#g-list").innerHTML = state.refusals.map((r, i) => `<li class="rf reveal in" style="--d:${i * 0.05}s"><span class="x">${ICON.no}</span>
      <p>${esc(cap(r.checks.filter((c) => !c.pass).map((c) => c.why).join(". ")))}</p>
      <div class="meta"><span>${esc(INTENT[r.intent] ?? r.intent)} for ${esc(nameOf(r.machine))}</span><span>from ${esc(r.miner_name ?? "unknown miner")}</span><span>${ago(r.at)}</span>
      ${r.signal_hash ? `<a href="${NODE}/engine/v1/signal/${encodeURIComponent(r.signal_hash)}" target="_blank" rel="noopener">signal ${esc(short(r.signal_hash))}${ICON.ext}</a>` : ""}</div></li>`).join("")
    || `<li class="rf-empty">Nothing refused yet. Run Mule with "Bad miner" to see a refusal happen.</li>`;
  $("#g-board").innerHTML = state.miners.map((m) => {
    const pips = "<i></i>".repeat(Math.min(m.accepted, 14)) + '<i class="r"></i>'.repeat(Math.min(m.rejected, 14)) + '<i class="f"></i>'.repeat(Math.min(m.failed, 14));
    // same rule the buyer uses to skip a miner: never accepted, refused twice or more
    const cut = m.accepted === 0 && m.rejected >= 2;
    const verdict = cut ? "no longer bought from" : [`${m.accepted} accepted`, m.rejected ? `${m.rejected} refused` : "", m.failed ? `${m.failed} failed` : ""].filter(Boolean).join(" · ");
    return `<div class="brow"><span class="intent">${esc(INTENT[m.intent] ?? m.intent)}</span><span class="who">${esc(m.miner_name ?? "unnamed")}<small>#${esc(m.miner_id)}</small></span>
      <span class="pips">${pips}</span><span class="verdict${cut ? " cut" : ""}">${verdict}</span></div>`;
  }).join("") || `<div class="brow"><span class="intent">No purchases yet</span></div>`;
}
function renderSteps() {
  const ex = state.decisions.find((d) => d.purchases.some((p) => p.verdict === "rejected") && d.purchases.some((p) => p.verdict === "accepted")) ?? state.decisions.find((d) => d.purchases.length);
  const bad = ex?.purchases.find((p) => p.verdict === "rejected"), good = ex?.purchases.find((p) => p.verdict === "accepted"), first = ex?.purchases[0];
  const eg = (label, body, cls = "") => (ex ? `<div class="eg ${cls}"><small>${label}</small>${body}</div>` : "");
  const steps = [
    ["Ask", "The machine asks Telegraph one question. Telegraph routes it to its top-ranked miner for that kind of answer.",
      first && eg(`${esc(nameOf(ex.machine))} asked`, esc(ASK[first.intent] ?? first.intent))],
    ["Pay", "It pays about one cent from the shared escrow balance and keeps the signed receipt.",
      first && eg("Receipt", `${usd(first.cost_usd)} · <span class="mono">${esc(short(first.receipt_hash ?? "none", 14))}</span>${first.epoch_id != null ? ` · epoch ${esc(first.epoch_id)}` : ""}`)],
    ["Check", "The guard compares the answer with the question: the place, the market, the hour and the units.",
      bad ? eg(`Refused, from ${esc(bad.miner_name ?? "a miner")}`, esc(cap(whyOf(bad))), "bad") : good && eg(`Accepted, from ${esc(good.miner_name ?? "a miner")}`, esc(cap(whyOf(good))))],
    ["Act, or buy again", "A pass lets the machine act. A fail sends the same question to another miner, up to two more times.",
      ex && eg(`${esc(nameOf(ex.machine))}: ${OUT[ex.outcome].toLowerCase()}`, esc(ex.summary))],
  ];
  $("#steps").innerHTML = steps.map(([h, p, e], i) => `<li class="step reveal in${i === 0 ? " on" : ""}" style="--d:${i * 0.06}s"><h3>${h}</h3><p>${p}</p>${e || ""}</li>`).join("");
  $("#how-sub").textContent = ex ? `The same four steps, every time. The example in each card is a real decision ${nameOf(ex.machine)} made ${ago(ex.at)}.` : "The same four steps, every time.";
}
async function renderVerify() {
  const sig = state.decisions.flatMap((d) => d.purchases).find((p) => p.signal_hash);
  $("#v-signal").textContent = sig?.signal_hash ?? "No purchases yet";
  if (sig) $("#v-signal-link").href = `${NODE}/engine/v1/signal/${sig.signal_hash}`;
  $("#v-ledger-link").href = `${NODE}/v1/ledger/account/${state.payer.toLowerCase()}`;
  $("#v-origin").textContent = location.origin;
  $("#payer").textContent = state.payer;
  $("#node-link").href = `${NODE}/engine/v1/intents`;
  $("#node-link").textContent = new URL(NODE).host;
  const l = await fetch("/api/ledger").then((r) => r.json()).catch(() => null);
  if (!l || l.error) return;
  const u = (v) => usd(Number(v || 0) / 1e6);
  const spent = Number(l.charged || 0) + Number(l.unbilled || 0);
  $("#v-ledger").innerHTML = `<div><dt>Deposited</dt><dd>${u(l.deposited)}</dd></div><div><dt>Spent</dt><dd>${u(spent)}</dd></div><div><dt>Left</dt><dd>${u(l.available)}</dd></div>`;
}

// ───────── actions
function toast(msg) {
  const el = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 5200);
}
async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Something went wrong (HTTP ${r.status})`);
  return j;
}
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-run],button[data-break]");
  if (btn) {
    e.stopPropagation();
    const id = btn.dataset.run || btn.dataset.break;
    const row = $$("button", btn.parentElement);
    row.forEach((b) => (b.disabled = true));
    try { await post("/api/decide", { machine: id, breakMiner: Boolean(btn.dataset.break) }); } catch (err) { toast(err.message); }
    row.forEach((b) => (b.disabled = false));
    return;
  }
  const unit = e.target.closest(".unit");
  if (unit) return select(unit.dataset.id);
  const seg = e.target.closest(".seg button");
  if (seg) {
    $$(".seg button").forEach((b) => b.classList.toggle("on", b === seg));
    $("#feed").classList.toggle("only-refused", seg.dataset.filter === "refused");
  }
});
$("#whole").addEventListener("click", () => selected && select(selected));
$("#feed-more").addEventListener("click", (e) => { $("#feed").classList.remove("short"); e.target.hidden = true; });
addEventListener("keydown", (e) => e.key === "Escape" && selected && select(selected));

let trying = false, auto = null;
const tryRow = (machine) => {
  let li = $(`#try-out [data-m="${machine}"]`);
  if (!li) {
    li = document.createElement("li");
    li.className = "tr";
    li.dataset.m = machine;
    $("#try-out").appendChild(li);
  }
  return li;
};
const fillTry = (d) => {
  tryRow(d.machine).innerHTML = `<img src="${THUMB[d.machine]}" alt="" /><b>${esc(nameOf(d.machine))}</b><span class="chip ${d.outcome ?? "thinking"}">${d.outcome ? OUT[d.outcome] : "Buying answers"}</span><p>${esc(d.summary ?? "")}</p>`;
};
$("#try-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), btn = $("button", e.target);
  btn.disabled = true;
  btn.textContent = "Four machines are deciding…";
  $("#try-out").replaceChildren();
  trying = true;
  try {
    const r = await post("/api/try", { farm: f.get("farm"), packhouse: f.get("packhouse") });
    $("#try-out").replaceChildren();
    r.decisions.forEach(fillTry);
    toast(`Done for ${r.farm.label}. The full receipts are in the ledger.`);
  } catch (err) {
    $("#try-out").innerHTML = `<li class="try-empty">${esc(err.message)}</li>`;
  }
  trying = false;
  btn.disabled = false;
  btn.textContent = "Run the fleet there";
});

// ───────── live stream. Events for one machine are played in order, so the page can take its time showing each.
const chains = {}, live = new Map();
const enqueue = (key, fn) => (chains[key] = (chains[key] ?? Promise.resolve()).then(fn).catch((err) => console.error(err)));
function liveCard(machine, farm) {
  if (live.has(machine)) return live.get(machine);
  const card = receipt({ machine, farm, purchases: [] });
  $(".feed-empty")?.remove();
  $("#feed").prepend(card);
  live.set(machine, card);
  return card;
}
async function refresh() {
  const s = await fetch("/api/state?limit=30").then((r) => r.json());
  state = { ...state, ...s };
  renderStats();
  renderGuard();
  renderSteps();
  renderVerify();
}
function onEvent(ev) {
  if (ev.type === "hello") return setBusy(ev.busy ? nameOf(String(ev.busy).split(" ")[0].toLowerCase()) : null);
  const id = ev.machine ?? ev.purchase?.machine ?? ev.decision?.machine;
  const farm = ev.farm ?? ev.purchase?.farm ?? ev.decision?.farm;
  const home = isHome(farm);
  enqueue(id, async () => {
    if (ev.type === "thinking") {
      setBusy(nameOf(id));
      liveCard(id, farm);
      if (!home) return void (trying && fillTry({ machine: id }));
      setUnit(id, "thinking", "Buying the answers it needs…");
      setTag(id, { cls: "thinking", text: "buying answers" });
      scene.setMode(id, "thinking");
      auto = id; // the camera follows the machine that is deciding
      aim();
    }
    if (ev.type === "asking" && home) {
      inspAsk(id, ev);
      scene.request(id);
      await sleep(350);
    }
    if (ev.type === "purchase") {
      const p = ev.purchase;
      if (home) await Promise.race([scene.deliver(id, p.verdict), sleep(1500)]);
      const card = liveCard(id, farm);
      $(".rc-buys", card).appendChild(buyRow(p));
      fetch("/api/state?limit=1").then((r) => r.json()).then((s) => { state.budget = s.budget; state.totals = s.totals; renderStats(); }).catch(() => {});
      if (p.verdict !== "accepted") card.classList.add("has-refusal");
      if (home) await inspAnswer(id, p);
    }
    if (ev.type === "decision") {
      const d = ev.decision, fresh = receipt(d), card = live.get(id);
      if (card) { fresh.classList.add("swap"); card.replaceWith(fresh); } else $("#feed").prepend(fresh);
      live.delete(id);
      setBusy(null);
      state.decisions = [d, ...state.decisions.filter((x) => x.id !== d.id)];
      if (home) {
        inspClose(id);
        setTag(id, { cls: d.outcome, text: OUT[d.outcome].toLowerCase() });
        if (auto === id) setTimeout(() => { if (auto === id) { auto = null; aim(); } }, 1200);
        setUnit(id, d.outcome, d.summary);
        scene.setMode(id, d.outcome);
      } else if (trying) fillTry(d);
      await refresh();
    }
  });
}
function connect() {
  const es = new EventSource("/api/stream");
  es.onopen = () => { $("#live").classList.remove("off"); $("#live span").textContent = "Telegraph testnet"; };
  es.onmessage = (m) => onEvent(JSON.parse(m.data));
  es.onerror = () => { es.close(); $("#live").classList.add("off"); $("#live span").textContent = "Reconnecting"; setTimeout(connect, 3000); };
}

// ───────── layout: tell the scene which part of the hero is free for the farm
function layout() {
  const st = $(".stage").getBoundingClientRect();
  if (desktop()) {
    const dock = $("#dock").getBoundingClientRect(), led = $(".ledger").getBoundingClientRect(), pitch = $(".pitch").getBoundingClientRect();
    const top = pitch.bottom - st.top - 84; // the farm's top-left corner is open sky, so it can tuck under the text
    scene.setFrame({ x: 130, y: top, w: led.left - st.left - 140, h: dock.top - st.top - top - 4 });
  } else scene.setFrame({ x: 4, y: 40, w: st.width - 8, h: st.height - 44 });
}
function placeTags(pos) {
  const st = $(".stage"), W = st.clientWidth, maxX = desktop() ? $(".ledger").offsetLeft - 12 : W;
  for (const [id, p] of Object.entries(pos)) {
    const el = tags[id];
    if (!el) continue;
    let { x, y } = p;
    if (tagState[id].open) {
      const half = el.offsetWidth / 2 + 8;
      x = Math.max(half, Math.min(maxX - half, x));
      y = Math.max(el.offsetHeight + 74, y);
    }
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    el.style.opacity = p.show || tagState[id].open ? 1 : 0;
    el.style.pointerEvents = p.show ? "" : "none";
  }
}

// ───────── start
async function start() {
  const h1 = $("#h1");
  h1.innerHTML = h1.textContent.split(" ").map((w, i) => `<span class="w" style="animation-delay:${0.05 + i * 0.045}s">${w}</span>`).join(" ");
  [state] = await Promise.all([fetch("/api/state?limit=30").then((r) => r.json()), document.fonts.ready]);
  NODE = state.node || NODE;
  $("#farm-label").textContent = state.farm.label;
  if (state.tick_seconds > 0) $("#live").title = `The fleet also decides on its own, one machine every ${Math.round(state.tick_seconds / 60)} minutes`;
  for (const m of state.machines) THUMB[m.id] = machineThumb(m.id);
  renderDock();
  renderStats();
  renderFeed();
  scene = createScene($("#scene"), { low: !desktop() || navigator.hardwareConcurrency <= 4 });
  for (const m of state.machines) makeTag(m);
  scene.onFrame(placeTags);
  layout();
  let rz;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(layout, 120); });
  // put each machine in the state its last decision left it in, without replaying the motion
  for (const m of state.machines) {
    const last = state.decisions.find((d) => d.machine === m.id && isHome(d.farm));
    if (!last) continue;
    scene.setMode(m.id, last.outcome, { settled: true });
    setTag(m.id, { cls: last.outcome, text: OUT[last.outcome].toLowerCase() });
    setUnit(m.id, last.outcome, last.summary);
  }
  renderGuard();
  renderSteps();
  renderVerify();
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.15 });
  $$(".reveal:not(.in)").forEach((el) => io.observe(el));
  let on = 0;
  setInterval(() => {
    const s = $$("#steps .step");
    if (!s.length || s[0].getBoundingClientRect().top > innerHeight || s[0].getBoundingClientRect().bottom < 0) return;
    on = (on + 1) % s.length;
    s.forEach((el, i) => el.classList.toggle("on", i === on));
  }, 2600);
  setInterval(() => $$("#feed time[datetime]").forEach((t) => (t.textContent = ago(t.dateTime))), 30000);
  connect();
}
start();
