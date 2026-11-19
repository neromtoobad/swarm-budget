// Buy one real answer per intent the fleet uses, with farm inputs, to design the guard checks.
// Saves every response to evidence/probe-<intent>.json. Costs ~$0.01 per intent from escrow.
import { mkdirSync, writeFileSync } from "node:fs";
import { createTelegraph } from "../server/src/telegraph.mjs";

const tg = createTelegraph();
const nextHour = new Date(Math.ceil(Date.now() / 3600e3) * 3600e3).toISOString().replace(".000", "");
const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);

const probes = [
  ["STORM_ALERT_GENERAL", { location: "Fresno, California", window_hours: 24 }],
  ["GRID_POWER_PRICE_GENERAL", { node_or_zone: "TH_ZP26_GEN-APND", interval_start: nextHour }],
  ["ROUTE_ETA_GENERAL", { origin: "Kerman, California", destination: "Fresno, California" }],
  ["SATELLITE_IMAGERY_ANALYSIS_GENERAL", { location: "Kerman, California", question: "Is there standing water or flooding in the fields?" }],
  ["WEATHER_FORECAST_VERIFY_GENERAL", { location: "Fresno, California", date: yesterday }],
  ["WEATHER_CHECK_TEMPERATURE", { location: "Kerman, California" }],
  ["TASK_EXECUTION_QUALITY_GENERAL", { task: "Hold spraying when wind gusts exceed 15 km/h", result: "Sprayed block 3 at 09:00 with gusts of 22 km/h" }],
];
const only = process.argv[2];
mkdirSync("evidence", { recursive: true });
for (const [intent, params] of probes) {
  if (only && only !== intent) continue;
  const miners = await tg.intentMiners(intent).catch((e) => ({ error: String(e) }));
  const r = await tg.askEscrow({ intent, params });
  writeFileSync(`evidence/probe-${intent}.json`, JSON.stringify({ at: new Date().toISOString(), intent, params, miners, ...r }, null, 2));
  const b = r.body || {};
  console.log(`\n== ${intent} → ${r.status} ${r.ms}ms miner=${b.miner_name || b.miner_id} rank=${b.served_rank}`);
  console.log("result:", JSON.stringify(b.result ?? b.error ?? b).slice(0, 500));
  console.log("field_status:", JSON.stringify(b.field_status));
}
