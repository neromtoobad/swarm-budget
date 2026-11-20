// What the fleet's intelligence costs per unit of useful work: per operating hour, per completed job,
// and how long it takes to recover when the guard refuses an answer.
// A completed job is a decision whose outcome was "act". Every cent counts, including decisions that held
// or could not be verified: those are the overhead of acting safely.
const round = (v, d = 4) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// Seconds from the first refused or failed answer in a question to the accepted answer that replaced it.
export function recoveries(purchases) {
  const byDecision = new Map();
  for (const p of purchases) {
    if (!byDecision.has(p.decision_id)) byDecision.set(p.decision_id, []);
    byDecision.get(p.decision_id).push(p);
  }
  const out = [];
  for (const list of byDecision.values()) {
    let badAt = null;
    for (const p of list) {
      if (p.verdict === "rejected" || p.verdict === "failed") badAt ??= Date.parse(p.at);
      else if (p.verdict === "accepted" && badAt != null) {
        out.push((Date.parse(p.at) - badAt) / 1000);
        badAt = null;
      } else if (p.verdict === "accepted") badAt = null;
    }
  }
  return out;
}

export function costReport({ decisions, purchases }, machines = []) {
  const sum = (xs, f) => xs.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const per = (spent, n) => (n > 0 ? round(spent / n) : null);
  const rows = machines.map((m) => {
    const ds = decisions.filter((d) => d.machine === m.id);
    const spent = sum(ds, (d) => d.cost_usd);
    const done = ds.filter((d) => d.outcome === "act").length;
    const hours = sum(ds, (d) => d.op_hours);
    return {
      machine: m.id, decisions: ds.length, completed: done,
      held: ds.filter((d) => d.outcome === "hold").length, unverified: ds.filter((d) => d.outcome === "unverified").length,
      spent_usd: round(spent), hours: round(hours, 2), per_hour_usd: per(spent, hours), per_job_usd: per(spent, done),
    };
  });
  const spent = sum(decisions, (d) => d.cost_usd);
  const hours = sum(decisions, (d) => d.op_hours);
  const done = decisions.filter((d) => d.outcome === "act").length;
  const rec = recoveries(purchases);
  return {
    spent_usd: round(spent), decisions: decisions.length, completed_jobs: done, operating_hours: round(hours, 2),
    per_hour_usd: per(spent, hours), per_job_usd: per(spent, done),
    overhead_usd: round(sum(decisions.filter((d) => d.outcome !== "act"), (d) => d.cost_usd)),
    recoveries: rec.length, mean_recovery_s: rec.length ? round(sum(rec, (x) => x) / rec.length, 1) : null,
    machines: rows,
  };
}
