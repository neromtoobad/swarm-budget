// Place-trap benchmark: ask live storm-alert miners about towns that share a name with a bigger place,
// about places that do not exist, and about bare coordinates. Then check which place each answer is for.
//
//   node bench/place-trap.mjs                 run every miner below
//   node bench/place-trap.mjs pinpoint livecert   run only these
//   BASE=http://127.0.0.1:8787 node bench/place-trap.mjs pinpoint    test a local build
//
// Every miner is called on its own public endpoint, the one its registered YAML names, with the request
// shape that YAML declares. Nothing is paid and nothing goes through the node, so this measures the
// miner's own place handling. It does not measure what the node's request builder does before the call.
// Raw replies are saved next to the summary so any row can be checked by hand.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
const { cases, frozen_on, truth_source } = JSON.parse(readFileSync(here("./place-trap-cases.json"), "utf8"));
const question = (place) => `What is the storm risk in ${place} in the next 24 hours?`;
const q = (params) => new URLSearchParams(params).toString();

// name -> how to ask it. `rank` is its STORM_ALERT_GENERAL rank on the node when this file was written (25 Nov 2026, epoch 54).
// For a coordinate case `pt` is { lat, lon }, and each miner is asked in the coordinate form its own YAML documents.
const MINERS = {
  pinpoint: { label: "Pinpoint Weather (this miner)", id: 3672120, call: (p) => ({ url: `${process.env.BASE ?? "https://pinpoint.nerom.site"}/storm-alert?${q({ location: p, window_hours: 24 })}` }) },
  txlens: {
    label: "TxLens", id: 9002, rank: 1,
    call: (p, pt) => ({ url: `https://telegraph-onchain-tx-lookup-miner.onrender.com/storm-alert?${q({ query: pt ? `What is the storm risk at latitude ${pt.lat}, longitude ${pt.lon} in 24 hours?` : question(p) })}` }),
  },
  chainsight: {
    label: "ChainSight", id: 302, rank: 2,
    call: (p, pt) => ({ url: `https://hub.shadrakbessanh.me/wstorm?${q(pt ? { query: `What is the storm risk at latitude ${pt.lat}, longitude ${pt.lon} in the next 24 hours?`, lat: pt.lat, lon: pt.lon } : { query: question(p) })}` }),
  },
  livecert: { label: "LiveCert", id: 4433, rank: 3, call: (p) => ({ url: `https://miner-wine.vercel.app/storm-alert?${q({ location: p, window_hours: 24 })}` }) },
  preflight: { label: "PREFLIGHT", id: 20260828, rank: 6, call: (p) => ({ url: `https://preflight-ssl-verification.vercel.app/weather?${q({ query: question(p) })}` }) },
  tempest: {
    label: "Tempest Storm Intelligence", id: 8262601, rank: 12,
    call: (p, pt) => ({ url: "https://tempest-telegraph-miner.onrender.com/v1/storm-alert", body: pt ? { latitude: pt.lat, longitude: pt.lon, hours: 24 } : { location: p, hours: 24 } }),
  },
  skywire: { label: "SkyWire Sourced Storm Screening", id: 78306, call: (p) => ({ url: `https://telegraph-sky.margyn.workers.dev/storm?${q({ location: p, window_hours: 24 })}` }) },
  amanat: {
    label: "Amanat Weather Risk", id: 20260821,
    call: (p, pt) => ({ url: "https://amanat-miner.vercel.app/forecast", body: pt ? { lat: pt.lat, lon: pt.lon, hours: 24 } : { question: question(p) } }),
  },
};

const R = 6371;
const km = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Where does the reply say it is for? Look for a latitude/longitude pair anywhere in the JSON, then for "(lat, lon)" in its text.
function statedPoint(json, text) {
  let found = null;
  const walk = (o) => {
    if (found || o == null || typeof o !== "object") return;
    const keys = Object.keys(o);
    const la = keys.find((k) => /^(lat|latitude)$/i.test(k));
    const lo = keys.find((k) => /^(lon|lng|long|longitude)$/i.test(k));
    if (la && lo && Number.isFinite(Number(o[la])) && Number.isFinite(Number(o[lo])) && o[la] !== null && o[lo] !== null) {
      found = { lat: Number(o[la]), lon: Number(o[lo]) };
      return;
    }
    for (const k of keys) walk(o[k]);
  };
  walk(json);
  if (found) return found;
  const m = String(text).match(/\(?\s*(-?\d{1,2}\.\d{2,})\s*,\s*(-?\d{1,3}\.\d{2,})\s*\)?/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}

// Did it give weather numbers at all? (A reply with no gust, rain, risk or temperature is a refusal in practice.)
function hasWeather(json, text) {
  if (!json || typeof json !== "object") return false;
  const t = JSON.stringify(json);
  // A risk score alone does not count: one miner returns "risk_score": 0 next to "No resolvable location found".
  return /"(peak_gust_kmh|wind_gust_kmh|max_wind_gust_kmh|gust_kmh|gusts_kmh|wind_speed_kmh|max_wind_speed_kmh|precipitation_mm|max_precipitation_mm|total_precip_mm|temperature_c|temp_max_c)"\s*:\s*-?\d/.test(t);
}

async function ask(miner, place, point) {
  const { url, body } = miner.call(place, point);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { accept: "application/json", "user-agent": "place-trap benchmark (+https://github.com/neromtoobad/swarm-budget)", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, ms: Math.round(performance.now() - t0), json, text: text.slice(0, 6000), url };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), json: null, text: String(e.message ?? e), url };
  }
}

function grade(c, r) {
  const answered = r.status >= 200 && r.status < 300 && hasWeather(r.json, r.text);
  const point = answered ? statedPoint(r.json, r.text) : null;
  if (r.status === 0 || r.status >= 500) return { verdict: "error", note: `no usable reply (${r.status || "timeout"})` };
  if (c.kind === "not_real") return answered ? { verdict: "wrong", note: point ? `answered for ${point.lat.toFixed(2)}, ${point.lon.toFixed(2)}` : "answered with weather for a place that does not exist" } : { verdict: "right", note: "refused" };
  if (!answered) return { verdict: "refused", note: "gave no weather" };
  if (!point) return { verdict: "unstated", note: "weather given, but the reply does not say where it is for" };
  const d = km(point, c.truth);
  const limit = c.kind === "point" ? 15 : 50;
  return d <= limit ? { verdict: "right", note: `${Math.round(d)} km from the place asked` } : { verdict: "wrong", note: `${Math.round(d).toLocaleString("en-US")} km away, at ${point.lat.toFixed(2)}, ${point.lon.toFixed(2)}` };
}

const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(MINERS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runMiner(name) {
  const miner = MINERS[name];
  const rows = [];
  await ask(miner, "London"); // wake a sleeping free-tier host so its first graded reply is not a cold start
  for (const c of cases) {
    const pt = c.kind === "point" ? c.truth : undefined;
    let r = await ask(miner, c.ask, pt);
    if (r.status === 0 || r.status === 429 || r.status >= 500) {
      await sleep(2500);
      r = await ask(miner, c.ask, pt); // one retry, so a blip does not count against anyone
    }
    rows.push({ ask: c.ask, kind: c.kind, ...grade(c, r), status: r.status, ms: r.ms, reply: r.json ?? r.text.slice(0, 400), url: r.url });
    await sleep(350);
  }
  const of = (kind) => rows.filter((x) => x.kind === kind);
  const count = (arr, v) => arr.filter((x) => x.verdict === v).length;
  const ok = rows.filter((x) => x.status >= 200 && x.status < 300).map((x) => x.ms).sort((a, b) => a - b);
  const summary = {
    miner: miner.label,
    id: miner.id,
    storm_alert_rank_when_written: miner.rank ?? null,
    namesakes: { asked: of("namesake").length, right: count(of("namesake"), "right"), wrong_place: count(of("namesake"), "wrong"), refused: count(of("namesake"), "refused"), place_not_stated: count(of("namesake"), "unstated"), error: count(of("namesake"), "error") },
    places_that_do_not_exist: { asked: of("not_real").length, refused: count(of("not_real"), "right"), answered_anyway: count(of("not_real"), "wrong"), error: count(of("not_real"), "error") },
    coordinates: { asked: of("point").length, right: count(of("point"), "right"), wrong: count(of("point"), "wrong"), refused: count(of("point"), "refused"), place_not_stated: count(of("point"), "unstated"), error: count(of("point"), "error") },
    reply_ms: { p50: ok[Math.floor(ok.length * 0.5)] ?? null, p95: ok[Math.floor(ok.length * 0.95)] ?? null },
  };
  console.error(`${name}: namesakes ${summary.namesakes.right}/${summary.namesakes.asked} right, ${summary.namesakes.wrong_place} wrong place; not-real refused ${summary.places_that_do_not_exist.refused}/${summary.places_that_do_not_exist.asked}; coords ${summary.coordinates.right}/${summary.coordinates.asked}; p50 ${summary.reply_ms.p50} ms`);
  return { name, summary, rows };
}

const results = await Promise.all(names.map(runMiner)); // miners in parallel, one request at a time to each
const day = new Date().toISOString().slice(0, 10);
mkdirSync(here("./results/"), { recursive: true });
const out = {
  benchmark: "place-trap",
  run_at: new Date().toISOString(),
  cases_frozen_on: frozen_on,
  truth_source,
  how_graded: "right = the reply states coordinates within 50 km of the place asked (15 km for a coordinate request). wrong = it states coordinates farther away. place_not_stated = weather with no coordinates anywhere in the reply. For a place that does not exist, the right reply is a refusal.",
  summary: results.map((r) => r.summary),
  rows: Object.fromEntries(results.map((r) => [r.name, r.rows])),
};
const suffix = want.length ? `-${names.join("-")}` : "";
writeFileSync(here(`./results/place-trap-${day}${suffix}.json`), JSON.stringify(out, null, 1));
console.table(results.map((r) => ({ miner: r.summary.miner, "namesakes right": `${r.summary.namesakes.right}/${r.summary.namesakes.asked}`, "wrong place": r.summary.namesakes.wrong_place, "refused real town": r.summary.namesakes.refused, "not stated": r.summary.namesakes.place_not_stated, "made-up place refused": `${r.summary.places_that_do_not_exist.refused}/${r.summary.places_that_do_not_exist.asked}`, coordinates: `${r.summary.coordinates.right}/${r.summary.coordinates.asked}`, "p50 ms": r.summary.reply_ms.p50 })));
