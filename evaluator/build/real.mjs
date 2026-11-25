// Step 0: turn answers the Swarm Budget fleet really paid for into rows.
// A row is made when one decision holds a refused answer and, later in the same decision, an accepted
// answer to the same question from another miner. Both are kept exactly as the node returned them.
// Each answer's public record is at https://devnode.telegraphprotocol.com/engine/v1/signal/<hash>.
//   node build/real.mjs
import { readFileSync, writeFileSync } from "node:fs";
const APP = process.env.APP ?? "https://swarmbudget.nerom.site";
const NODE = "https://devnode.telegraphprotocol.com";
const sig = (h) => `${NODE}/engine/v1/signal/${h}`;
const state = await (await fetch(`${APP}/api/state?limit=200`)).json();

const QUESTIONS = {
  STORM_ALERT_GENERAL: [
    (p) => `Storm risk at ${p.location} for the next ${p.window_hours} hours: risk level, peak gust in km/h and rainfall in mm.`,
    (p) => `A spray drone is waiting at ${p.location}. What is the storm risk and the strongest gust over the next ${p.window_hours} hours?`,
  ],
  WEATHER_FORECAST_GENERAL: [
    (p) => `Forecast for the point ${p.location} over the next ${p.window_hours} hours: high, low, chance of rain and conditions.`,
    (p) => `What weather should a field at ${p.location} expect during the next ${p.window_hours} hours? Give the temperature range and the rain probability.`,
  ],
};
const rows = [];
const used = {};
for (const d of state.decisions) {
  const ps = d.purchases ?? [];
  for (const [i, bad] of ps.entries()) {
    if (bad.verdict !== "rejected" || !QUESTIONS[bad.intent] || !bad.result || !bad.signal_hash) continue;
    const good = ps.slice(i + 1).find((x) => x.intent === bad.intent && x.verdict === "accepted" && x.result && x.signal_hash);
    if (!good) continue;
    const n = (used[bad.intent] = (used[bad.intent] ?? 0) + 1);
    if (n > QUESTIONS[bad.intent].length) continue;
    const why = (bad.checks ?? []).filter((c) => !c.pass).map((c) => c.why).join("; ");
    rows.push({
      intent: bad.intent,
      kind: "missing",
      asked: bad.params.location,
      place: "Point near Kerman, California, United States (36.7236, -120.0599)",
      prompt: QUESTIONS[bad.intent][n - 1](bad.params),
      chosen: JSON.stringify(good.result),
      rejected: JSON.stringify(bad.result),
      rejected_signal_url: sig(bad.signal_hash),
      chosen_signal_url: sig(good.signal_hash),
      note: `Bought by the fleet on ${d.at.slice(0, 10)}. The guard refused the first answer (${why || "failed its checks"}) and accepted the re-buy.`,
    });
  }
}
// The answer that started this project: a storm alert for Kerman, Iran, sold to a farm in Kerman, California.
const iran = JSON.parse(readFileSync(new URL("../../evidence/junk-STORM_ALERT-kerman-iran.json", import.meta.url), "utf8"))[0];
const fine = state.decisions.flatMap((d) => d.purchases ?? []).find((p) => p.intent === "STORM_ALERT_GENERAL" && p.verdict === "accepted" && p.result?.peak_gust_kmh != null);
rows.unshift({
  intent: "STORM_ALERT_GENERAL",
  kind: "wrong_place",
  asked: "Kerman, California",
  place: "Kerman, California, United States (36.7236, -120.0599)",
  other: "Kerman, Iran (30.2832, 57.0788)",
  prompt: "Is there a storm risk in Kerman, California in the next 6 hours?",
  chosen: JSON.stringify(fine.result),
  rejected: iran.result,
  rejected_signal_url: sig(iran.signal_hash),
  chosen_signal_url: sig(fine.signal_hash),
  note: "Bought by the fleet on 2026-11-19 for a farm in Kerman, California: the answer is for Kerman, Iran, about 12,500 km away. The better answer is a later accepted purchase for the same farm (by coordinates), so the two differ in date as well as place.",
});
writeFileSync(new URL("../data/real-refusals.json", import.meta.url), JSON.stringify({ taken_from: `${APP}/api/state and evidence/`, taken_at: new Date().toISOString(), rows }, null, 1));
for (const r of rows) console.log(r.intent, "|", r.kind, "|", r.prompt.slice(0, 70), "\n   chosen  ", r.chosen.slice(0, 150), "\n   rejected", r.rejected.slice(0, 150));
