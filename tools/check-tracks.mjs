// Prints PASS / FAIL for the claims of the Miner entry (Pinpoint Weather) and the Evaluator entry
// (place-trap packs), read from the live miner and the public Telegraph node. No key, nothing paid.
// Usage: node tools/check-tracks.mjs [miner-url]   (default https://pinpoint.nerom.site)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const MINER = (process.argv[2] || "https://pinpoint.nerom.site").replace(/\/$/, "");
const NODE = "https://devnode.telegraphprotocol.com";
const REGISTRATION = 6195;
const SLUG = "pinpoint-weather";
const WALLET = "0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E";
const INTENTS = ["STORM_ALERT_GENERAL", "WEATHER_FORECAST_GENERAL", "WEATHER_FORECAST_VERIFY_GENERAL", "WEATHER_CHECK_TEMPERATURE"];
const PACKS = { STORM_ALERT_GENERAL: 220, WEATHER_FORECAST_GENERAL: 220, WEATHER_FORECAST_VERIFY_GENERAL: 130 };

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
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const call = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const q = (o) => new URLSearchParams(o).toString();
const here = (p) => new URL(p, import.meta.url);

console.log("Miner: Pinpoint Weather");
await check("the node lists the registration as active", async () => {
  const { body } = await call(`${NODE}/api/miners/${REGISTRATION}`);
  const m = body?.miner ?? body;
  must(m?.activation_status === "active", `status is ${m?.activation_status ?? body?.error}`);
  must(m.slug === SLUG, `slug is ${m.slug}`);
  return `registration ${REGISTRATION}, slug ${m.slug}`;
});
await check("the YAML the node fetched is the file in this repo", async () => {
  const { body } = await call(`${NODE}/api/miners/${REGISTRATION}`);
  const url = (body?.miner ?? body).yaml_url;
  const hosted = Buffer.from(await (await fetch(url)).arrayBuffer());
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  must(sha(hosted) === sha(readFileSync(here("../miner/pinpoint-weather.yaml"))), "hosted YAML differs from miner/pinpoint-weather.yaml");
  return url.replace(/^https:\/\/raw\.githubusercontent\.com\//, "").slice(0, 70);
});
await check("it is routable on all four intents, with requests mapped in code", async () => {
  const seen = [];
  for (const i of INTENTS) {
    const { body } = await call(`${NODE}/engine/v1/intents/${i}/miners`);
    const me = body.miners.find((m) => m.slug === SLUG);
    must(me, `not listed on ${i}`);
    must(me.compatible, `${i}: ${me.compatibility_reason}`);
    must(me.mapping === "code", `${i}: mapping is ${me.mapping} (${me.compatibility_reason})`);
    seen.push(i);
  }
  return `${seen.length} intents`;
});
await check("Paris, Texas is answered for Texas, with coordinates", async () => {
  const { status, body } = await call(`${MINER}/storm-alert?${q({ location: "Paris, Texas", window_hours: 24 })}`);
  must(status === 200, `HTTP ${status}`);
  must(body.place.country_code === "US" && Math.abs(body.place.latitude - 33.66) < 0.2 && Math.abs(body.place.longitude + 95.56) < 0.2, `answered for ${body.location}`);
  must(["LOW", "MODERATE", "HIGH", "SEVERE"].includes(body.risk_level) && body.peak_gust_kmh != null && body.precipitation_mm != null && body.window, "a canonical field is missing");
  return `${body.location}: ${body.risk_level}, gust ${body.peak_gust_kmh} km/h`;
});
await check("a bare name goes to the largest place and names the others", async () => {
  const { status, body } = await call(`${MINER}/forecast?${q({ location: "Kerman" })}`);
  must(status === 200 && body.place.country_code === "IR", `answered for ${body?.location}`);
  must((body.place.also_matches ?? []).some((m) => m.location.startsWith("Kerman, California")), "Kerman, California is not listed under also_matches");
  return body.place.matched_on;
});
await check("a region with no such town is refused, not swapped for a namesake", async () => {
  const { status, body } = await call(`${MINER}/storm-alert?${q({ location: "Paris, Kansas" })}`);
  must(status === 404 && body.error === "place_not_found", `HTTP ${status} ${body?.error ?? body?.location}`);
  return body.message;
});
await check("towns of similar size with one name are refused with the candidates", async () => {
  const { status, body } = await call(`${MINER}/storm-alert?${q({ location: "Springfield" })}`);
  must(status === 422 && body.error === "ambiguous_location" && body.candidates.length >= 3, `HTTP ${status} ${body?.error ?? body?.location}`);
  return `${body.candidates.length} candidates listed`;
});
await check("coordinates are used as given", async () => {
  const { status, body } = await call(`${MINER}/temperature?${q({ location: "36.7236,-120.0599" })}`);
  must(status === 200 && body.place.latitude === 36.7236 && body.place.longitude === -120.0599 && typeof body.temperature_c === "number", `HTTP ${status}`);
  return `${body.location}: ${body.temperature_c} °C`;
});
await check("a day that has not ended is refused", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { status, body } = await call(`${MINER}/verify?${q({ location: "Tokyo", date: today })}`);
  must(status === 422 && body.error === "day_not_finished", `HTTP ${status} ${body?.error}`);
  return body.message;
});
await check("a past day comes back with a second source", async () => {
  const day = new Date(Date.now() - 12 * 86400e3).toISOString().slice(0, 10);
  const { status, body } = await call(`${MINER}/verify?${q({ location: "Kerman, California", date: day })}`);
  must(status === 200 && body.temp_max_c != null && body.temp_min_c != null && body.precipitation_mm != null, `HTTP ${status}`);
  must(body.second_source, "no second source in the answer");
  return `${day}: high ${body.temp_max_c} °C (second source ${body.second_source.temp_max_c} °C)`;
});
await check("the miner reports itself healthy", async () => {
  const { status, body } = await call(`${MINER}/health`);
  must(status === 200 && body.ok, `HTTP ${status}`);
  const errors = Object.values(body.requests).reduce((a, r) => a + r.errors, 0);
  must(errors === 0, `${errors} internal errors since start`);
  return `up ${Math.round(body.uptime_seconds / 60)} min, version ${body.version}`;
});

console.log("\nEvaluator: place-trap packs");
for (const [intent, want] of Object.entries(PACKS)) {
  await check(`${intent}: our rows are in the node's evaluation pool`, async () => {
    const { body } = await call(`${NODE}/api/evalpool/submissions/mine?submitter=${WALLET}&intent_id=${intent}`);
    must(body?.count === want, `node holds ${body?.count} of our rows, expected ${want}`);
    const by = {};
    for (const r of body.rows) by[r.status] = (by[r.status] ?? 0) + 1;
    must(!by.rejected, `${by.rejected} rows rejected`);
    must(body.rows.every((r) => r.provenance_class === "attested"), "not every row is attested");
    return `${body.count} rows: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ")}`;
  });
  await check(`${intent}: the pack in this repo is the file that was uploaded`, async () => {
    const sha = createHash("sha256").update(readFileSync(here(`../evaluator/packs/${intent}.jsonl`))).digest("hex");
    const rec = JSON.parse(readFileSync(here(`../evaluator/results/upload-${intent}-2026-11-25.json`), "utf8"));
    must(rec.body_sha256 === sha, "sha256 differs from the upload record");
    must(rec.node_reply.accepted === want && rec.node_reply.rejected === 0, `node accepted ${rec.node_reply.accepted}, rejected ${rec.node_reply.rejected}`);
    return `sha256 ${sha.slice(0, 16)}…`;
  });
}
await check("the answer that started this is still on the node: Kerman, Iran for a Kerman, California farm", async () => {
  const hash = "0xbacdfad8d51bae03ad979085f22b8ec21bbac3e153e0ad66c2d1092cbb073a18";
  const { status, body } = await call(`${NODE}/engine/v1/signal/${hash}`);
  must(status === 200, `HTTP ${status}`);
  const text = JSON.stringify(body);
  must(/Iran/.test(text), "the record no longer mentions Iran");
  must(text.toLowerCase().includes(WALLET.toLowerCase()), "the record does not name our wallet as the buyer");
  return `${hash.slice(0, 18)}…`;
});
await check("the pool now has five contributors on WEATHER_FORECAST_GENERAL", async () => {
  const { body } = await call(`${NODE}/api/evalpool/status?intent_id=WEATHER_FORECAST_GENERAL`);
  must(body.submitters >= 5, `${body.submitters} submitters`);
  return `${body.submitters} submitters, ${body.eligible_submitters} eligible so far (rows become eligible at the next snapshot)`;
});

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
