// Step 2: build the evaluation packs.
//
// Every row is a question, a better answer and a worse answer. Both answers are filled with real public
// forecast or archive data; what differs is one thing a buyer cares about:
//
//   wrong_place     the answer is for a bigger town with the same name, somewhere else
//   wrong_window    the answer covers a different stretch of time than was asked
//   wrong_date      (past-day records) the answer is for another day
//   contradiction   the grade or the words disagree with the answer's own numbers
//   missing         a number the question asked for is not there
//   out_of_range    a value that cannot be right: Kelvin in a Celsius field, a 0-1 score given as 37
//   off_topic       earthquakes or space weather, sent as a storm answer (real feeds; miners registered
//                   on STORM_ALERT_GENERAL serve exactly these)
//   not_a_forecast  only the temperature right now, for a question about the hours ahead
//   not_a_record    a forecast, for a question about what was recorded
//
// The first five rows of each pack are not generated: they are answers the Swarm Budget fleet paid for
// on Telegraph testnet, kept as the node recorded them (data/real-refusals.json).
//
//   node build/pairs.mjs           fetch what is not yet in data/snapshot.json, then write packs/
//   node build/pairs.mjs --offline rebuild from the frozen snapshot only
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { assess, conditionOver, wmoText, bandScore, levelOf, BANDS, LEVELS } from "../../miner/src/risk.mjs";
import { km, resolvePlace } from "../../miner/src/places.mjs";

const here = (p) => new URL(p, import.meta.url);
const offline = process.argv.includes("--offline");
const { cases, majors } = JSON.parse(readFileSync(here("../data/namesakes.json"), "utf8"));
const real = JSON.parse(readFileSync(here("../data/real-refusals.json"), "utf8"));
const snapPath = here("../data/snapshot.json");
const snap = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, "utf8")) : { taken_at: null, calls: {} };

// ---------- deterministic randomness, so the packs rebuild the same ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const shuffle = (r, arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------- data ----------
const fix4 = (n) => Number(Number(n).toFixed(4));
const r1 = (n) => (n == null ? null : Number(Number(n).toFixed(1)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  if (snap.calls[url]) return snap.calls[url];
  if (offline) throw new Error(`not in the snapshot: ${url}`);
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const j = await res.json();
        snap.calls[url] = j.hourly ? { hourly: j.hourly } : j.daily ? { daily: j.daily, timezone: j.timezone } : j;
        await sleep(120);
        return snap.calls[url];
      }
      if (res.status === 429) await sleep(20000);
    } catch {}
    await sleep(1500 * (i + 1));
  }
  throw new Error(`could not fetch ${url}`);
}
// A question only goes in a pack if an ordinary place lookup of its wording lands on the town it is about.
// That keeps out questions that are themselves ambiguous ("Ramnagar, India": there are several).
snap.resolved ??= {};
async function unambiguous(ask, place) {
  if (!(ask in snap.resolved)) {
    if (offline) return false;
    const p = await resolvePlace({ location: ask }).catch(() => null);
    snap.resolved[ask] = p ? { lat: p.lat, lon: p.lon } : null;
  }
  const got = snap.resolved[ask];
  return Boolean(got) && km(got, place) <= 30;
}
const T0 = snap.taken_at ?? new Date(Math.floor(Date.now() / 3600e3) * 3600e3).toISOString().slice(0, 13) + ":00";
snap.taken_at = T0;
const forecastUrl = (p) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${fix4(p.lat)}&longitude=${fix4(p.lon)}&hourly=temperature_2m,precipitation,precipitation_probability,wind_gusts_10m,weather_code&start_hour=${T0}&end_hour=${addHours(T0, 168)}&timezone=UTC`;
const archiveUrl = (p, date) =>
  `https://archive-api.open-meteo.com/v1/archive?latitude=${fix4(p.lat)}&longitude=${fix4(p.lon)}&start_date=${date}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto`;
function addHours(isoHour, h) {
  return new Date(Date.parse(`${isoHour}:00Z`) + h * 3600e3).toISOString().slice(0, 16);
}
const stamp = (isoHour) => `${isoHour}:00Z`.replace(":00:00Z", ":00:00Z");
const nums = (a) => a.filter((v) => v != null);

async function stormFacts(p, N) {
  const h = (await get(forecastUrl(p))).hourly;
  const gust = h.wind_gusts_10m.slice(1, N + 1);
  const rain = h.precipitation.slice(1, N + 1);
  const codes = h.weather_code.slice(0, N + 1);
  const rolling = (arr, w) => {
    let best = 0;
    for (let i = 0; i + Math.min(w, arr.length) <= arr.length; i++) best = Math.max(best, arr.slice(i, i + w).reduce((a, b) => a + (b ?? 0), 0));
    return best;
  };
  const peak = Math.max(...nums(gust));
  const total = nums(rain).reduce((a, b) => a + b, 0);
  const a = assess({ peakGust: peak, precip24h: rolling(rain, 24), precip1h: Math.max(...nums(rain)), snow24h: 0, thunderCodes: [...new Set(nums(codes).filter((c) => c >= 95))], alerts: [] });
  return { loc: p.location, N, start: `${T0}Z`, end: `${addHours(T0, N)}Z`, level: a.risk_level, score: Number(a.risk_score.toFixed(2)), gust: r1(peak), rain: r1(total), thunder: nums(codes).some((c) => c >= 95) };
}
async function forecastFacts(p, N) {
  const h = (await get(forecastUrl(p))).hourly;
  const temp = nums(h.temperature_2m.slice(0, N + 1));
  const prob = nums(h.precipitation_probability.slice(1, N + 1));
  return { loc: p.location, N, start: `${T0}Z`, end: `${addHours(T0, N)}Z`, hi: r1(Math.max(...temp)), lo: r1(Math.min(...temp)), prob: prob.length ? Math.round(Math.max(...prob)) : 0, cond: conditionOver(nums(h.weather_code.slice(0, N + 1))), now: r1(h.temperature_2m[0]) };
}
async function dayFacts(p, date) {
  const d = (await get(archiveUrl(p, date))).daily;
  if (d.temperature_2m_max?.[0] == null) return null;
  return { loc: p.location, date, hi: r1(d.temperature_2m_max[0]), lo: r1(d.temperature_2m_min[0]), rain: r1(d.precipitation_sum[0] ?? 0), cond: wmoText(d.weather_code[0]) ?? "Not reported" };
}

// ---------- how an answer is written ----------
// Style 0 is the node's own processed-answer shape (what the Swarm Budget fleet received on testnet);
// the others are the ways miners word the same fields. Both answers of a pair always use one style.
const NA = ["not available", "n/a", "unknown", "no data", "not reported", "unavailable"];
const show = (v, r, unit = "") => (v == null ? pick(r, NA) : `${v}${unit}`);
const STORM_STYLES = [
  (f) => JSON.stringify({ location: f.loc, risk_score: f.score, risk_level: f.level, peak_gust_kmh: f.gust, precipitation_mm: f.rain, window: f.window === null ? null : `${f.start} to ${f.end} (${f.N} hours)` }),
  (f) => JSON.stringify({ location: f.loc, risk_score: f.score, risk_level: f.level, peak_gust_kmh: f.gust, precipitation_mm: f.rain, window: f.window === null ? null : `${f.start}/${f.end}` }),
  (f, r) => `${f.loc}. Storm risk ${show(f.level, r)} (score ${show(f.score, r)}) for ${f.start} to ${f.end}. Peak gust ${show(f.gust, r, " km/h")}, total precipitation ${show(f.rain, r, " mm")}, ${f.thunder ? "thunderstorms forecast" : "no thunderstorms forecast"}.`,
  (f, r) => `Over the ${f.N} hours from ${f.start}, ${f.loc} has a ${show(f.level, r)} storm risk (${show(f.score, r)} on a 0 to 1 scale): gusts up to ${show(f.gust, r, " km/h")} and ${show(f.rain, r, " mm")} of precipitation in total.`,
  (f, r) => `location: ${f.loc}\nwindow: ${f.start}/${f.end}\nrisk_level: ${show(f.level, r)}\nrisk_score: ${show(f.score, r)}\npeak_gust_kmh: ${show(f.gust, r)}\nprecipitation_mm: ${show(f.rain, r)}`,
  (f, r) => `${show(f.level, r)} risk. ${f.loc}, ${f.start} to ${f.end}: strongest gust ${show(f.gust, r, " km/h")}, precipitation ${show(f.rain, r, " mm")}${f.thunder ? ", thunderstorm in the forecast" : ""}. Risk score ${show(f.score, r)}.`,
];
const FORECAST_STYLES = [
  (f) => JSON.stringify({ location: f.loc, when: f.when === null ? null : `${f.start}/${f.end}`, temp_max_c: f.hi, temp_min_c: f.lo, precipitation_probability_pct: f.prob, condition: f.cond }),
  (f) => JSON.stringify({ location: f.loc, when: f.when === null ? null : `the next ${f.N} hours, from ${f.start}`, temp_max_c: f.hi, temp_min_c: f.lo, precipitation_probability_pct: f.prob, condition: f.cond }),
  (f, r) => `${f.loc}, ${f.start} to ${f.end}: ${f.cond ?? pick(r, NA)}. High ${show(f.hi, r, " °C")}, low ${show(f.lo, r, " °C")}, chance of precipitation up to ${show(f.prob, r, "%")}.`,
  (f, r) => `Forecast for ${f.loc} over the ${f.N} hours from ${f.start}: high of ${show(f.hi, r, " °C")}, low of ${show(f.lo, r, " °C")}, peak rain chance ${show(f.prob, r, "%")}, ${String(f.cond ?? pick(r, NA)).toLowerCase()}.`,
  (f, r) => `location: ${f.loc}\nwhen: ${f.start}/${f.end}\ntemp_max_c: ${show(f.hi, r)}\ntemp_min_c: ${show(f.lo, r)}\nprecipitation_probability_pct: ${show(f.prob, r)}\ncondition: ${f.cond ?? pick(r, NA)}`,
];
const DAY_STYLES = [
  (f) => JSON.stringify({ location: f.loc, date: f.date, temp_max_c: f.hi, temp_min_c: f.lo, precipitation_mm: f.rain, condition: f.cond }),
  (f, r) => `${f.loc} on ${f.date}: recorded high ${show(f.hi, r, " °C")}, low ${show(f.lo, r, " °C")}, ${show(f.rain, r, " mm")} of precipitation, ${String(f.cond ?? pick(r, NA)).toLowerCase()}.`,
  (f, r) => `Recorded weather for ${f.loc}, ${f.date}. Maximum temperature: ${show(f.hi, r, " °C")}. Minimum temperature: ${show(f.lo, r, " °C")}. Precipitation: ${show(f.rain, r, " mm")}. Conditions: ${f.cond ?? pick(r, NA)}.`,
  (f, r) => `location: ${f.loc}\ndate: ${f.date}\ntemp_max_c: ${show(f.hi, r)}\ntemp_min_c: ${show(f.lo, r)}\nprecipitation_mm: ${show(f.rain, r)}\ncondition: ${f.cond ?? pick(r, NA)}`,
];
const styleOf = (r, styles) => (r() < 0.55 ? Math.floor(r() * 2) % Math.min(2, styles.length) : 2 + Math.floor(r() * (styles.length - 2)));

// ---------- how a question is asked ----------
// An optional opening and closing line around each question, so no two prompts read alike. The closing
// lines also ask for what a careful buyer wants: the place and the window the answer is for.
const OPENERS = ["", "", "", "I run a small orchard.", "Logistics check.", "Fleet control here.", "Quick one for the harvest team:", "We have a roofing job booked.", "A market stall sets up outdoors tomorrow.", "School sports day is planned.", "Our crane crew needs a go or no-go.", "For a delivery route plan:", "Checking before we irrigate.", "Site safety briefing.", "A film crew is shooting outside.", "Our fishing co-op wants to know.", "Drone survey planning.", "Greenhouse vents are on manual today.", "The cold-chain truck leaves soon.", "Vineyard netting goes up this week."];
const CLOSERS = ["", "", "", "Answer for that exact town.", "Please state the place and coordinates you used.", "Use UTC for any times.", "Numbers in metric units, please.", "Include the period your answer covers.", "Keep it to the facts.", "One line is fine.", "This is for an automated system.", "Say which location the answer is for.", "No commentary, just the values.", "If you cannot tell which place I mean, say so."];
const wrap = (r, q) => [pick(r, OPENERS), q, pick(r, CLOSERS)].filter(Boolean).join(" ");
const span = (N, r) => (N % 24 === 0 && r() < 0.5 ? (N === 24 ? "24 hours" : `${N / 24} days`) : `${N} hours`);
const STORM_Q = [
  (P, S) => `What is the storm risk in ${P} over the next ${S}?`,
  (P, S) => `Is any severe weather expected around ${P} in the coming ${S}?`,
  (P, S) => `A crop-spraying drone is scheduled near ${P}. How strong will gusts get in the next ${S}, and what is the overall storm risk?`,
  (P, S) => `Storm outlook for ${P}, next ${S}: risk level, peak gust and rainfall.`,
  (P, S) => `Should outdoor work in ${P} be postponed because of wind or heavy rain during the next ${S}?`,
  (P, S) => `Give the weather-disruption risk for ${P} for the next ${S}, with the strongest gust in km/h and total precipitation in mm.`,
  (P, S) => `We are loading a truck in ${P}. Any storm, gale or heavy rain warning for the next ${S}?`,
  (P, S) => `How windy and how wet will it get in ${P} within the next ${S}? Grade the storm risk as LOW, MODERATE, HIGH or SEVERE.`,
  (P, S) => `Storm alert check for ${P}: is it safe to fly a survey drone at any point in the next ${S}?`,
  (P, S) => `Will gale-force gusts or flooding rain hit ${P} in the next ${S}?`,
  (P, S) => `Assess the storm risk at ${P} for the next ${S}, starting now.`,
  (P, S) => `An irrigation rover near ${P} must decide whether to stay out. What are the peak gust and the rain total for the next ${S}?`,
  (P, S) => `Is there a storm risk in ${P} in the next ${S}?`,
  (P, S) => `Over the next ${S}, what is the worst wind gust forecast for ${P}, and how much rain is expected?`,
  (P, S) => `Harvest crew in ${P} wants to know: any thunderstorms or damaging wind in the next ${S}?`,
  (P, S) => `Report storm risk score, risk level, peak gust and precipitation for ${P} covering the next ${S}.`,
];
const FORECAST_Q = [
  (P, S) => `What is the weather forecast for ${P} for the next ${S}?`,
  (P, S) => `How hot and how cold will it get in ${P} over the next ${S}, and what is the chance of rain?`,
  (P, S) => `Forecast for ${P}, next ${S}: high, low, precipitation probability and conditions.`,
  (P, S) => `Will it rain in ${P} in the next ${S}? Include the expected high and low in Celsius.`,
  (P, S) => `A field crew starts work in ${P} shortly. What should they expect for the next ${S}?`,
  (P, S) => `Give the maximum and minimum temperature and the peak chance of precipitation for ${P} during the next ${S}.`,
  (P, S) => `What will the weather be like in ${P} in the coming ${S}?`,
  (P, S) => `Planning deliveries in ${P}: temperatures and rain chance for the next ${S}, please.`,
  (P, S) => `Do I need rain cover for equipment left outside in ${P} over the next ${S}? Give highs, lows and rain probability.`,
  (P, S) => `For ${P}: forecast high and low temperature and the likelihood of precipitation within the next ${S}.`,
  (P, S) => `Is frost or heavy rain likely in ${P} in the next ${S}? What are the forecast high and low?`,
  (P, S) => `Weather outlook for ${P}, covering the next ${S} from now.`,
  (P, S) => `What conditions should a greenhouse operator in ${P} plan for over the next ${S}?`,
  (P, S) => `For the next ${S} in ${P}, what is the temperature range and how likely is rain?`,
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sayDate = (d, r) => {
  const [y, m, day] = d.split("-").map(Number);
  const k = r();
  return k < 0.4 ? d : k < 0.7 ? `${day} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${day}, ${y}`;
};
const DAY_Q = [
  (P, D) => `What were the recorded high and low temperatures in ${P} on ${D}?`,
  (P, D) => `Did it rain in ${P} on ${D}, and how much?`,
  (P, D, f) => `A forecast said ${P} would reach ${Math.round(f.hi + 3)} °C on ${D}. What was actually recorded?`,
  (P, D) => `Verify the weather for ${P} on ${D}: maximum and minimum temperature, precipitation and conditions.`,
  (P, D) => `How much precipitation fell in ${P} on ${D}? Include the day's high and low.`,
  (P, D, f) => `Yesterday's forecast for ${D} called for ${Math.max(1, Math.round(f.rain + 4))} mm of rain in ${P}. How much fell, and did it verify?`,
  (P, D) => `What was the weather in ${P} on ${D}?`,
  (P, D) => `An insurance claim says it was stormy in ${P} on ${D}. What do the records show for temperature and rain?`,
  (P, D) => `Recorded conditions in ${P} for ${D}, please: high, low, rainfall.`,
  (P, D, f) => `Was the forecast low of ${Math.round(f.lo - 2)} °C for ${P} on ${D} correct? Give the recorded values.`,
  (P, D) => `For a crop log: maximum temperature, minimum temperature and rainfall at ${P} on ${D}.`,
];

// ---------- real feeds for off-topic answers ----------
async function hazards() {
  const quakes = (await get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson")).features ?? [];
  const kp = await get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
  return { quakes: quakes.map((q) => ({ mag: q.properties.mag, place: q.properties.place, time: new Date(q.properties.time).toISOString().slice(0, 16) + "Z", lat: q.geometry.coordinates[1], lon: q.geometry.coordinates[0] })).filter((q) => q.mag && q.place), kp: Array.isArray(kp) ? kp.slice(1).map((row) => ({ time: row[0], kp: Number(row[1]) })).filter((x) => Number.isFinite(x.kp)) : [] };
}

// ---------- building ----------
const out = { STORM_ALERT_GENERAL: [], WEATHER_FORECAST_GENERAL: [], WEATHER_FORECAST_VERIFY_GENERAL: [] };
const add = (intent, row, meta) => out[intent].push({ row: { prompt: row.prompt, chosen: row.chosen, rejected: row.rejected, label_kind: "preference_pair", provenance: row.provenance }, meta });
const WINDOWS = [6, 12, 18, 24, 36, 48, 72, 96, 120];
const askOf = (r, c) => (c.ask_variants && r() < 0.35 ? pick(r, c.ask_variants) : c.ask);

// A fifth of the wrong-place rows ask for the BIG town by its full name, and the worse answer is the small
// one. Otherwise "the smaller place is always right" would be a shortcut.
function placePair(r, c) {
  if (r() < 0.2) {
    const big = c.trap;
    const ask = big.country_code === "US" && big.admin1 ? `${big.name}, ${big.admin1}` : `${big.name}, ${big.country}`;
    return { ask, place: big, other: c.place, reversed: true };
  }
  return { ask: askOf(r, c), place: c.place, other: c.trap, reversed: false };
}

async function buildStorm(n, seed) {
  const r = rng(seed);
  const hz = await hazards();
  const pool = shuffle(r, cases);
  const plan = ["wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_window", "wrong_window", "wrong_window", "contradiction", "contradiction", "contradiction", "missing", "missing", "out_of_range", "out_of_range", "off_topic", "off_topic"];
  let i = 0;
  while (out.STORM_ALERT_GENERAL.length < n && i < pool.length) {
    const c = pool[i++];
    const kind = plan[out.STORM_ALERT_GENERAL.length % plan.length];
    const N = pick(r, WINDOWS);
    const style = STORM_STYLES[styleOf(r, STORM_STYLES)];
    try {
      const { ask, place, other, reversed } = kind === "wrong_place" ? placePair(r, c) : { ask: askOf(r, c), place: c.place, other: null, reversed: false };
      if (!(await unambiguous(ask, place))) continue;
      const good = await stormFacts(place, N);
      let bad;
      let note;
      if (kind === "wrong_place") {
        bad = await stormFacts(other, N);
        note = `${Math.round(km(place, other)).toLocaleString("en-US")} km from the place asked`;
      } else if (kind === "wrong_window") {
        const M = N <= 24 ? pick(r, [120, 144, 168]) : pick(r, [3, 6]);
        bad = await stormFacts(place, M);
        note = `covers ${M} hours, asked ${N}`;
      } else if (kind === "contradiction") {
        // What the gust and the rain total allow: from "the rain fell evenly" to "it all came in one day".
        // The false grade sits at least two steps outside that range, so the clash is plain from the
        // answer's own numbers.
        const g = bandScore(good.gust, BANDS.gust_kmh);
        const lowest = LEVELS.indexOf(levelOf(Math.max(g, bandScore(good.rain / Math.max(1, N / 24), BANDS.precip_24h_mm))));
        const highest = LEVELS.indexOf(levelOf(Math.max(g, bandScore(good.rain, BANDS.precip_24h_mm))));
        if (highest <= 1) bad = { ...good, level: "SEVERE", score: Number((0.84 + r() * 0.14).toFixed(2)) };
        else if (lowest >= 2) bad = { ...good, level: "LOW", score: Number((0.02 + r() * 0.1).toFixed(2)) };
        else continue;
        note = `the numbers read as ${LEVELS[lowest]}${highest > lowest ? ` to ${LEVELS[highest]}` : ""}, the grade says ${bad.level}`;
      } else if (kind === "missing") {
        const drop = pick(r, ["gust", "rain", "grade", "all"]);
        bad = { ...good };
        if (drop === "gust" || drop === "all") bad.gust = null;
        if (drop === "rain" || drop === "all") bad.rain = null;
        if (drop === "grade") (bad.level = null), (bad.score = null);
        if (drop === "all") (bad.window = null), (bad.loc = r() < 0.5 ? null : bad.loc);
        note = `missing: ${drop}`;
      } else if (kind === "out_of_range") {
        const how = pick(r, ["score_percent", "level_not_in_list", "gust_absurd", "rain_negative"]);
        bad = { ...good };
        if (how === "score_percent") bad.score = Math.max(3, Math.round(good.score * 100));
        if (how === "level_not_in_list") bad.level = pick(r, ["ORANGE", "Level 3", "Elevated", "Medium-High", "4/5", "Code Yellow", "Amber"]);
        if (how === "gust_absurd") bad.gust = Math.round(900 + r() * 2400);
        if (how === "rain_negative") bad.rain = -r1(1 + r() * 30);
        note = how.replaceAll("_", " ");
      } else {
        if (r() < 0.6 && hz.quakes.length) {
          const q = hz.quakes[Math.floor(r() * hz.quakes.length)];
          const d = Math.round(km(place, q));
          bad = { text: `${good.loc}. No seismic alert for this location: the M${q.mag} earthquake ${q.place} at ${q.time} was ${d.toLocaleString("en-US")} km away. USGS lists ${hz.quakes.length} events of magnitude 2.5 or more in the past week.` };
        } else if (hz.kp.length) {
          const k = hz.kp[Math.floor(r() * hz.kp.length)];
          bad = { text: `${good.loc}. Geomagnetic storm level: planetary K-index ${k.kp} at ${k.time} UTC (${k.kp >= 5 ? "storm" : k.kp >= 4 ? "active" : "quiet"}), NOAA scale ${k.kp >= 5 ? `G${Math.min(5, Math.round(k.kp) - 4)}` : "G0"}. No solar radiation storm in progress for the ${N}-hour window.` };
        } else continue;
        note = "a different hazard, not weather";
      }
      const prompt = wrap(r, pick(r, STORM_Q)(ask, span(N, r)));
      const chosen = style(good, r);
      const rejected = bad.text ?? style(bad, r);
      if (chosen === rejected) continue;
      add("STORM_ALERT_GENERAL", { prompt, chosen, rejected, provenance: { source_kind: "public_api", source_url: forecastUrl(place) } }, { kind, asked: ask, place: place.location, other: other?.location ?? null, reversed, window_hours: N, note });
    } catch (e) {
      console.error("skip", c.ask, e.message);
    }
  }
}

async function buildForecast(n, seed) {
  const r = rng(seed);
  const pool = shuffle(r, cases);
  const plan = ["wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_window", "wrong_window", "wrong_window", "contradiction", "contradiction", "contradiction", "missing", "missing", "out_of_range", "out_of_range", "not_a_forecast", "not_a_forecast"];
  let i = 0;
  while (out.WEATHER_FORECAST_GENERAL.length < n && i < pool.length) {
    const c = pool[i++];
    const kind = plan[out.WEATHER_FORECAST_GENERAL.length % plan.length];
    const N = pick(r, WINDOWS);
    const style = FORECAST_STYLES[styleOf(r, FORECAST_STYLES)];
    try {
      const { ask, place, other, reversed } = kind === "wrong_place" ? placePair(r, c) : { ask: askOf(r, c), place: c.place, other: null, reversed: false };
      if (!(await unambiguous(ask, place))) continue;
      const good = await forecastFacts(place, N);
      let bad;
      let note;
      if (kind === "wrong_place") {
        bad = await forecastFacts(other, N);
        note = `${Math.round(km(place, other)).toLocaleString("en-US")} km from the place asked`;
      } else if (kind === "wrong_window") {
        const M = N <= 24 ? pick(r, [120, 144, 168]) : pick(r, [3, 6]);
        bad = await forecastFacts(place, M);
        note = `covers ${M} hours, asked ${N}`;
      } else if (kind === "contradiction") {
        const clear = good.prob >= 70 || good.prob <= 10; // only then do the words plainly clash with the rain chance
        if ((r() < 0.5 || !clear) && good.hi - good.lo >= 2) {
          bad = { ...good, hi: good.lo, lo: good.hi };
          note = "the high is below the low";
        } else if (!clear) {
          continue;
        } else {
          const wet = good.prob >= 70;
          bad = { ...good, cond: wet ? pick(r, ["Clear sky", "Sunny and dry", "Mainly clear"]) : pick(r, ["Heavy rain", "Thunderstorm with heavy hail", "Violent rain showers", "Heavy snow"]) };
          note = `the words say "${bad.cond}", the rain chance is ${good.prob}%`;
        }
      } else if (kind === "missing") {
        const drop = pick(r, ["temps", "prob", "cond", "all"]);
        bad = { ...good };
        if (drop === "temps") (bad.hi = null), (bad.lo = null);
        if (drop === "prob" || drop === "all") bad.prob = null;
        if (drop === "cond" || drop === "all") bad.cond = null;
        if (drop === "all") (bad.when = null), (bad.loc = r() < 0.5 ? null : bad.loc);
        note = `missing: ${drop}`;
      } else if (kind === "out_of_range") {
        const how = pick(r, ["kelvin", "prob_over_100", "prob_negative"]);
        bad = { ...good };
        if (how === "kelvin") (bad.hi = r1(good.hi + 273.15)), (bad.lo = r1(good.lo + 273.15));
        if (how === "prob_over_100") bad.prob = 100 + Math.round(10 + r() * 150);
        if (how === "prob_negative") bad.prob = -Math.round(5 + r() * 40);
        note = how.replaceAll("_", " ");
      } else {
        bad = { text: pick(r, [`It is currently ${good.now} °C in ${good.loc}.`, `${good.loc}: ${good.now} °C right now, observed at ${good.start}.`, JSON.stringify({ location: good.loc, temperature_c: good.now, observed_at: good.start }), `Current conditions for ${good.loc} as of ${good.start}: air temperature ${good.now} °C.`]) };
        note = "the temperature now, not a forecast";
      }
      const prompt = wrap(r, pick(r, FORECAST_Q)(ask, span(N, r)));
      const chosen = style(good, r);
      const rejected = bad.text ?? style(bad, r);
      if (chosen === rejected) continue;
      add("WEATHER_FORECAST_GENERAL", { prompt, chosen, rejected, provenance: { source_kind: "public_api", source_url: forecastUrl(place) } }, { kind, asked: ask, place: place.location, other: other?.location ?? null, reversed, window_hours: N, note });
    } catch (e) {
      console.error("skip", c.ask, e.message);
    }
  }
}

async function buildDays(n, seed) {
  const r = rng(seed);
  const pool = shuffle(r, cases);
  const plan = ["wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_place", "wrong_date", "wrong_date", "wrong_date", "wrong_date", "missing", "missing", "out_of_range", "out_of_range", "contradiction", "not_a_record", "not_a_record"];
  const first = Date.parse("2026-08-20T00:00:00Z");
  const days = 80; // 20 Aug to 7 Nov 2026: long past, so the archive is final
  const anyDay = () => new Date(first + Math.floor(r() * days) * 86400e3).toISOString().slice(0, 10);
  let i = 0;
  while (out.WEATHER_FORECAST_VERIFY_GENERAL.length < n && i < pool.length) {
    const c = pool[i++];
    const kind = plan[out.WEATHER_FORECAST_VERIFY_GENERAL.length % plan.length];
    const date = anyDay();
    const style = DAY_STYLES[r() < 0.55 ? 0 : 1 + Math.floor(r() * (DAY_STYLES.length - 1))];
    try {
      const { ask, place, other, reversed } = kind === "wrong_place" ? placePair(r, c) : { ask: askOf(r, c), place: c.place, other: null, reversed: false };
      if (!(await unambiguous(ask, place))) continue;
      const good = await dayFacts(place, date);
      if (!good) continue;
      let bad;
      let note;
      if (kind === "wrong_place") {
        bad = await dayFacts(other, date);
        if (!bad) continue;
        note = `${Math.round(km(place, other)).toLocaleString("en-US")} km from the place asked`;
      } else if (kind === "wrong_date") {
        let d2 = anyDay();
        while (Math.abs(Date.parse(d2) - Date.parse(date)) < 5 * 86400e3) d2 = anyDay();
        bad = await dayFacts(place, d2);
        if (!bad) continue;
        note = `record for ${d2}, asked ${date}`;
      } else if (kind === "missing") {
        const drop = pick(r, ["temps", "rain", "all"]);
        bad = { ...good };
        if (drop === "temps" || drop === "all") (bad.hi = null), (bad.lo = null);
        if (drop === "rain" || drop === "all") bad.rain = null;
        if (drop === "all") bad.cond = null;
        note = `missing: ${drop}`;
      } else if (kind === "out_of_range") {
        const how = pick(r, ["kelvin", "rain_negative"]);
        bad = { ...good };
        if (how === "kelvin") (bad.hi = r1(good.hi + 273.15)), (bad.lo = r1(good.lo + 273.15));
        if (how === "rain_negative") bad.rain = -r1(0.5 + r() * 25);
        note = how.replaceAll("_", " ");
      } else if (kind === "contradiction") {
        if (good.hi - good.lo < 2) continue;
        bad = { ...good, hi: good.lo, lo: good.hi };
        note = "the recorded high is below the low";
      } else {
        bad = { text: pick(r, [`The forecast for ${good.loc} on ${date} called for a high near ${good.hi} °C and a low near ${good.lo} °C. Observations for that date are not available.`, `${good.loc}, ${date}: expected high ${good.hi} °C, expected low ${good.lo} °C, expected precipitation ${good.rain} mm (forecast values issued the day before).`, JSON.stringify({ location: good.loc, date, forecast_temp_max_c: good.hi, forecast_temp_min_c: good.lo, forecast_precipitation_mm: good.rain, note: "forecast, not observed" })]) };
        note = "a forecast, not what was recorded";
      }
      const prompt = wrap(r, pick(r, DAY_Q)(ask, sayDate(date, r), good));
      const chosen = style(good, r);
      const rejected = bad.text ?? style(bad, r);
      if (chosen === rejected) continue;
      add("WEATHER_FORECAST_VERIFY_GENERAL", { prompt, chosen, rejected, provenance: { source_kind: "public_api", source_url: archiveUrl(place, date) } }, { kind, asked: ask, place: place.location, other: other?.location ?? null, reversed, date, note });
    } catch (e) {
      console.error("skip", c.ask, e.message);
    }
  }
}

// Real paid answers first.
for (const x of real.rows) add(x.intent, { prompt: x.prompt, chosen: x.chosen, rejected: x.rejected, provenance: { source_kind: "telegraph_signal", source_url: x.rejected_signal_url } }, { kind: x.kind, asked: x.asked, place: x.place, other: x.other ?? null, real_traffic: true, note: x.note, chosen_signal_url: x.chosen_signal_url });

const N_STORM = Number(process.env.N_STORM ?? 220);
const N_FORECAST = Number(process.env.N_FORECAST ?? 220);
const N_DAYS = Number(process.env.N_DAYS ?? 130);
await buildStorm(N_STORM, 20261125);
await buildForecast(N_FORECAST, 20261126);
await buildDays(N_DAYS, 20261127);
if (!offline) writeFileSync(snapPath, JSON.stringify(snap));

// Hold out a fifth of the PLACES (not rows) for measurement: a checker never sees a held-out town in training.
const held = (place) => {
  let h = 0;
  for (const ch of String(place)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 5 === 0;
};
for (const [intent, rows] of Object.entries(out)) {
  const seen = new Set();
  const kept = rows.filter((x) => !seen.has(x.row.prompt) && seen.add(x.row.prompt));
  writeFileSync(here(`../packs/${intent}.jsonl`), kept.map((x) => JSON.stringify(x.row)).join("\n") + "\n");
  writeFileSync(here(`../packs/${intent}.meta.jsonl`), kept.map((x, i) => JSON.stringify({ line: i + 1, split: x.meta.real_traffic || held(x.meta.place) ? "heldout" : "train", ...x.meta })).join("\n") + "\n");
  const by = {};
  for (const x of kept) by[x.meta.kind] = (by[x.meta.kind] ?? 0) + 1;
  console.log(intent, kept.length, "rows", JSON.stringify(by));
}
