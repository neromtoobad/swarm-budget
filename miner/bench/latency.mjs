// Latency: time real requests against the live miner, cold (a place it has not seen) and warm.
//   node bench/latency.mjs
import { writeFileSync } from "node:fs";
const BASE = process.env.BASE ?? "https://pinpoint.nerom.site";
const PLACES = ["Omaha, Nebraska", "Tucson, Arizona", "Bergen, Norway", "Kumasi, Ghana", "Da Nang, Vietnam", "Mendoza, Argentina", "Darwin, Australia", "Halifax, Nova Scotia", "Kraków, Poland", "Chiang Mai, Thailand", "Lusaka, Zambia", "Boise, Idaho", "Reno, Nevada", "Cork, Ireland", "Tbilisi", "Ulaanbaatar", "Antofagasta, Chile", "Kochi, Japan", "Gander, Newfoundland", "Port Moresby"];
const day = new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10);
const paths = { "/storm-alert": (p) => `location=${encodeURIComponent(p)}&window_hours=24`, "/forecast": (p) => `location=${encodeURIComponent(p)}&window_hours=48`, "/verify": (p) => `location=${encodeURIComponent(p)}&date=${day}`, "/temperature": (p) => `location=${encodeURIComponent(p)}` };
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const out = {};
for (const [path, qs] of Object.entries(paths)) {
  const cold = [], warm = [], server = [];
  let failures = 0;
  for (const p of PLACES) {
    for (const bucket of [cold, warm]) {
      const t0 = performance.now();
      const res = await fetch(`${BASE}${path}?${qs(p)}`);
      await res.arrayBuffer();
      if (!res.ok) failures++;
      else {
        bucket.push(Math.round(performance.now() - t0));
        if (bucket === cold) server.push(Number(res.headers.get("x-response-ms")));
      }
    }
  }
  out[path] = { requests: PLACES.length * 2, failures, first_time_place: { p50_ms: pct(cold, 50), p95_ms: pct(cold, 95) }, repeat_within_cache: { p50_ms: pct(warm, 50), p95_ms: pct(warm, 95) }, inside_the_server_first_time: { p50_ms: pct(server, 50), p95_ms: pct(server, 95) } };
}
console.table(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { "first time p50": v.first_time_place.p50_ms, "first time p95": v.first_time_place.p95_ms, "repeat p50": v.repeat_within_cache.p50_ms, "server-side p50": v.inside_the_server_first_time.p50_ms, "server-side p95": v.inside_the_server_first_time.p95_ms, failures: v.failures }])));
writeFileSync(new URL(`./results/latency-${new Date().toISOString().slice(0, 10)}.json`, import.meta.url), JSON.stringify({ benchmark: "latency", run_at: new Date().toISOString(), miner: BASE, note: "Client times include the round trip from the machine that ran this (Lagos, Nigeria) to the server. Server-side times are the x-response-ms header: what the miner itself took, including its calls to the weather sources.", results: out }, null, 1));
