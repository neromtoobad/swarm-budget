// Buy one answer per intent from this miner THROUGH the Telegraph node, paying from escrow like any
// buyer, then check each answer with the Swarm Budget guard and save the evidence.
//
//   node --env-file=../.env scripts/paid-test.mjs            four purchases, about $0.04 of test USDC
//   node --env-file=../.env scripts/paid-test.mjs --trap     also ask for "Paris, Texas" and "Cairo, Illinois"
//
// This is the team's own app wallet buying from the team's own miner. It proves the registered YAML
// works end to end on the network (request built by the node, answer read by the node, receipt issued).
// It is an integration test, not outside demand, and is never counted as such.
import { writeFileSync, mkdirSync } from "node:fs";
import { createEscrowClient, judge } from "../../packages/checked-ask/index.mjs";

const MINER_ID = "3672120";
const client = createEscrowClient({});
const yesterday = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10);
const farm = { name: "Kerman", region: "California", country: "United States", lat: 36.7236, lon: -120.0599 };
const places = {
  "Kerman, California": farm,
  "Paris, Texas": { name: "Paris", region: "Texas", country: "United States", lat: 33.6609, lon: -95.5555 },
  "Cairo, Illinois": { name: "Cairo", region: "Illinois", country: "United States", lat: 37.0053, lon: -89.1765 },
};
const asks = [
  { intent: "STORM_ALERT_GENERAL", params: { location: "Kerman, California", window_hours: 6 } },
  { intent: "WEATHER_FORECAST_GENERAL", params: { location: "Kerman, California", window_hours: 24 } },
  { intent: "WEATHER_FORECAST_VERIFY_GENERAL", params: { location: "Kerman, California", date: yesterday } },
  { intent: "WEATHER_CHECK_TEMPERATURE", params: { location: "Kerman, California" } },
  ...(process.argv.includes("--trap")
    ? [
        { intent: "STORM_ALERT_GENERAL", params: { location: "Paris, Texas", window_hours: 24 } },
        { intent: "WEATHER_FORECAST_GENERAL", params: { location: "Cairo, Illinois", window_hours: 24 } },
      ]
    : []),
];

const rows = [];
for (const a of asks) {
  const resp = await client.askEscrow({ intent: a.intent, params: a.params }, { minerId: MINER_ID });
  const verdict = resp.ok ? judge(resp, { intent: a.intent, params: a.params, place: places[a.params.location] }) : { verdict: "failed", checks: [] };
  const b = resp.body ?? {};
  rows.push({
    intent: a.intent,
    params: a.params,
    http_status: resp.status,
    ms: resp.ms,
    miner_id: b.miner_id ?? b.miner?.id ?? null,
    signal_hash: b.signal_hash ?? null,
    signal_url: b.signal_hash ? `${client.node}/engine/v1/signal/${b.signal_hash}` : null,
    receipt_hash: b.receipt_hash ?? resp.receipt?.receipt_hash ?? null,
    result: b.result ?? null,
    field_status: b.field_status ?? null,
    guard: verdict.verdict,
    guard_checks: verdict.checks,
    error: resp.ok ? null : b,
  });
  console.log(`${a.intent} ${JSON.stringify(a.params)} -> ${resp.status} in ${resp.ms} ms, guard: ${verdict.verdict}`);
  console.log("  ", JSON.stringify(b.result ?? b).slice(0, 400));
}
mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
const file = new URL(`../evidence/paid-test-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ what: "The Swarm Budget wallet buying from Pinpoint Weather through the Telegraph node (escrow rail, testnet). Same team on both sides: an integration test, not outside demand.", buyer: client.address, miner_id: MINER_ID, at: new Date().toISOString(), purchases: rows }, null, 1));
console.log("saved", file.pathname);
