// The checked-ask package on its own: the buy-check-rebuy loop, spending gates, miner ranking,
// and the MCP server over stdio. No network, no spend: a stand-in node replays saved testnet answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createCheckedAsk, memoryRecord, judge } from "../packages/checked-ask/index.mjs";

const load = (f) => JSON.parse(readFileSync(new URL(`../evidence/${f}`, import.meta.url)));
const KERMAN = { name: "Kerman", region: "California", country: "United States", lat: 36.7238, lon: -120.06 };
const STORM = { intent: "STORM_ALERT_GENERAL", params: { location: "Kerman, California", window_hours: 6 }, place: KERMAN };
// the two real answers about Kerman, Iran (miners TxLens 9002 and Amanat), as the node returned them
const IRAN = load("junk-STORM_ALERT-kerman-iran.json").map((p) => ({
  ok: true, status: 200, ms: 900, rail: "escrow",
  body: { result: JSON.parse(p.result), miner_id: p.miner_id, miner_name: p.miner_name, signal_hash: p.signal_hash, cost_usd: 0.01 },
  receipt: { receipt_hash: p.receipt_hash, epoch_id: p.epoch_id },
}));
// the real answer for the same farm asked by coordinates (PREFLIGHT Infrastructure Signals, accepted at 0 km)
const byCoords = load("name-vs-coordinates-STORM_ALERT.json").by_coordinates;
const GOOD = { ok: true, status: 200, ms: 1200, rail: "escrow", body: { result: byCoords.result, miner_id: "20260828", cost_usd: 0.01 }, receipt: null };

function node(replies, miners = [{ id: 7306, name: "SkyWire", compatible: true }, { id: 5, name: "Space weather", compatible: true }]) {
  const asked = [];
  return {
    asked,
    intentMiners: async () => ({ miners }),
    askEscrow: async (body, { minerId } = {}) => (asked.push(minerId ?? "routed"), structuredClone(replies.shift() ?? GOOD)),
  };
}

test("an answer about Kerman, Iran is refused and the next miner is bought from", async () => {
  const client = node([IRAN[0]]);
  const out = await createCheckedAsk({ client })(STORM);
  assert.equal(out.attempts[0].verdict, "rejected");
  assert.match(out.attempts[0].checks.map((c) => c.why).join(" "), /same town name, different place/);
  assert.equal(out.accepted.attempt, 2);
  assert.deepEqual(client.asked, ["routed", "7306"]);
  assert.ok(out.accepted.result.peak_gust_kmh != null);
});

test("re-buys prefer a miner whose name fits the job", async () => {
  const client = node([IRAN[0]]);
  await createCheckedAsk({ client })({ ...STORM, prefer: ["space"] });
  assert.deepEqual(client.asked, ["routed", "5"]);
});

test("canSpend runs before every purchase and stops the loop", async () => {
  const client = node([IRAN[0], IRAN[1]]);
  const out = await createCheckedAsk({ client, canSpend: (ctx, spent) => (spent >= 0.01 ? { ok: false, why: "limit reached" } : { ok: true }) })(STORM);
  assert.equal(client.asked.length, 1);
  assert.equal(out.accepted, null);
  assert.deepEqual(out.attempts.map((a) => a.verdict), ["rejected", "skipped"]);
  assert.equal(out.spent_usd, 0.01);
});

test("a miner refused twice with nothing accepted is not bought from again", async () => {
  const record = memoryRecord();
  record.add("STORM_ALERT_GENERAL", "7306", "rejected");
  record.add("STORM_ALERT_GENERAL", "7306", "rejected");
  const client = node([IRAN[0]]);
  await createCheckedAsk({ client, record })(STORM);
  assert.deepEqual(client.asked, ["routed", "5"]);
});

test("a node error is recorded as a failed attempt, not thrown", async () => {
  const client = { intentMiners: async () => ({ miners: [] }), askEscrow: async () => { throw new Error("ETIMEDOUT"); } };
  const out = await createCheckedAsk({ client })(STORM);
  assert.equal(out.accepted, null);
  assert.equal(out.attempts[0].verdict, "failed");
  assert.equal(out.attempts[0].cost_usd, 0);
});

// ---- MCP server over stdio ----
function mcp(env = {}) {
  const child = spawn(process.execPath, [new URL("../packages/checked-ask/mcp.mjs", import.meta.url).pathname], {
    env: { PATH: process.env.PATH, TELEGRAPH_NODE: "http://127.0.0.1:9", ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buf = "";
  const waiting = new Map();
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(m.id)?.(m);
    }
  });
  let n = 0;
  const call = (method, params) => new Promise((res) => {
    const id = ++n;
    waiting.set(id, res);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  return { call, notify: (method) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n"), close: () => child.kill() };
}

test("MCP: handshake, tool list, and a free check of the Kerman, Iran answer", async (t) => {
  const s = mcp();
  t.after(s.close);
  const init = await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "checked-ask");
  s.notify("notifications/initialized");
  const list = await s.call("tools/list", {});
  assert.deepEqual(list.result.tools.map((x) => x.name), ["ask_checked", "check_answer", "find_miners", "get_intent", "escrow_balance"]);
  const r = await s.call("tools/call", { name: "check_answer", arguments: { ...STORM, reply: IRAN[1].body } });
  assert.equal(r.result.structuredContent.verdict, "rejected");
  assert.deepEqual(r.result.structuredContent, judge(IRAN[1], STORM));
});

test("MCP: with no wallet, ask_checked buys nothing and says why", async (t) => {
  const s = mcp();
  t.after(s.close);
  await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  const r = await s.call("tools/call", { name: "ask_checked", arguments: STORM });
  const out = r.result.structuredContent;
  assert.equal(out.verdict, "no answer passed");
  assert.equal(out.spent_usd, 0);
  assert.match(out.attempts[0].why, /no wallet/);
});

test("MCP: the per-call limit is enforced in code before paying", async (t) => {
  // a key that holds nothing: the gate must stop before any request, because $0.02 > the $0.01 per-call limit
  const s = mcp({ EVM_PRIVATE_KEY: "0x" + "11".repeat(32), CHECKED_ASK_MAX_USD_PER_CALL: "0.01" });
  t.after(s.close);
  await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  const r = await s.call("tools/call", { name: "ask_checked", arguments: STORM });
  assert.match(r.result.structuredContent.attempts[0].why, /call's limit of \$0.01/);
});
