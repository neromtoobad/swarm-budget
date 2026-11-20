// Prints PASS / FAIL for each README claim against a running app and the public Telegraph node.
// Usage: node tools/check-live.mjs [app-url]   (default http://localhost:4380)
const APP = (process.argv[2] || "http://localhost:4380").replace(/\/$/, "");
let failed = 0;
const check = async (name, fn) => {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name} — ${e.message}`);
  }
};
const get = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
  return r.json();
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

const state = await get(`${APP}/api/state?limit=200`);
const purchases = state.decisions.flatMap((d) => d.purchases);

await check("app is up and has made decisions", async () => {
  must(state.decisions.length > 0, "no decisions yet");
  return `${state.totals.decisions} decisions, ${state.totals.purchases} purchases`;
});

await check("every purchase carries a Telegraph signal hash and an escrow receipt", async () => {
  const paid = purchases.filter((p) => p.status === 200);
  must(paid.length > 0, "no paid purchases");
  const missing = paid.filter((p) => !p.signal_hash || !p.receipt_hash);
  must(missing.length === 0, `${missing.length} paid purchases without signal or receipt`);
  return `${paid.length} paid purchases on rail ${[...new Set(paid.map((p) => p.rail))].join(", ")}`;
});

await check("the node's public signal record names our wallet as the buyer", async () => {
  const p = purchases.find((x) => x.signal_hash);
  const sig = await get(`${state.node}/engine/v1/signal/${p.signal_hash}`);
  const buyer = sig.signal?.wallet_address?.toLowerCase();
  must(buyer === state.payer.toLowerCase(), `signal buyer ${buyer} ≠ payer ${state.payer}`);
  return `${p.signal_hash.slice(0, 18)}… bought by ${buyer.slice(0, 10)}…, intent ${sig.signal.intent_id ?? p.intent}`;
});

await check("escrow ledger on the node shows the payer's spend", async () => {
  const l = await get(`${state.node}/v1/ledger/account/${state.payer.toLowerCase()}`);
  const spent = Number(l.charged || 0) + Number(l.unbilled || 0);
  must(spent > 0, "nothing charged or unbilled");
  return `deposited ${Number(l.deposited) / 1e6} USDC, charged+unbilled ${spent / 1e6} USDC`;
});

await check("the guard has refused at least one answer, and a re-buy followed", async () => {
  const refused = purchases.filter((p) => p.verdict === "rejected");
  const rebuys = purchases.filter((p) => p.attempt > 1);
  must(refused.length > 0, "no refused answers yet");
  must(rebuys.length > 0, "no re-buys yet");
  const why = refused[0].checks.find((c) => !c.pass)?.why;
  return `${refused.length} refused, ${rebuys.length} re-buys; e.g. "${why}"`;
});

await check("no machine acted on a refused answer", async () => {
  for (const d of state.decisions.filter((x) => x.outcome !== "unverified")) {
    const byIntent = Object.groupBy(d.purchases, (p) => p.intent);
    for (const [intent, ps] of Object.entries(byIntent))
      must(ps.some((p) => p.verdict === "accepted"), `decision ${d.id} (${d.machine}) ${d.outcome} without an accepted ${intent}`);
  }
  return "every act/hold has an accepted answer for each intent it bought";
});

await check("daily budget is enforced", async () => {
  must(state.budget.spent_today_usd <= state.budget.daily_usd, "over budget");
  return `$${state.budget.spent_today_usd} of $${state.budget.daily_usd} today`;
});

await check("unplugged-sensor runs spent nothing and did not move", async () => {
  const runs = state.decisions.filter((d) => d.trigger === "unplug-sensor");
  must(runs.length > 0, "no unplug-sensor run yet (click Unplug sensor on Haul)");
  for (const d of runs) must(d.cost_usd === 0 && d.purchases.length === 0 && d.outcome !== "act", `decision ${d.id} bought or acted`);
  return `${runs.length} run(s), $0.00 each`;
});

await check("revoked-pay runs bought nothing after the withdrawal and did not act", async () => {
  const runs = state.decisions.filter((d) => d.trigger === "revoke-pay");
  must(runs.length > 0, "no revoke-pay run yet (click Revoke pay on Kite)");
  for (const d of runs) {
    must(d.outcome !== "act", `decision ${d.id} acted`);
    must(new Set(d.purchases.map((p) => p.intent)).size <= 1, `decision ${d.id} bought a second kind of answer after the withdrawal`);
  }
  return `${runs.length} run(s); e.g. "${runs[0].summary.slice(0, 70)}…"`;
});

await check("cost report matches the decisions", async () => {
  const c = state.costs;
  must(c, "no cost report in /api/state");
  must(state.totals.decisions <= 200, "more than 200 decisions; recheck with a larger limit");
  const spent = state.decisions.reduce((s, d) => s + d.cost_usd, 0);
  const hours = state.decisions.reduce((s, d) => s + (d.op_hours || 0), 0);
  const done = state.decisions.filter((d) => d.outcome === "act").length;
  must(Math.abs(spent - c.spent_usd) < 1e-3 && Math.abs(hours - c.operating_hours) < 1e-2 && done === c.completed_jobs, "cost report does not match the decisions");
  return `$${c.per_hour_usd} per hour of work over ${c.operating_hours} h, $${c.per_job_usd} per job (${done} jobs), mean recovery ${c.mean_recovery_s ?? "n/a"} s`;
});

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
