// Record accuracy: how close is /verify to what weather stations measured?
//
//   node bench/record-accuracy.mjs
//
// For 40 cities, find the nearest NOAA GHCN-Daily station that carries a WMO number (an airport or
// synoptic station), ask the miner for the recorded weather AT THE STATION'S COORDINATES on five fixed
// past days, and compare with the station's own daily maximum, minimum and precipitation from NOAA's
// public archive (no key). The miner's numbers are a reanalysis grid-cell estimate, so some error is
// expected; this measures how much.
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "https://pinpoint.nerom.site";
const DATES = ["2026-10-05", "2026-10-15", "2026-10-25", "2026-11-04", "2026-11-12"];
const CITIES = [
  ["New York", 40.7128, -74.006], ["Los Angeles", 34.0522, -118.2437], ["Chicago", 41.8781, -87.6298], ["Houston", 29.7604, -95.3698],
  ["Phoenix", 33.4484, -112.074], ["Miami", 25.7617, -80.1918], ["Seattle", 47.6062, -122.3321], ["Denver", 39.7392, -104.9903],
  ["Fresno", 36.7378, -119.7871], ["Anchorage", 61.2181, -149.9003], ["Honolulu", 21.3069, -157.8583], ["Toronto", 43.6532, -79.3832],
  ["Vancouver", 49.2827, -123.1207], ["Mexico City", 19.4326, -99.1332], ["London", 51.5074, -0.1278], ["Paris", 48.8566, 2.3522],
  ["Berlin", 52.52, 13.405], ["Madrid", 40.4168, -3.7038], ["Rome", 41.9028, 12.4964], ["Stockholm", 59.3293, 18.0686],
  ["Warsaw", 52.2297, 21.0122], ["Athens", 37.9838, 23.7275], ["Istanbul", 41.0082, 28.9784], ["Moscow", 55.7558, 37.6173],
  ["Cairo", 30.0444, 31.2357], ["Nairobi", -1.2921, 36.8219], ["Johannesburg", -26.2041, 28.0473], ["Dubai", 25.2048, 55.2708],
  ["Delhi", 28.6139, 77.209], ["Mumbai", 19.076, 72.8777], ["Bangkok", 13.7563, 100.5018], ["Singapore", 1.3521, 103.8198],
  ["Hong Kong", 22.3193, 114.1694], ["Tokyo", 35.6762, 139.6503], ["Seoul", 37.5665, 126.978], ["Sydney", -33.8688, 151.2093],
  ["Melbourne", -37.8136, 144.9631], ["Auckland", -36.8509, 174.7645], ["Sao Paulo", -23.5505, -46.6333], ["Buenos Aires", -34.6037, -58.3816],
];

const R = 6371;
const km = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NOAA's station list is a 10 MB fixed-width file; keep a local copy between runs.
mkdirSync(new URL("./.cache/", import.meta.url), { recursive: true });
const listPath = new URL("./.cache/ghcnd-stations.txt", import.meta.url);
if (!existsSync(listPath)) writeFileSync(listPath, await (await fetch("https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt")).text());
const stations = readFileSync(listPath, "utf8")
  .split("\n")
  .filter((l) => l.length > 80 && l.slice(80, 85).trim())
  .map((l) => ({ id: l.slice(0, 11), lat: Number(l.slice(12, 20)), lon: Number(l.slice(21, 30)), name: l.slice(41, 71).trim(), wmo: l.slice(80, 85).trim() }));

const rows = [];
for (const [city, lat, lon] of CITIES) {
  // Try the three nearest WMO stations within 40 km; the first one with data for these dates is used.
  const near = stations.map((s) => ({ ...s, d: km({ lat, lon }, s) })).filter((s) => s.d <= 40).sort((a, b) => a.d - b.d).slice(0, 3);
  let used = null;
  let obs = [];
  for (const s of near) {
    const url = `https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=${s.id}&startDate=${DATES[0]}&endDate=${DATES[DATES.length - 1]}&dataTypes=TMAX,TMIN,PRCP&units=metric&format=json`;
    try {
      const data = await (await fetch(url, { signal: AbortSignal.timeout(30000) })).json();
      const got = (Array.isArray(data) ? data : []).filter((r) => DATES.includes(r.DATE) && r.TMAX != null && r.TMAX !== "");
      if (got.length) {
        used = { ...s, url };
        obs = got;
        break;
      }
    } catch {}
    await sleep(300);
  }
  if (!used) {
    for (const date of DATES) rows.push({ city, date, covered: false, why: near.length ? "the nearby stations have no record for these days" : "no WMO station within 40 km" });
    console.error(`${city}: no station record`);
    continue;
  }
  for (const date of DATES) {
    const o = obs.find((r) => r.DATE === date);
    if (!o) {
      rows.push({ city, date, covered: false, station: used.id, why: "station has no record for this day" });
      continue;
    }
    const res = await fetch(`${BASE}/verify?location=${used.lat},${used.lon}&date=${date}`, { signal: AbortSignal.timeout(30000) });
    const m = await res.json();
    if (!res.ok) {
      rows.push({ city, date, covered: false, station: used.id, why: `miner refused: ${m.error}` });
      continue;
    }
    const num = (v) => (v == null || v === "" ? null : Number(v));
    rows.push({
      city, date, covered: true,
      station: { id: used.id, name: used.name, km_from_city_centre: Math.round(used.d), source: used.url },
      observed: { temp_max_c: num(o.TMAX), temp_min_c: num(o.TMIN), precipitation_mm: num(o.PRCP) },
      miner: { temp_max_c: m.temp_max_c, temp_min_c: m.temp_min_c, precipitation_mm: m.precipitation_mm, record_kind: m.record_kind, second_source_high: m.second_source?.temp_max_c ?? null, sources_agree_on_high: m.sources_agree_on_high },
    });
    await sleep(150);
  }
  console.error(`${city}: ${used.name} (${used.id}, ${Math.round(used.d)} km)`);
}

const cov = rows.filter((r) => r.covered);
const err = (k) => cov.filter((r) => r.observed[k] != null && r.miner[k] != null).map((r) => Math.abs(r.miner[k] - r.observed[k]));
const mean = (a) => (a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)) : null);
const within = (a, t) => (a.length ? Number(((100 * a.filter((x) => x <= t).length) / a.length).toFixed(1)) : null);
const hi = err("temp_max_c");
const lo = err("temp_min_c");
const wet = cov.filter((r) => r.observed.precipitation_mm != null && r.miner.precipitation_mm != null);
const rainAgree = wet.filter((r) => r.observed.precipitation_mm >= 1 === r.miner.precipitation_mm >= 1).length;
const agree = cov.filter((r) => r.miner.sources_agree_on_high === true && r.observed.temp_max_c != null).map((r) => Math.abs(r.miner.temp_max_c - r.observed.temp_max_c));
const disagree = cov.filter((r) => r.miner.sources_agree_on_high === false && r.observed.temp_max_c != null).map((r) => Math.abs(r.miner.temp_max_c - r.observed.temp_max_c));
const summary = {
  city_days_asked: rows.length,
  city_days_with_a_station_record: cov.length,
  daily_high: { compared: hi.length, mean_abs_error_c: mean(hi), within_2c_pct: within(hi, 2), within_3c_pct: within(hi, 3) },
  daily_low: { compared: lo.length, mean_abs_error_c: mean(lo), within_2c_pct: within(lo, 2), within_3c_pct: within(lo, 3) },
  rain_or_dry: { compared: wet.length, same_call_pct: wet.length ? Number(((100 * rainAgree) / wet.length).toFixed(1)) : null, rule: "a wet day is 1 mm or more" },
  when_the_two_sources_agree_on_the_high: { days: agree.length, mean_abs_error_c: mean(agree) },
  when_they_disagree: { days: disagree.length, mean_abs_error_c: mean(disagree) },
};
console.log(JSON.stringify(summary, null, 1));
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/record-accuracy-${new Date().toISOString().slice(0, 10)}.json`, import.meta.url), JSON.stringify({ benchmark: "record-accuracy", run_at: new Date().toISOString(), miner: BASE, dates: DATES, truth: "NOAA GHCN-Daily station records via the NCEI Access Data Service", note: "Stations report a day on their own observation schedule, which is not always local midnight to midnight; that alone moves some days by a degree or two.", summary, rows }, null, 1));
