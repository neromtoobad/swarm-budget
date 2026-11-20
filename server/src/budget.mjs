// The fleet's daily intelligence budget: one shared pool, split into a share per machine.
// Before every purchase the buyer asks canSpend(machine). It says no when the owner has revoked spending,
// when the whole day's budget is spent, or when that machine has used its own share, so one machine
// (or one visitor clicking it) cannot drain what the others need. Everything resets at 00:00 UTC.
const ASK_USD = 0.01; // what one answer costs on the testnet node; a purchase is allowed only if a whole one fits

export const dayStart = (now = new Date()) => now.toISOString().slice(0, 10) + "T00:00:00.000Z";

// "kite=30,mule=20" → { kite: 30, mule: 20 }. Machines left out keep their default weight.
export function parseShares(text) {
  const out = {};
  for (const part of String(text ?? "").split(",")) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (k && Number(v) >= 0) out[k] = Number(v);
  }
  return out;
}

export function createBudget({ store, daily, machines, shares = {}, authority = () => ({ revoked: false }), now = () => new Date() }) {
  const weight = Object.fromEntries(machines.map((m) => [m.id, shares[m.id] ?? m.share ?? 1]));
  const total = Object.values(weight).reduce((s, w) => s + w, 0) || 1;
  const capOf = (id) => (daily * (weight[id] ?? 0)) / total;
  const money = (v) => `$${v.toFixed(v < 0.1 ? 3 : 2)}`;
  const name = (id) => machines.find((m) => m.id === id)?.name ?? id;

  return {
    capOf,
    canSpend(machine) {
      const a = authority();
      if (a?.revoked) return { ok: false, why: `the farm owner revoked spending permission at ${a.at}` };
      const since = dayStart(now());
      if (store.spentSince(since) + ASK_USD > daily + 1e-9)
        return { ok: false, why: `today's intelligence budget of ${money(daily)} is spent; it resets at 00:00 UTC` };
      if (machine && store.spentSince(since, machine) + ASK_USD > capOf(machine) + 1e-9)
        return { ok: false, why: `${name(machine)}'s share of today's budget (${money(capOf(machine))}) is spent; it resets at 00:00 UTC` };
      return { ok: true };
    },
    state() {
      const since = dayStart(now());
      return {
        daily_usd: daily,
        spent_today_usd: Number(store.spentSince(since).toFixed(4)),
        machines: machines.map((m) => ({
          machine: m.id, share_pct: Math.round((weight[m.id] / total) * 1000) / 10,
          cap_usd: Number(capOf(m.id).toFixed(4)), spent_usd: Number(store.spentSince(since, m.id).toFixed(4)),
        })),
      };
    },
  };
}
