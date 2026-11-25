// Pinpoint Weather: a Telegraph miner for four weather intents. No framework, no keys, no database.
//
//   GET /storm-alert?location=Kerman, California&window_hours=24     STORM_ALERT_GENERAL
//   GET /forecast?location=Kerman, California&window_hours=24        WEATHER_FORECAST_GENERAL
//   GET /verify?location=Kerman, California&date=2026-11-15          WEATHER_FORECAST_VERIFY_GENERAL
//   GET /temperature?location=Kerman, California                     WEATHER_CHECK_TEMPERATURE
//   GET /resolve?location=Paris, Texas                               which place would this be? (free helper)
//   GET /health                                                      uptime, counts and latency since start
//
// A request it cannot answer correctly is refused with a reason (4xx) so the buyer is not charged.

import http from "node:http";
import { readFileSync } from "node:fs";
import { resolvePlace, placeBlock, PlaceError } from "./places.mjs";
import { stormAlert, forecast, verifyDay, temperatureNow, RequestError } from "./weather.mjs";
import { UpstreamError, cacheStats } from "./http.mjs";
import { BANDS } from "./risk.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const STARTED = Date.now();
const VERSION = "1.0.0";

const ROUTES = {
  "/storm-alert": { intent: "STORM_ALERT_GENERAL", run: (place, p) => stormAlert(place, p) },
  "/forecast": { intent: "WEATHER_FORECAST_GENERAL", run: (place, p) => forecast(place, p) },
  "/verify": { intent: "WEATHER_FORECAST_VERIFY_GENERAL", run: (place, p) => verifyDay(place, p) },
  "/temperature": { intent: "WEATHER_CHECK_TEMPERATURE", run: (place) => temperatureNow(place) },
};

// ----- counters for /health (in memory; they reset when the process restarts) -----
const stats = {};
const lat = {}; // path -> last 500 durations
function record(path, status, ms) {
  const s = (stats[path] ??= { answered: 0, refused: 0, upstream_failures: 0, errors: 0 });
  if (status < 300) s.answered++;
  else if (status < 500) s.refused++;
  else if (status === 502) s.upstream_failures++;
  else s.errors++;
  if (status < 300) {
    const a = (lat[path] ??= []);
    a.push(ms);
    if (a.length > 500) a.shift();
  }
}
const pct = (arr, p) => {
  if (!arr?.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

function send(res, status, body, extraHeaders = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(text);
}

async function readBody(req) {
  if (req.method !== "POST") return {};
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 16 * 1024) throw new RequestError("body_too_large", "The request body is limited to 16 KB.", {}, 413);
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    throw new RequestError("bad_json", "The request body is not valid JSON.", {}, 400);
  }
}

function refusal(e) {
  if (e instanceof PlaceError || e instanceof RequestError) return { status: e.status, body: { error: e.code, message: e.message, ...e.extra, charged: "A refused request is not a delivered answer. Telegraph does not bill a call the miner answers with an error." } };
  if (e instanceof UpstreamError) return { status: 502, body: { error: "upstream_unavailable", message: `A weather source did not answer: ${e.message}. Nothing was guessed. Try again shortly.` } };
  console.error("unexpected", e);
  return { status: 500, body: { error: "internal_error", message: "Something went wrong inside the miner. Nothing was guessed." } };
}

let homePage;
const home = () => (homePage ??= readFileSync(new URL("./home.html", import.meta.url), "utf8"));
let yamlText;
const yaml = () => (yamlText ??= readFileSync(new URL("../pinpoint-weather.yaml", import.meta.url), "utf8"));

const server = http.createServer(async (req, res) => {
  const t0 = performance.now();
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (req.method === "OPTIONS") return send(res, 204, "", { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" });
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "method_not_allowed", message: "Use GET or POST." });

  try {
    if (path === "/") return send(res, 200, home());
    if (path === "/miner.yaml") return send(res, 200, yaml(), { "content-type": "text/yaml; charset=utf-8" });
    if (path === "/health") {
      const latency = Object.fromEntries(Object.entries(lat).map(([k, a]) => [k, { samples: a.length, p50_ms: pct(a, 50), p95_ms: pct(a, 95) }]));
      return send(res, 200, { ok: true, version: VERSION, uptime_seconds: Math.round((Date.now() - STARTED) / 1000), started_at: new Date(STARTED).toISOString(), requests: stats, latency, cache: cacheStats });
    }
    if (path === "/method") return send(res, 200, { risk_bands: BANDS, levels: "0-0.25 LOW, 0.25-0.5 MODERATE, 0.5-0.75 HIGH, 0.75-1 SEVERE", note: "risk_score is the highest factor score. See README for the full rule." });

    const body = await readBody(req);
    const q = { ...Object.fromEntries(url.searchParams), ...body };
    // Accept the common spellings other weather miners use, so a caller's existing request keeps working.
    const params = {
      location: q.location ?? q.place ?? q.city ?? q.q ?? (q.lat != null && (q.lon ?? q.lng) != null ? `${q.lat},${q.lon ?? q.lng}` : q.latitude != null && q.longitude != null ? `${q.latitude},${q.longitude}` : undefined),
      question: q.question ?? q.query ?? q.prompt,
      window_hours: q.window_hours ?? q.hours ?? q.window,
      date: q.date ?? q.day,
    };

    if (path === "/resolve") {
      const place = await resolvePlace(params);
      const ms = Math.round(performance.now() - t0);
      record(path, 200, ms);
      return send(res, 200, { location: place.location, place: placeBlock(place) }, { "x-response-ms": String(ms) });
    }

    const route = ROUTES[path];
    if (!route) return send(res, 404, { error: "not_found", message: "Endpoints: /storm-alert, /forecast, /verify, /temperature, /resolve, /health." });

    const place = await resolvePlace(params);
    const answer = await route.run(place, params);
    const ms = Math.round(performance.now() - t0);
    record(path, 200, ms);
    return send(res, 200, { intent: route.intent, ...answer }, { "x-response-ms": String(ms) });
  } catch (e) {
    const { status, body } = refusal(e);
    const ms = Math.round(performance.now() - t0);
    record(path, status, ms);
    return send(res, status, body, { "x-response-ms": String(ms) });
  }
});

server.listen(PORT, () => console.log(`pinpoint-weather listening on :${PORT}`));

// Keep the connections to the sources warm, so the first buyer after a quiet spell does not pay for a
// fresh TLS handshake (about 3 seconds for api.weather.gov). One tiny request to each, every 4 minutes.
const WARM = [
  "https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m",
  "https://geocoding-api.open-meteo.com/v1/search?name=London&count=1",
  "https://api.weather.gov/alerts/active/count",
  "https://archive-api.open-meteo.com/v1/archive?latitude=0&longitude=0&start_date=2026-01-01&end_date=2026-01-01&daily=temperature_2m_max",
];
const warm = () => WARM.forEach((u) => fetch(u, { headers: { "User-Agent": "pinpoint-weather-miner/1.0 (+https://github.com/neromtoobad/swarm-budget)" }, signal: AbortSignal.timeout(8000) }).then((r) => r.arrayBuffer()).catch(() => {}));
if (process.env.NO_WARM !== "1") {
  warm();
  setInterval(warm, 4 * 60e3).unref();
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
