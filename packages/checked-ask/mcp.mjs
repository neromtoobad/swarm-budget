#!/usr/bin/env node
// checked-ask MCP server (stdio). Gives any AI agent a checked Telegraph purchase: pay for an answer from
// escrow, check it against what was asked, and buy again from another miner when it is wrong.
// Spending limits are enforced here in code, not left to the model.
//
//   EVM_PRIVATE_KEY=0x... npx -y github:neromtoobad/swarm-budget
//
// Env: EVM_PRIVATE_KEY (testnet key with USDC in escrow; without it only the free tools work),
// TELEGRAPH_NODE, CHECKED_ASK_MAX_USD_PER_PAYMENT (0.02), CHECKED_ASK_MAX_USD_PER_CALL (0.06),
// CHECKED_ASK_MAX_USD_SESSION (0.30).
import { createInterface } from "node:readline";
import { createEscrowClient } from "./escrow.mjs";
import { createCheckedAsk } from "./checked-ask.mjs";
import { judge, GUARDED_INTENTS } from "./guard.mjs";

const usd = (name, dflt) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
};
const PER_PAYMENT = usd("CHECKED_ASK_MAX_USD_PER_PAYMENT", 0.02);
const PER_CALL = usd("CHECKED_ASK_MAX_USD_PER_CALL", 0.06);
const PER_SESSION = usd("CHECKED_ASK_MAX_USD_SESSION", 0.3);

const client = createEscrowClient({ maxPerPaymentUusdc: String(Math.round(PER_PAYMENT * 1e6)) });
let sessionSpent = 0;

// The next purchase may cost up to PER_PAYMENT, so it is allowed only if that still fits both limits.
const canSpend = (ctx, spentThisCall) => {
  if (!client.address) return { ok: false, why: "no wallet: set EVM_PRIVATE_KEY to a testnet key with USDC in escrow" };
  if (spentThisCall + PER_PAYMENT > PER_CALL + 1e-9) return { ok: false, why: `this call's limit of $${PER_CALL} is reached` };
  if (sessionSpent + PER_PAYMENT > PER_SESSION + 1e-9) return { ok: false, why: `this session's limit of $${PER_SESSION} is reached` };
  return { ok: true };
};
const checkedAsk = createCheckedAsk({
  client,
  canSpend,
  onAttempt: (rec) => { sessionSpent += rec.cost_usd; },
});

const place = {
  type: "object",
  description: "The place a right answer must be about. Coordinates are checked by distance; a name also needs region or country, because 'Kerman, California' and 'Kerman, Iran' share a town name.",
  properties: {
    name: { type: "string", description: "Town or site name, e.g. Kerman" },
    region: { type: "string", description: "State or region, e.g. California" },
    country: { type: "string", description: "e.g. United States" },
    lat: { type: "number" },
    lon: { type: "number" },
  },
};
const point = { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } } };

const TOOLS = [
  {
    name: "ask_checked",
    description:
      "Buy one answer on the Telegraph network (testnet USDC from escrow, about $0.01), check it against what was asked " +
      "(place, market node, currency, hour, plausible ranges, whether imagery was really analysed), and buy again from another " +
      "miner if it fails. Returns the accepted answer, or null if none passed, with every attempt's checks, cost and signal link. " +
      `Spending limits: $${PER_PAYMENT} per payment, $${PER_CALL} per call, $${PER_SESSION} per session.`,
    inputSchema: {
      type: "object",
      required: ["intent", "params"],
      properties: {
        intent: { type: "string", description: `Exact live intent name. Checks exist for: ${GUARDED_INTENTS.join(", ")}` },
        params: { type: "object", description: "The intent's request params, exactly as its schema (get_intent) lists them" },
        place,
        origin: point,
        destination: point,
        max_rebuys: { type: "integer", minimum: 0, maximum: 3, description: "Other miners to try after a refused answer (default 2)" },
        prefer: { type: "array", items: { type: "string" }, description: "Words a fitting miner's name contains, tried first on re-buys, e.g. [\"caiso\"]" },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "check_answer",
    description: "Free. Run the same checks on a Telegraph reply you already have ({result, ...}), without buying anything.",
    inputSchema: {
      type: "object",
      required: ["intent", "params", "reply"],
      properties: {
        intent: { type: "string" },
        params: { type: "object" },
        reply: { type: "object", description: "The node's JSON reply body, with its result field" },
        place,
        origin: point,
        destination: point,
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "find_miners",
    description: "Free. The miners the Telegraph node lists as compatible with an intent.",
    inputSchema: { type: "object", required: ["intent"], properties: { intent: { type: "string" } } },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "get_intent",
    description: "Free. An intent's live request and response schema from the Telegraph node, so params match exactly.",
    inputSchema: { type: "object", required: ["intent"], properties: { intent: { type: "string" } } },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "escrow_balance",
    description: "Free. This wallet's escrow ledger on the Telegraph node (deposited, charged, unbilled, available), and this session's spend.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

const signalUrl = (h) => (h ? `${client.node}/engine/v1/signal/${h}` : null);
const ctxOf = (a) => ({ intent: a.intent, params: a.params ?? {}, place: a.place, origin: a.origin, destination: a.destination });

const handlers = {
  async ask_checked(a) {
    if (!a?.intent || typeof a.params !== "object") throw new Error("intent and params are required");
    const max = Number.isInteger(a.max_rebuys) ? Math.min(Math.max(a.max_rebuys, 0), 3) : undefined;
    const out = await checkedAsk({ ...ctxOf(a), prefer: (a.prefer ?? []).map((s) => String(s).toLowerCase()), maxRebuys: max });
    const brief = (r) =>
      r.verdict === "skipped"
        ? { attempt: r.attempt, verdict: "skipped", why: r.checks[0].why }
        : {
            attempt: r.attempt, verdict: r.verdict, miner: r.miner_name ?? r.miner_id, status: r.status, cost_usd: r.cost_usd,
            ms: r.ms, checks: r.checks, signal: signalUrl(r.signal_hash), receipt_hash: r.receipt_hash,
          };
    return {
      verdict: out.accepted ? "accepted" : "no answer passed",
      answer: out.accepted?.result ?? null,
      spent_usd: Number(out.spent_usd.toFixed(6)),
      session_spent_usd: Number(sessionSpent.toFixed(6)),
      attempts: out.attempts.map(brief),
      network: `${client.node} (testnet)`,
    };
  },
  check_answer(a) {
    if (!a?.intent || !a.reply) throw new Error("intent, params and reply are required");
    return judge({ ok: true, status: 200, body: a.reply }, ctxOf(a));
  },
  async find_miners(a) {
    const r = await client.intentMiners(a.intent);
    return (r.miners ?? []).map((m) => ({ id: m.id, name: m.name, compatible: m.compatible }));
  },
  get_intent: (a) => client.intent(a.intent),
  async escrow_balance() {
    if (!client.address) return { wallet: null, why: "no wallet: set EVM_PRIVATE_KEY" };
    return { wallet: client.address, ledger: await client.ledger(), session_spent_usd: Number(sessionSpent.toFixed(6)) };
  },
};

// ---- MCP over stdio: newline-delimited JSON-RPC 2.0 ----
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

async function onMessage(m) {
  if (m.id === undefined) return; // notifications (initialized, cancelled) need no reply
  try {
    if (m.method === "initialize") {
      const asked = m.params?.protocolVersion;
      return send({
        id: m.id,
        result: {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "checked-ask", version: "0.1.0" },
          instructions:
            "Use get_intent for the exact params, then ask_checked with the place the answer must be about. " +
            "Only act on an answer whose verdict is accepted. Payments are testnet USDC from escrow.",
        },
      });
    }
    if (m.method === "ping") return send({ id: m.id, result: {} });
    if (m.method === "tools/list") return send({ id: m.id, result: { tools: TOOLS } });
    if (m.method === "tools/call") {
      const fn = handlers[m.params?.name];
      if (!fn) return send({ id: m.id, error: { code: -32602, message: `unknown tool ${m.params?.name}` } });
      try {
        const out = await fn(m.params.arguments ?? {});
        return send({ id: m.id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: Array.isArray(out) ? { items: out } : out } });
      } catch (e) {
        return send({ id: m.id, result: { content: [{ type: "text", text: String(e.message || e) }], isError: true } });
      }
    }
    send({ id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
  } catch (e) {
    send({ id: m.id, error: { code: -32603, message: String(e.message || e) } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let m;
  try { m = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: "parse error" } }); }
  onMessage(m);
});
