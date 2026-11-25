// A reference checker for weather answers: explicit, published rules, no model.
//
// It reads a question and an answer the way a careful buyer would and scores the answer from 0 to 1:
//   place        is the answer about the place that was asked? (by coordinates when given, else by name)
//   time         does it cover the hours, or the day, that were asked?
//   complete     are the numbers the question asked for there?
//   in_range     can each value be true? (a 0-1 score of 37, 289 "degrees Celsius", -4 mm of rain cannot)
//   consistent   do the grade and the words agree with the answer's own numbers?
//   on_topic     is it weather for the window, or something else sent in its place?
//
// It is the Swarm Budget guard (packages/checked-ask/guard.mjs) rewritten to work on answer TEXT, which
// is what a Telegraph evaluator sees. Used here to show the pairs in packs/ are decidable by rules, and
// to grade live miners on the same questions.

import { resolvePlace, parseCoords, km } from "../../miner/src/places.mjs";
import { readWindowHours, readDate } from "../../miner/src/weather.mjs";
import { bandScore, levelOf, BANDS, LEVELS } from "../../miner/src/risk.mjs";

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?/g;

// Turn any of the common answer shapes (JSON, "key: value" lines, a sentence) into fields.
export function readAnswer(text) {
  const raw = String(text ?? "");
  let o = null;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object") o = j;
  } catch {}
  if (!o && /^\s*[a-z_]+\s*:/im.test(raw) && raw.includes("\n")) {
    o = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i);
      if (m) o[m[1]] = /^(null|n\/a|not available|unknown|no data|not reported|unavailable)?$/i.test(m[2].trim()) ? null : m[2].trim();
    }
  }
  const grab = (re) => {
    const m = raw.match(re);
    return m ? num(m[1]) : null;
  };
  const f = { raw, structured: Boolean(o) };
  f.coords = (() => {
    const m = raw.match(/\(\s*(-?\d{1,2}\.\d{2,})\s*,\s*(-?\d{1,3}\.\d{2,})\s*\)/) ?? (o?.location ? String(o.location).match(/^\s*(-?\d{1,2}\.\d{2,})\s*,\s*(-?\d{1,3}\.\d{2,})\s*$/) : null);
    return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
  })();
  if (o) {
    f.location = o.location ?? null;
    f.level = o.risk_level ?? null;
    f.score = num(o.risk_score);
    f.gust = num(o.peak_gust_kmh);
    f.rain = num(o.precipitation_mm);
    f.hi = num(o.temp_max_c);
    f.lo = num(o.temp_min_c);
    f.prob = num(o.precipitation_probability_pct);
    f.cond = o.condition ?? null;
    f.date = o.date ?? null;
    f.windowText = o.window ?? o.when ?? null;
  } else {
    f.location = (raw.match(/([\p{Lu}][^.:\n]*?\(\s*-?\d{1,2}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}\s*\))/u) ?? [])[1] ?? null;
    f.level = (raw.match(/\b(LOW|MODERATE|HIGH|SEVERE)\b/) ?? [])[1] ?? (raw.match(/(?:risk|grade)\s+(?:level\s+)?([A-Z][A-Za-z0-9\/ -]{2,14}?)(?=\s*[(.,;]|\s+risk\b)/) ?? [])[1] ?? null;
    f.score = grab(/\bscore\s*(?:of\s*)?(-?\d+(?:\.\d+)?)/i) ?? grab(/\((-?\d+(?:\.\d+)?)\s+on a 0 to 1 scale\)/i);
    f.gust = grab(/gusts?\s+(?:up to\s+|peak(?:s|ing)? (?:at|near)\s+)?(-?\d+(?:\.\d+)?)\s*km\/h/i);
    f.rain = grab(/precipitation[:\s]+(?:of\s+)?(-?\d+(?:\.\d+)?)\s*mm/i) ?? grab(/(-?\d+(?:\.\d+)?)\s*mm of precipitation/i) ?? grab(/rainfall\s+(-?\d+(?:\.\d+)?)\s*mm/i);
    f.hi = grab(/(?:high|maximum temperature)[^\d-]{0,12}(-?\d+(?:\.\d+)?)\s*°?C/i);
    f.lo = grab(/(?:low|minimum temperature)[^\d-]{0,12}(-?\d+(?:\.\d+)?)\s*°?C/i);
    f.prob = grab(/(?:chance|probability)[^\d-]{0,28}(-?\d+(?:\.\d+)?)\s*%/i);
    f.cond = (raw.match(/(?::\s*|,\s*)((?:clear|mainly|partly|overcast|fog|light|heavy|drizzle|rain|snow|thunder|violent|freezing|sunny)[a-z ,]*?)(?=\.|,\s*(?:high|low)|$)/i) ?? [])[1] ?? null;
    f.date = (raw.match(/\b\d{4}-\d{2}-\d{2}\b(?!T)/) ?? [])[0] ?? null;
    f.windowText = raw;
  }
  const stamps = String(f.windowText ?? "").match(ISO) ?? [];
  f.windowHours = stamps.length >= 2 ? Math.round((Date.parse(fixIso(stamps[1])) - Date.parse(fixIso(stamps[0]))) / 3600e3) : (num((String(f.windowText ?? "").match(/\b(\d{1,3})\s*-?\s*hours?\b/i) ?? [])[1]) ?? null);
  return f;
}
const fixIso = (s) => (/Z$/.test(s) ? s : `${s}Z`).replace(/T(\d{2}:\d{2})Z$/, "T$1:00Z");

const askedPlace = new Map();
async function placeAsked(prompt) {
  if (!askedPlace.has(prompt)) askedPlace.set(prompt, resolvePlace({ question: prompt }).catch(() => null));
  return askedPlace.get(prompt);
}
const namedPlace = new Map();
async function placeNamed(text) {
  const c = parseCoords(text);
  if (c) return c;
  if (!namedPlace.has(text)) namedPlace.set(text, resolvePlace({ location: text }).catch(() => null));
  return namedPlace.get(text);
}

const pass = (name, why) => ({ name, pass: true, why });
const fail = (name, why) => ({ name, pass: false, why });

async function placeCheck(prompt, f) {
  const asked = await placeAsked(prompt);
  if (!asked) return pass("place", "the question's place could not be resolved, so this is not judged");
  const where = f.coords ?? (f.location ? await placeNamed(String(f.location)) : null);
  if (!f.location && !f.coords) return fail("place", "the answer does not say which place it is for");
  if (!where) return fail("place", `"${f.location}" is not a place that can be checked`);
  const d = km(asked, where);
  return d <= 60 ? pass("place", `${Math.round(d)} km from the place asked`) : fail("place", `${Math.round(d).toLocaleString("en-US")} km from the place asked`);
}

export async function checkStorm(prompt, answer) {
  const f = readAnswer(answer);
  const c = [await placeCheck(prompt, f)];
  let N = null;
  try {
    N = readWindowHours(undefined, prompt, 24);
  } catch {}
  c.push(f.windowHours == null ? fail("time", "no window stated") : N == null || Math.abs(f.windowHours - N) <= 1 ? pass("time", `${f.windowHours} hours`) : fail("time", `covers ${f.windowHours} hours, asked ${N}`));
  const missing = [f.level == null && "risk level", f.score == null && "risk score", f.gust == null && "peak gust", f.rain == null && "precipitation"].filter(Boolean);
  c.push(missing.length ? fail("complete", `missing ${missing.join(", ")}`) : pass("complete", "all four values present"));
  const bad = [f.score != null && (f.score < 0 || f.score > 1) && `score ${f.score} is not between 0 and 1`, f.level != null && !LEVELS.includes(String(f.level)) && `"${f.level}" is not LOW, MODERATE, HIGH or SEVERE`, f.gust != null && (f.gust < 0 || f.gust > 500) && `gust ${f.gust} km/h`, f.rain != null && (f.rain < 0 || f.rain > 5000) && `precipitation ${f.rain} mm`].filter(Boolean);
  c.push(bad.length ? fail("in_range", bad.join("; ")) : pass("in_range", "values are possible"));
  if (LEVELS.includes(String(f.level)) && f.gust != null && f.gust >= 0 && f.gust <= 500) {
    // The total alone does not say how the rain was spread. If it fell evenly the wettest day is total/days;
    // if it all came at once it is the whole total. The stated grade has to sit inside that range, with one
    // grade of slack for what totals cannot show (a thunderstorm, an official alert, one very wet hour).
    const days = Math.max(1, (f.windowHours ?? N ?? 24) / 24);
    const rain = Math.max(0, f.rain ?? 0);
    const gustBand = bandScore(f.gust, BANDS.gust_kmh);
    const lowest = LEVELS.indexOf(levelOf(Math.max(gustBand, bandScore(rain / days, BANDS.precip_24h_mm))));
    const highest = LEVELS.indexOf(levelOf(Math.max(gustBand, bandScore(rain, BANDS.precip_24h_mm))));
    const said = LEVELS.indexOf(String(f.level));
    c.push(
      said < lowest - 1 || said > highest + 1
        ? fail("consistent", `says ${f.level}, but ${f.gust} km/h gusts and ${rain} mm read as ${LEVELS[lowest]}${highest > lowest ? ` to ${LEVELS[highest]}` : ""}`)
        : pass("consistent", "grade matches the numbers"),
    );
  }
  c.push(/earthquake|seismic|magnitude|k-index|geomagnetic|solar radiation/i.test(f.raw) && f.gust == null ? fail("on_topic", "about another hazard, not the weather asked for") : pass("on_topic", "weather"));
  return verdict(c);
}

export async function checkForecast(prompt, answer) {
  const f = readAnswer(answer);
  const c = [await placeCheck(prompt, f)];
  let N = null;
  try {
    N = readWindowHours(undefined, prompt, 24);
  } catch {}
  c.push(f.windowHours == null ? fail("time", "no window stated") : N == null || Math.abs(f.windowHours - N) <= 1 ? pass("time", `${f.windowHours} hours`) : fail("time", `covers ${f.windowHours} hours, asked ${N}`));
  const missing = [f.hi == null && "high", f.lo == null && "low", f.prob == null && "chance of precipitation", !f.cond && "conditions"].filter(Boolean);
  c.push(missing.length ? fail("complete", `missing ${missing.join(", ")}`) : pass("complete", "all four values present"));
  const bad = [f.hi != null && (f.hi < -90 || f.hi > 60) && `high ${f.hi} °C`, f.lo != null && (f.lo < -90 || f.lo > 60) && `low ${f.lo} °C`, f.prob != null && (f.prob < 0 || f.prob > 100) && `chance ${f.prob}%`].filter(Boolean);
  c.push(bad.length ? fail("in_range", bad.join("; ")) : pass("in_range", "values are possible"));
  const clash = [];
  if (f.hi != null && f.lo != null && f.hi < f.lo) clash.push(`high ${f.hi} is below low ${f.lo}`);
  if (f.cond && f.prob != null && f.prob >= 0 && f.prob <= 100) {
    if (/clear|sunny|dry/i.test(f.cond) && !/rain|shower|drizzle|snow|thunder/i.test(f.cond) && f.prob >= 70) clash.push(`"${f.cond}" with a ${f.prob}% chance of precipitation`);
    if (/heavy|violent|thunder/i.test(f.cond) && f.prob <= 10) clash.push(`"${f.cond}" with a ${f.prob}% chance of precipitation`);
  }
  c.push(clash.length ? fail("consistent", clash.join("; ")) : pass("consistent", "words match the numbers"));
  c.push(/\b(currently|right now|current conditions|observed_at)\b/i.test(f.raw) && f.hi == null ? fail("on_topic", "the temperature now, not a forecast for the window") : pass("on_topic", "a forecast"));
  return verdict(c);
}

export async function checkDay(prompt, answer) {
  const f = readAnswer(answer);
  const c = [await placeCheck(prompt, f)];
  let asked = null;
  try {
    asked = readDate(undefined, prompt);
  } catch {}
  c.push(!f.date ? fail("time", "no date stated") : !asked || f.date === asked ? pass("time", f.date) : fail("time", `record for ${f.date}, asked ${asked}`));
  const missing = [f.hi == null && "high", f.lo == null && "low", f.rain == null && "precipitation"].filter(Boolean);
  c.push(missing.length ? fail("complete", `missing ${missing.join(", ")}`) : pass("complete", "high, low and precipitation present"));
  const bad = [f.hi != null && (f.hi < -90 || f.hi > 60) && `high ${f.hi} °C`, f.lo != null && (f.lo < -90 || f.lo > 60) && `low ${f.lo} °C`, f.rain != null && (f.rain < 0 || f.rain > 2000) && `precipitation ${f.rain} mm`].filter(Boolean);
  c.push(bad.length ? fail("in_range", bad.join("; ")) : pass("in_range", "values are possible"));
  c.push(f.hi != null && f.lo != null && f.hi < f.lo ? fail("consistent", `high ${f.hi} is below low ${f.lo}`) : pass("consistent", "high is not below low"));
  c.push(/\bforecast(?:_|\s+(?:for|values|called))|\bexpected (?:high|low|precipitation)|not observed|not available/i.test(f.raw) ? fail("on_topic", "a forecast, not what was recorded") : pass("on_topic", "a record"));
  return verdict(c);
}

function verdict(checks) {
  const passed = checks.filter((x) => x.pass).length;
  return { score: Number((passed / checks.length).toFixed(3)), failed: checks.filter((x) => !x.pass).map((x) => `${x.name}: ${x.why}`), checks };
}

export const CHECKERS = { STORM_ALERT_GENERAL: checkStorm, WEATHER_FORECAST_GENERAL: checkForecast, WEATHER_FORECAST_VERIFY_GENERAL: checkDay };
