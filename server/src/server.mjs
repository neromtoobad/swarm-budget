// HTTP server: static web app, JSON API, live event stream, and the fleet's own decision loop.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createTelegraph } from "./telegraph.mjs";
import { openStore } from "./store.mjs";
import { createBuyer } from "./buyer.mjs";
import { createFleet, DEFAULT_FARM, MACHINES, farmFromInput } from "./fleet.mjs";

const PORT = Number(process.env.PORT || 4380);
const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD || 3);
const TICK_SECONDS = Number(process.env.TICK_SECONDS || 300); // 0 = no automatic decisions
const WEB = new URL("../../web/", import.meta.url).pathname;

const tg = createTelegraph();
const store = openStore();
const clients = new Set();
const emit = (ev) => {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
};

const dayStart = () => new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
const budget = {
  canSpend() {
    const spent = store.spentSince(dayStart());
    return spent + 0.01 <= DAILY_BUDGET_USD + 1e-9
      ? { ok: true }
      : { ok: false, why: `today's intelligence budget of $${DAILY_BUDGET_USD.toFixed(2)} is spent; it resets at 00:00 UTC` };
  },
  state() {
    return { daily_usd: DAILY_BUDGET_USD, spent_today_usd: Number(store.spentSince(dayStart()).toFixed(4)) };
  },
};

const buy = createBuyer({
  tg, store, budget,
  onAsk: (a) => emit({ type: "asking", ...a }),
  onPurchase: (p) => emit({ type: "purchase", purchase: p }),
});
const fleet = createFleet({ store, buy, emit });

// One decision at a time, so the ledger and budget stay consistent.
let queue = Promise.resolve();
let busy = null;
const run = (fn, label) => {
  const p = queue.then(async () => {
    busy = label;
    try { return await fn(); } finally { busy = null; }
  });
  queue = p.catch(() => {});
  return p;
};

// Automatic loop on the home farm, round robin.
let turn = 0;
if (TICK_SECONDS > 0) {
  setInterval(() => {
    if (busy) return;
    const m = MACHINES[turn++ % MACHINES.length];
    if (m.id === "ledger") {
      const last = store.lastDecision(DEFAULT_FARM.id, "ledger");
      if (last && Date.now() - Date.parse(last.at) < 20 * 3600e3) return; // audit once a day
    }
    run(() => fleet.decide(m.id, DEFAULT_FARM, { trigger: "auto" }), `${m.name} (auto)`).catch((e) => console.error("tick", e));
  }, TICK_SECONDS * 1000);
}

// Visitor rate limit for paid actions.
const hits = new Map();
const allow = (ip, max = 8, windowMs = 3600e3) => {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  hits.set(ip, arr);
  return true;
};

// "Break a miner": send the first purchase to a miner we have seen answer for the wrong place / market.
const KNOWN_BAD = { mule: "190131", lark: "9002" }; // Grid Elering (Estonia) for a CAISO node; TxLens satellite (answered for Illinois)

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => {
  let s = "";
  req.on("data", (c) => (s += c.length < 10000 ? c : ""));
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { ok({}); } });
});
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".glb": "model/gltf-binary", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress).split(",")[0].trim();
  try {
    if (url.pathname === "/api/state") {
      return json(res, 200, {
        farm: DEFAULT_FARM, machines: MACHINES, budget: budget.state(), busy, totals: store.totals(),
        junk: store.junkByIntent(), decisions: store.recent(Number(url.searchParams.get("limit") || 30), url.searchParams.get("farm") || undefined),
        refusals: store.refusals(8), miners: store.minerBoard(),
        node: tg.node, payer: tg.address, tick_seconds: TICK_SECONDS,
      });
    }
    if (url.pathname === "/api/ledger") {
      return json(res, 200, await tg.ledger().catch((e) => ({ error: String(e) })));
    }
    if (url.pathname === "/api/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ type: "hello", busy })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => { clients.delete(res); clearInterval(ping); });
      return;
    }
    if (url.pathname === "/api/decide" && req.method === "POST") {
      const b = await readBody(req);
      if (!MACHINES.some((m) => m.id === b.machine)) return json(res, 400, { error: "pick a machine" });
      if (!allow(ip)) return json(res, 429, { error: "That's 8 paid decisions from you this hour. The fleet keeps running on its own." });
      const force = b.breakMiner ? KNOWN_BAD[b.machine] : undefined;
      if (b.breakMiner && !force) return json(res, 400, { error: "break-a-miner is available for Mule and Lark" });
      const d = await run(() => fleet.decide(b.machine, DEFAULT_FARM, { trigger: b.breakMiner ? "break-a-miner" : "visitor", forceMinerId: force }), b.machine);
      return json(res, 200, d);
    }
    if (url.pathname === "/api/try" && req.method === "POST") {
      const b = await readBody(req);
      if (!allow(ip, 3)) return json(res, 429, { error: "That's 3 farm runs from you this hour." });
      let farm;
      try { farm = await farmFromInput(b.farm, b.packhouse); } catch (e) { return json(res, 400, { error: e.message }); }
      const out = [];
      for (const id of ["kite", "mule", "haul", "lark"]) out.push(await run(() => fleet.decide(id, farm, { trigger: "try-your-farm" }), id));
      return json(res, 200, { farm, decisions: out });
    }
    if (url.pathname === "/healthz") return json(res, 200, { ok: true });

    // static
    let p = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(WEB, p);
    if (!file.startsWith(WEB)) return json(res, 404, { error: "not found" });
    const data = await readFile(file).catch(() => null);
    if (!data) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log(`fleet on http://localhost:${PORT} · payer ${tg.address} · tick ${TICK_SECONDS}s · budget $${DAILY_BUDGET_USD}/day`));
