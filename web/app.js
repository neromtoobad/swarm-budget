// Swarm Budget front end: a low-poly farm in three.js, driven by the server's real decisions and purchases.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (s) => document.querySelector(s);
const C = { paper: 0xf5f1e6, ink: 0x1c1e18, field: 0x6f8f3e, field2: 0x8da858, soil: 0xc8ae7e, road: 0xd9cfb8, ok: 0x2f7d4f, bad: 0xc4422b, hold: 0xb7791f, coin: 0xe3a82b };
const INTENT = {
  STORM_ALERT_GENERAL: "Storm alert", WEATHER_FORECAST_GENERAL: "Rain forecast", GRID_POWER_PRICE_GENERAL: "Power price",
  ROUTE_ETA_GENERAL: "Drive time", SATELLITE_IMAGERY_ANALYSIS_GENERAL: "Satellite read", WEATHER_FORECAST_VERIFY_GENERAL: "Yesterday's weather",
  TASK_EXECUTION_QUALITY_GENERAL: "Decision audit", WEATHER_CHECK_TEMPERATURE: "Temperature",
};
const BREAKABLE = { mule: "Elering, an Estonian grid miner", lark: "a satellite miner that answered for Illinois before" };

let state = null;
let NODE = "https://devnode.telegraphprotocol.com";

// ---------- scene ----------
const host = $("#scene");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.paper);
scene.fog = new THREE.Fog(C.paper, 70, 140);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
camera.position.set(34, 38, 52);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-3, 0, 2);
controls.enableDamping = true;
controls.maxPolarAngle = 1.2;
controls.minDistance = 30;
controls.maxDistance = 180;
controls.enablePan = false;

scene.add(new THREE.HemisphereLight(0xfffbea, 0xb9a77a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-30, 50, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 40, bottom: -40 });
scene.add(sun);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra });
const box = (w, h, d, color, extra) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra));
  m.castShadow = m.receiveShadow = true;
  return m;
};
const cyl = (rt, rb, h, color, seg = 12) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.castShadow = m.receiveShadow = true;
  return m;
};

// ground and fields
const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 160), mat(0xe9e1c9));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const BLOCKS = [
  { x: -22, z: -12, w: 18, d: 14, c: C.field },
  { x: -2, z: -12, w: 18, d: 14, c: C.field2 },
  { x: -22, z: 6, w: 18, d: 16, c: C.field2 }, // block 3, the spray target
  { x: -2, z: 8, w: 14, d: 12, c: C.soil },
];
BLOCKS.forEach((b, i) => {
  const base = box(b.w, 0.3, b.d, C.soil);
  base.position.set(b.x, 0.15, b.z);
  scene.add(base);
  if (b.c === C.soil) return;
  for (let r = 0; r < Math.floor(b.d / 1.6); r++) {
    const row = box(b.w - 1, 0.7, 0.8, b.c);
    row.position.set(b.x, 0.55, b.z - b.d / 2 + 1 + r * 1.6);
    scene.add(row);
  }
  if (i === 2) {
    const sign = box(2.6, 1.4, 0.15, 0xfffdf7);
    sign.position.set(b.x + b.w / 2 + 0.6, 1.4, b.z + b.d / 2 - 1);
    scene.add(sign);
  }
});

// road to the packhouse
const road = box(70, 0.12, 4, C.road);
road.position.set(30, 0.07, 18);
scene.add(road);
const yard = box(16, 0.12, 14, C.road);
yard.position.set(16, 0.07, 4);
scene.add(yard);
for (let x = 0; x < 60; x += 5) {
  const dash = box(2, 0.14, 0.25, 0xfffdf7);
  dash.position.set(x + 4, 0.09, 18);
  scene.add(dash);
}

// barn
const barn = new THREE.Group();
const walls = box(7, 4, 6, 0xb54a35);
walls.position.y = 2;
const roof = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 6.6, 3, 1), mat(0x3a3a33));
roof.rotation.set(Math.PI / 2, 0, Math.PI / 2);
roof.scale.set(1, 1, 0.55);
roof.position.y = 5;
roof.castShadow = true;
barn.add(walls, roof);
barn.position.set(20, 0, -6);
scene.add(barn);

// trees along the edge
for (let i = 0; i < 16; i++) {
  const t = new THREE.Group();
  const trunk = cyl(0.25, 0.3, 1.4, 0x7a5a3a, 6);
  trunk.position.y = 0.7;
  const top = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + (i % 3) * 0.3, 0), mat(i % 2 ? 0x55753a : 0x6b8b44));
  top.position.y = 2.4;
  top.castShadow = true;
  t.add(trunk, top);
  t.position.set(-34 + i * 4.2, 0, -24 + Math.sin(i) * 1.2);
  scene.add(t);
}

// machines
function drone(color) {
  const g = new THREE.Group();
  const body = box(1.6, 0.5, 1.6, color);
  g.add(body);
  const rotors = [];
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const arm = box(1.4, 0.12, 0.18, C.ink);
    arm.position.set(x * 0.7, 0.1, z * 0.7);
    arm.rotation.y = Math.atan2(z, x) * -1;
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 16), mat(0x2b2d27, { transparent: true, opacity: 0.55 }));
    rotor.position.set(x * 1.2, 0.35, z * 1.2);
    g.add(arm, rotor);
    rotors.push(rotor);
  }
  g.userData.rotors = rotors;
  return g;
}
function pad(x, z, color = 0xfffdf7) {
  const p = cyl(1.8, 1.8, 0.15, color, 24);
  p.position.set(x, 0.12, z);
  scene.add(p);
  return p;
}
function rover() {
  const g = new THREE.Group();
  const body = box(2.6, 1, 1.8, 0xd6c37a);
  body.position.y = 0.9;
  const panel = box(2.4, 0.08, 1.9, 0x2e4b78);
  panel.position.y = 1.5;
  panel.rotation.z = 0.12;
  g.add(body, panel);
  for (const x of [-0.9, 0, 0.9]) for (const z of [-1, 1]) {
    const w = cyl(0.38, 0.38, 0.3, C.ink, 10);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.38, z);
    g.add(w);
  }
  return g;
}
function truck() {
  const g = new THREE.Group();
  const cab = box(1.8, 1.8, 2.2, 0x2f5d8a);
  cab.position.set(2.2, 1.3, 0);
  const box1 = box(4.2, 2.4, 2.4, 0xfffdf7);
  box1.position.set(-0.8, 1.6, 0);
  const stripe = box(4.22, 0.3, 2.42, C.ok);
  stripe.position.set(-0.8, 1.1, 0);
  g.add(cab, box1, stripe);
  for (const x of [-2.2, 0.2, 2.2]) for (const z of [-1.15, 1.15]) {
    const w = cyl(0.45, 0.45, 0.3, C.ink, 10);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.45, z);
    g.add(w);
  }
  return g;
}
function kiosk() {
  const g = new THREE.Group();
  const b = box(2.6, 2.4, 2.6, 0xfffdf7);
  b.position.y = 1.2;
  const r = box(3.1, 0.25, 3.1, C.ink);
  r.position.y = 2.5;
  const mast = cyl(0.06, 0.06, 2.6, C.ink, 6);
  mast.position.y = 3.9;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), mat(C.coin, { emissive: C.coin, emissiveIntensity: 0.2 }));
  tip.position.y = 5.2;
  g.add(b, r, mast, tip);
  g.userData.tip = tip;
  return g;
}

const ringFor = (x, z) => {
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.5, 32), new THREE.MeshBasicMaterial({ color: C.coin, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.25, z);
  scene.add(ring);
  return ring;
};

const M = {
  kite: { obj: drone(0xe3a82b), home: new THREE.Vector3(-8, 0.5, 18) },
  lark: { obj: drone(0x5b8bb5), home: new THREE.Vector3(-2, 0.5, 22) },
  mule: { obj: rover(), home: new THREE.Vector3(10, 0, 0) },
  haul: { obj: truck(), home: new THREE.Vector3(18, 0, 10) },
  ledger: { obj: kiosk(), home: new THREE.Vector3(24, 0, 2) },
};
pad(M.kite.home.x, M.kite.home.z);
pad(M.lark.home.x, M.lark.home.z);
const charger = box(0.6, 2, 0.6, 0x3a3a33);
charger.position.set(10, 1, -2.4);
scene.add(charger);
for (const [id, m] of Object.entries(M)) {
  m.obj.position.copy(m.home);
  m.ring = ringFor(m.home.x, m.home.z);
  m.mode = "idle"; // idle | thinking | act | hold | unverified
  m.since = 0;
  m.id = id;
  scene.add(m.obj);
}
M.haul.obj.rotation.y = 0;

// coins: one per purchase, rising if accepted, red and falling if refused
const coins = [];
const coinGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.18, 24);
function spawnCoin(machine, verdict) {
  const m = M[machine];
  if (!m) return;
  const good = verdict === "accepted";
  const c = new THREE.Mesh(coinGeo, new THREE.MeshStandardMaterial({ color: good ? C.coin : C.bad, metalness: 0.4, roughness: 0.35, transparent: true }));
  c.rotation.x = Math.PI / 2;
  const p = new THREE.Vector3();
  m.obj.getWorldPosition(p);
  c.position.copy(p).add(new THREE.Vector3(0, 3, 0));
  c.userData = { t: 0, good, vx: (Math.random() - 0.5) * 0.6 }; // jitter is cosmetic only
  scene.add(c);
  coins.push(c);
}

// HTML tags that follow each machine
const labels = {};
function makeTag(id, name) {
  const el = document.createElement("div");
  el.className = "tag";
  el.innerHTML = `<b>${name}</b> <span class="st">waiting</span>`;
  $("#labels").appendChild(el);
  labels[id] = el;
}

function setMode(id, mode, text) {
  const m = M[id];
  if (!m) return;
  m.mode = mode;
  m.since = clock.elapsedTime;
  const tag = labels[id];
  if (tag) {
    tag.className = `tag ${mode}`;
    tag.querySelector(".st").textContent = text;
  }
  const ringColor = { thinking: C.coin, act: C.ok, hold: C.hold, unverified: C.bad }[mode];
  m.ring.material.color.setHex(ringColor ?? C.coin);
  m.ring.material.opacity = ringColor ? 0.8 : 0;
}

const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
function animate() {
  const t = clock.elapsedTime;
  const dt = Math.min(clock.getDelta(), 0.05);

  // Kite: sprays block 3 in passes when it acted, otherwise sits on its pad
  {
    const m = M.kite, o = m.obj, age = t - m.since;
    const flying = m.mode === "thinking" || (m.mode === "act" && age < 40);
    let target = m.home.clone();
    if (m.mode === "thinking") target.y = 2.2 + Math.sin(t * 2) * 0.2;
    if (m.mode === "act" && age < 40) {
      const b = BLOCKS[2];
      const lane = Math.floor(age / 4) % 8;
      const along = ((age % 4) / 4) * (b.w - 2) - (b.w - 2) / 2;
      target.set(b.x + (lane % 2 ? -along : along), 3.2, b.z - b.d / 2 + 1.5 + lane * 1.8);
    }
    o.position.lerp(target, 0.06);
    o.userData.rotors.forEach((r) => (r.rotation.y += flying ? 0.9 : 0));
  }
  // Lark: climbs and circles over the fields while it is looking
  {
    const m = M.lark, o = m.obj, age = t - m.since;
    const up = m.mode === "thinking" || age < 20;
    const target = up && m.mode !== "idle" ? new THREE.Vector3(-12 + Math.cos(t * 0.4) * 14, 12, -2 + Math.sin(t * 0.4) * 10) : m.home.clone();
    o.position.lerp(target, 0.03);
    o.userData.rotors.forEach((r) => (r.rotation.y += o.position.y > 0.8 ? 0.9 : 0));
  }
  // Haul: drives off toward the packhouse when it acted
  {
    const m = M.haul, o = m.obj, age = t - m.since;
    if (m.mode === "act" && age < 18) {
      const k = age / 18;
      const x = k < 0.15 ? 18 : 18 + ((k - 0.15) / 0.85) * 60;
      o.position.lerp(tmp.set(x, 0, k < 0.15 ? 10 + (k / 0.15) * 8 : 18), 0.08);
    } else o.position.lerp(m.home, 0.05);
  }
  // Mule: plugs into the charger when it charges now
  {
    const m = M.mule, o = m.obj;
    const target = m.mode === "act" ? tmp.set(10, 0, -1) : m.home;
    o.position.lerp(target, 0.04);
    if (m.mode === "thinking") o.rotation.y = Math.sin(t * 3) * 0.08;
  }
  // Ledger: the mast blinks while it is buying
  {
    const tip = M.ledger.obj.userData.tip;
    tip.material.emissiveIntensity = M.ledger.mode === "thinking" ? 0.5 + Math.sin(t * 8) * 0.5 : 0.2;
  }
  for (const m of Object.values(M)) if (m.mode === "thinking") m.ring.material.opacity = 0.5 + Math.sin(t * 5) * 0.3;

  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i], u = c.userData;
    u.t += dt;
    if (u.good) {
      c.position.y += dt * 2.2;
      c.rotation.z += dt * 4;
    } else {
      c.position.y += u.t < 0.5 ? dt * 2 : -dt * 6 * u.t;
      c.position.x += u.vx * dt;
      c.rotation.y += dt * 8;
    }
    c.material.opacity = Math.max(0, 1 - u.t / 2.6);
    if (u.t > 2.6 || c.position.y < 0) {
      scene.remove(c);
      c.material.dispose();
      coins.splice(i, 1);
    }
  }

  controls.update();
  renderer.render(scene, camera);

  // place tags
  const rect = host.getBoundingClientRect();
  for (const [id, el] of Object.entries(labels)) {
    M[id].obj.getWorldPosition(tmp);
    tmp.y += id === "ledger" ? 6 : id === "haul" ? 3.6 : 2.6;
    tmp.project(camera);
    const inView = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
    el.style.opacity = inView ? 1 : 0;
    el.style.left = `${((tmp.x + 1) / 2) * rect.width}px`;
    el.style.top = `${((1 - tmp.y) / 2) * rect.height}px`;
  }
  requestAnimationFrame(animate);
}

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep the whole farm in frame on narrow screens: pull the camera back as the view gets taller
  const back = Math.min(2.4, Math.max(1, 1.5 / camera.aspect));
  camera.position.copy(controls.target).add(new THREE.Vector3(32, 36, 50).multiplyScalar(back));
  camera.updateProjectionMatrix();
  $("#labels").style.top = `${host.offsetTop}px`;
}
new ResizeObserver(resize).observe(host);

// ---------- ledger UI ----------
const usd = (n) => `$${Number(n || 0).toFixed(n && n < 0.1 ? 4 : 2)}`;
const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nameOf = (id) => state?.machines.find((m) => m.id === id)?.name ?? id;

function buyRow(p) {
  const li = document.createElement("li");
  li.className = `buy ${p.verdict}`;
  const failed = (p.checks || []).filter((c) => !c.pass).map((c) => c.why);
  const why = p.verdict === "accepted"
    ? (p.checks || []).map((c) => c.why).slice(0, 2).join(" · ")
    : `Refused: ${failed.join(" · ") || "no answer"}`;
  const miner = p.miner_name ? `${esc(p.miner_name)}${p.miner_id ? ` <span class="muted">#${esc(p.miner_id)}</span>` : ""}` : "no miner";
  const route = p.attempt > 1 ? `re-buy ${p.attempt - 1}` : p.routed === "direct" ? "sent direct" : "Telegraph routed";
  const proof = [
    p.signal_hash ? `<a href="${NODE}/engine/v1/signal/${encodeURIComponent(p.signal_hash)}" target="_blank" rel="noopener" title="Open the signed answer on the Telegraph node">signal ${esc(p.signal_hash.slice(0, 14))}…</a>` : null,
    p.receipt_hash ? `receipt ${esc(String(p.receipt_hash).slice(0, 12))}…` : null,
    p.epoch_id != null ? `epoch ${esc(p.epoch_id)}` : null,
  ].filter(Boolean).join(" · ");
  li.innerHTML = `<span class="dot"></span>
    <span class="what"><b>${esc(INTENT[p.intent] ?? p.intent)}</b> from ${miner} · ${route}</span>
    <span class="cost">${p.cost_usd ? usd(p.cost_usd) : "$0"}</span>
    <span class="why">${esc(why)}</span>
    ${proof ? `<span class="proof">${proof}</span>` : ""}`;
  return li;
}

function decisionCard(d) {
  const li = $("#t-decision").content.firstElementChild.cloneNode(true);
  li.dataset.key = d.id ?? `live-${d.machine}`;
  li.classList.add(d.outcome ?? "thinking");
  const farm = d.farm && d.farm !== "kerman-ca" ? ` · ${d.farm.replace(/-/g, " ")}` : "";
  li.querySelector(".who").textContent = nameOf(d.machine) + farm;
  li.querySelector(".outcome").textContent = d.outcome ? { act: "acted", hold: "held", unverified: "no verified answer" }[d.outcome] : "buying answers…";
  li.querySelector("time").textContent = d.at ? `${ago(d.at)}${d.trigger && d.trigger !== "auto" ? ` · ${d.trigger.replace(/-/g, " ")}` : ""}` : "";
  li.querySelector(".summary").textContent = d.summary ?? "";
  const ul = li.querySelector(".buys");
  (d.purchases || []).forEach((p) => ul.appendChild(buyRow(p)));
  return li;
}

function renderFeed() {
  const feed = $("#feed");
  feed.replaceChildren(...(state.decisions.length ? state.decisions.map(decisionCard) : [Object.assign(document.createElement("li"), { className: "empty", textContent: "No decisions yet. Run a machine below." })]));
}

function renderStats() {
  const t = state.totals;
  $("#s-spent").textContent = `${usd(state.budget.spent_today_usd)} / ${usd(state.budget.daily_usd)}`;
  $("#s-bought").textContent = t.purchases ?? 0;
  $("#s-junk").textContent = (t.rejected ?? 0) + (t.failed ?? 0);
  $("#s-rebuys").textContent = t.rebuys ?? 0;
}

function renderMachines() {
  const wrap = $("#machines");
  wrap.replaceChildren(...state.machines.map((m) => {
    const div = document.createElement("div");
    div.className = "mc";
    div.innerHTML = `<h3>${esc(m.name)}</h3><p>${esc(m.job)}</p><div class="row"><button data-run="${m.id}">Run now</button>${BREAKABLE[m.id] ? `<button class="ghost" data-break="${m.id}" title="First purchase goes to ${esc(BREAKABLE[m.id])}">Send to a bad miner</button>` : ""}</div>`;
    return div;
  }));
}

function machineStatesFromHistory() {
  for (const m of state.machines) {
    const last = state.decisions.find((d) => d.machine === m.id && d.farm === state.farm.id);
    if (last) setMode(m.id, "idle", { act: "acted", hold: "held", unverified: "no verified answer" }[last.outcome] + ` · ${ago(last.at)}`);
  }
}

async function loadState() {
  state = await fetch("/api/state?limit=30").then((r) => r.json());
  NODE = state.node || NODE;
  $("#node-link").href = `${NODE}/engine/v1/intents`;
  $("#node-link").textContent = new URL(NODE).host;
  $("#payer").textContent = state.payer;
  $("#farm-label").textContent = state.farm.label;
  renderStats();
  renderFeed();
}

function toast(msg) {
  const el = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
function setBusy(label) {
  const b = $("#busy");
  b.hidden = !label;
  b.textContent = label ? `${label} is buying answers` : "";
}

async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-run],button[data-break]");
  if (!btn) return;
  const id = btn.dataset.run || btn.dataset.break;
  btn.disabled = true;
  try {
    await post("/api/decide", { machine: id, breakMiner: Boolean(btn.dataset.break) });
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

$("#try").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Running 4 machines…";
  try {
    const r = await post("/api/try", { farm: f.get("farm"), packhouse: f.get("packhouse") });
    toast(`Done for ${r.farm.label}: ${r.decisions.map((d) => `${nameOf(d.machine)} ${d.outcome}`).join(", ")}`);
  } catch (err) { toast(err.message); }
  btn.disabled = false;
  btn.textContent = "Run the fleet there";
});

// ---------- live stream ----------
const live = new Map(); // machine -> card element while a decision is in flight
function liveCard(machine, farm) {
  if (live.has(machine)) return live.get(machine);
  const card = decisionCard({ machine, farm, purchases: [] });
  $("#feed").querySelector(".empty")?.remove();
  $("#feed").prepend(card);
  live.set(machine, card);
  return card;
}

function connect() {
  const es = new EventSource("/api/stream");
  es.onmessage = async (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type === "hello") setBusy(ev.busy);
    if (ev.type === "thinking") {
      setBusy(nameOf(ev.machine));
      liveCard(ev.machine, ev.farm);
      if (ev.farm === state.farm.id) setMode(ev.machine, "thinking", "buying answers…");
    }
    if (ev.type === "purchase") {
      const p = ev.purchase;
      liveCard(p.machine, p.farm).querySelector(".buys").appendChild(buyRow(p));
      if (p.farm === state.farm.id) spawnCoin(p.machine, p.verdict);
    }
    if (ev.type === "decision") {
      const d = ev.decision;
      const card = live.get(d.machine);
      const fresh = decisionCard(d);
      if (card) card.replaceWith(fresh); else $("#feed").prepend(fresh);
      live.delete(d.machine);
      setBusy(null);
      if (d.farm === state.farm.id) setMode(d.machine, d.outcome, { act: "acted", hold: "held", unverified: "no verified answer" }[d.outcome]);
      const s = await fetch("/api/state?limit=1").then((r) => r.json());
      state = { ...state, budget: s.budget, totals: s.totals, junk: s.junk, decisions: [d, ...state.decisions] };
      renderStats();
    }
  };
  es.onerror = () => { es.close(); setTimeout(connect, 3000); };
}

await loadState();
for (const m of state.machines) makeTag(m.id, m.name);
renderMachines();
machineStatesFromHistory();
resize();
animate();
connect();
