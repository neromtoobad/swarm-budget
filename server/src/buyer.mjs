// Buy an answer, check it with the guard, and re-buy from another ranked miner when it fails.
import { judge } from "./guard.mjs";

const MAX_REBUYS = Number(process.env.MAX_REBUYS ?? 2);
const MINER_CACHE_MS = 10 * 60e3;

export function createBuyer({ tg, store, budget, onPurchase = () => {} }) {
  const minerCache = new Map();

  async function compatibleMiners(intent) {
    const hit = minerCache.get(intent);
    if (hit && Date.now() - hit.at < MINER_CACHE_MS) return hit.list;
    const r = await tg.intentMiners(intent);
    const list = (r.miners ?? []).filter((m) => m.compatible).map((m) => ({ id: String(m.id), name: m.name, slug: m.slug }));
    minerCache.set(intent, { at: Date.now(), list });
    return list;
  }

  // Next miner to try: untried, not rejected by us twice with no accept; miners naming the market we need first
  // (ctx.prefer keywords), then our own pass rate, then the node's order.
  async function nextMiner(intent, tried, prefer = []) {
    const list = await compatibleMiners(intent);
    const rec = new Map(store.minerRecord(intent).map((r) => [String(r.miner_id), r]));
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

  // ctx: { farm, machine, intent, params, place, origin?, destination?, forceMinerId? }
  return async function buy(ctx) {
    const attempts = [];
    const tried = new Set();
    let miner = ctx.forceMinerId ? { id: String(ctx.forceMinerId) } : null; // null = let Telegraph route to its top-ranked miner
    for (let attempt = 1; attempt <= 1 + MAX_REBUYS; attempt++) {
      const gate = budget.canSpend();
      if (!gate.ok) {
        attempts.push({ attempt, verdict: "skipped", checks: [{ pass: false, why: gate.why }] });
        break;
      }
      const resp = await tg.askEscrow({ intent: ctx.intent, params: ctx.params }, { minerId: miner?.id }).catch((e) => ({
        ok: false, status: 0, body: { reason: String(e.message || e) },
      }));
      const v = judge(resp, ctx);
      const b = resp.body ?? {};
      const minerId = b.miner_id != null ? String(b.miner_id) : miner?.id ?? null;
      if (minerId) tried.add(minerId);
      const rec = {
        at: new Date().toISOString(), farm: ctx.farm, machine: ctx.machine, intent: ctx.intent, params: ctx.params,
        attempt, routed: miner ? "direct" : "telegraph",
        miner_id: minerId, miner_name: b.miner_name ?? miner?.name ?? null, status: resp.status,
        cost_usd: resp.ok ? Number(b.cost_usd ?? b.cost_usd_total ?? 0) : 0, ms: resp.ms,
        signal_hash: b.signal_hash ?? null, receipt_hash: resp.receipt?.receipt_hash ?? null,
        epoch_id: resp.receipt?.epoch_id ?? null, rail: resp.rail ?? null,
        verdict: v.verdict, checks: v.checks, result: b.result ?? (resp.ok ? null : { error: b.reason ?? b.error ?? null }),
      };
      rec.id = store.addPurchase(rec);
      attempts.push(rec);
      onPurchase(rec);
      if (v.verdict === "accepted") return { accepted: rec, attempts };
      miner = await nextMiner(ctx.intent, tried, ctx.prefer).catch(() => null);
      if (!miner) break;
    }
    return { accepted: null, attempts };
  };
}
