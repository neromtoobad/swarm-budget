// Buy an answer, check it with the guard, and buy again from another miner when it fails.
import { judge } from "./guard.mjs";

// How often each miner's answers passed the guard, kept in memory. Apps with a database pass their own.
export function memoryRecord() {
  const rows = new Map(); // intent -> Map(minerId -> {miner_id, accepted, rejected})
  return {
    get: (intent) => [...(rows.get(intent)?.values() ?? [])],
    add(intent, minerId, verdict) {
      if (minerId == null) return;
      if (!rows.has(intent)) rows.set(intent, new Map());
      const m = rows.get(intent);
      const r = m.get(minerId) ?? { miner_id: minerId, accepted: 0, rejected: 0 };
      if (verdict === "accepted") r.accepted++;
      else r.rejected++;
      m.set(minerId, r);
    },
  };
}

// client: createEscrowClient() or anything with intentMiners() and askEscrow().
// canSpend(ctx, spentUsd) runs before every purchase, so a spent budget or a withdrawn permission stops the very next one.
export function createCheckedAsk({
  client,
  maxRebuys = 2,
  record = memoryRecord(),
  canSpend = () => ({ ok: true }),
  onAsk = () => {},
  onAttempt = () => {},
  minerCacheMs = 10 * 60e3,
} = {}) {
  const minerCache = new Map();

  async function compatibleMiners(intent) {
    const hit = minerCache.get(intent);
    if (hit && Date.now() - hit.at < minerCacheMs) return hit.list;
    const r = await client.intentMiners(intent);
    const list = (r.miners ?? []).filter((m) => m.compatible).map((m) => ({ id: String(m.id), name: m.name, slug: m.slug }));
    minerCache.set(intent, { at: Date.now(), list });
    return list;
  }

  // Next miner to try: untried, and not refused twice with nothing accepted. Miners whose name fits the
  // job come first (ctx.prefer keywords), then our own pass rate per miner, then the node's order.
  async function nextMiner(intent, tried, prefer = []) {
    const list = await compatibleMiners(intent);
    const rec = new Map(record.get(intent).map((r) => [String(r.miner_id), r]));
    const score = (m) => {
      const r = rec.get(m.id);
      if (!r) return 0.5; // unknown: neutral
      return (r.accepted + 1) / (r.accepted + r.rejected + 2);
    };
    const candidates = list.filter((m) => !tried.has(m.id)).filter((m) => {
      const r = rec.get(m.id);
      return !(r && r.accepted === 0 && r.rejected >= 2);
    });
    const fits = (m) => (prefer.some((k) => `${m.name} ${m.slug}`.toLowerCase().includes(k)) ? 1 : 0);
    candidates.sort((a, b) => fits(b) - fits(a) || score(b) - score(a));
    return candidates[0] ?? null;
  }

  // ctx: { intent, params, place?, origin?, destination?, prefer?, firstMinerId?, ...anything the caller needs }
  // Returns { accepted, attempts, spent_usd }. accepted is null when no miner gave an answer that passed.
  return async function checkedAsk(ctx) {
    const attempts = [];
    const tried = new Set();
    let spent = 0;
    let miner = null; // null = let Telegraph route to its top-ranked miner
    if (ctx.firstMinerId) {
      const known = (await compatibleMiners(ctx.intent).catch(() => [])).find((m) => m.id === String(ctx.firstMinerId));
      miner = { id: String(ctx.firstMinerId), name: known?.name ?? null };
    }
    const rebuys = ctx.maxRebuys ?? maxRebuys;
    for (let attempt = 1; attempt <= 1 + rebuys; attempt++) {
      const gate = await canSpend(ctx, spent);
      if (!gate.ok) {
        attempts.push({ attempt, verdict: "skipped", checks: [{ pass: false, why: gate.why }] });
        break;
      }
      onAsk({ intent: ctx.intent, attempt, routed: miner ? "direct" : "telegraph", miner_name: miner?.name ?? null }, ctx);
      const resp = await client.askEscrow({ intent: ctx.intent, params: ctx.params }, { minerId: miner?.id }).catch((e) => ({
        ok: false, status: 0, body: { reason: String(e.message || e) },
      }));
      const v = judge(resp, ctx);
      const b = resp.body ?? {};
      const minerId = b.miner_id != null ? String(b.miner_id) : miner?.id ?? null;
      if (minerId) tried.add(minerId);
      const rec = {
        at: new Date().toISOString(), intent: ctx.intent, params: ctx.params,
        attempt, routed: miner ? "direct" : "telegraph",
        miner_id: minerId, miner_name: b.miner_name ?? miner?.name ?? null, status: resp.status,
        cost_usd: resp.ok ? Number(b.cost_usd ?? b.cost_usd_total ?? 0) : 0, ms: resp.ms,
        signal_hash: b.signal_hash ?? null, receipt_hash: resp.receipt?.receipt_hash ?? null,
        epoch_id: resp.receipt?.epoch_id ?? null, rail: resp.rail ?? null,
        verdict: v.verdict, checks: v.checks, result: b.result ?? (resp.ok ? null : { error: b.reason ?? b.error ?? null }),
      };
      spent += rec.cost_usd;
      record.add?.(ctx.intent, minerId, v.verdict);
      await onAttempt(rec, ctx);
      attempts.push(rec);
      if (v.verdict === "accepted") return { accepted: rec, attempts, spent_usd: spent };
      miner = await nextMiner(ctx.intent, tried, ctx.prefer).catch(() => null);
      if (!miner) break;
    }
    return { accepted: null, attempts, spent_usd: spent };
  };
}
