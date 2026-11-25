// Training pairs for a WEATHER_FORECAST scorer (an Evaluator adapter).
//
// The uploaded pack (packs/WEATHER_FORECAST_GENERAL.jsonl) is 220 rows. A scorer needs more than that, and
// it needs to cope with answers it has not seen the like of. This builds a larger set the same way: every
// answer is real forecast data for a real place, and the worse answer differs in one thing. It adds four
// kinds the pack does not have (an unrelated city, a stale forecast, a vague answer, a refusal) and two
// more ways of wording an answer, including a whole miner response body, because that is what the node
// hands a scorer when it ranks miners.
//
// Places are split, not rows: a fifth of the towns are held out, and no held-out town appears in training.
//
//   node adapter/build-training.mjs
// writes adapter/train.jsonl, adapter/heldout.jsonl, their .meta.jsonl files, and
// adapter/train-without-place.jsonl (the same training set minus every wrong-place row, for the comparison).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { conditionOver } from "../../miner/src/risk.mjs";
import { km, resolvePlace } from "../../miner/src/places.mjs";

const here = (p) => new URL(p, import.meta.url);
const { cases, majors } = JSON.parse(readFileSync(here("../data/namesakes.json"), "utf8"));
const frozen = JSON.parse(readFileSync(here("../data/snapshot.json"), "utf8"));
const cachePath = here("./cache.json");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : { calls: {}, resolved: {} };
const T0 = frozen.taken_at;

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
const r = rng(20261128);
const pick = (arr) => arr[Math.floor(r() * arr.length)];
const fix4 = (n) => Number(Number(n).toFixed(4));
const r1 = (n) => (n == null ? null : Number(Number(n).toFixed(1)));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const addHours = (isoHour, h) => new Date(Date.parse(`${isoHour}:00Z`) + h * 3600e3).toISOString().slice(0, 16);
const nums = (a) => a.filter((v) => v != null);
const forecastUrl = (p) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${fix4(p.lat)}&longitude=${fix4(p.lon)}&hourly=temperature_2m,precipitation,precipitation_probability,wind_gusts_10m,weather_code&start_hour=${T0}&end_hour=${addHours(T0, 168)}&timezone=UTC`;

async function get(url) {
  if (frozen.calls[url]) return frozen.calls[url];
  if (cache.calls[url]) return cache.calls[url];
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const j = await res.json();
        cache.calls[url] = { hourly: j.hourly };
        await sleep(110);
        return cache.calls[url];
      }
      if (res.status === 429) await sleep(20000);
    } catch {}
    await sleep(1500 * (i + 1));
  }
  throw new Error(`could not fetch ${url}`);
}
async function unambiguous(ask, place) {
  const known = ask in (frozen.resolved ?? {}) ? frozen.resolved[ask] : cache.resolved[ask];
  let got = known;
  if (got === undefined) {
    const p = await resolvePlace({ location: ask }).catch(() => null);
    got = cache.resolved[ask] = p ? { lat: p.lat, lon: p.lon } : null;
  }
  return Boolean(got) && km(got, place) <= 30;
}
async function facts(p, N) {
  const h = (await get(forecastUrl(p))).hourly;
  const temp = nums(h.temperature_2m.slice(0, N + 1));
  const prob = nums(h.precipitation_probability.slice(1, N + 1));
  if (!temp.length) throw new Error("no temperatures");
  return { loc: p.location, N, start: `${T0}Z`, end: `${addHours(T0, N)}Z`, hi: r1(Math.max(...temp)), lo: r1(Math.min(...temp)), prob: prob.length ? Math.round(Math.max(...prob)) : 0, cond: conditionOver(nums(h.weather_code.slice(0, N + 1))) ?? "Overcast", now: r1(h.temperature_2m[0]) };
}

// ---------- wording ----------
const NA = ["not available", "n/a", "unknown", "no data", "not reported", "unavailable"];
const show = (v, unit = "") => (v == null ? pick(NA) : `${v}${unit}`);
const when = (f, sep = "/") => (f.when === null ? null : `${f.start}${sep}${f.end}`);
const STYLES = [
  (f) => JSON.stringify({ location: f.loc, when: when(f), temp_max_c: f.hi, temp_min_c: f.lo, precipitation_probability_pct: f.prob, condition: f.cond }),
  (f) => JSON.stringify({ location: f.loc, when: f.when === null ? null : `the next ${f.N} hours, from ${f.start}`, temp_max_c: f.hi, temp_min_c: f.lo, precipitation_probability_pct: f.prob, condition: f.cond }),
  (f) => `${f.loc}, ${f.start} to ${f.end}: ${f.cond ?? pick(NA)}. High ${show(f.hi, " °C")}, low ${show(f.lo, " °C")}, chance of precipitation up to ${show(f.prob, "%")}.`,
  (f) => `Forecast for ${f.loc} over the ${f.N} hours from ${f.start}: high of ${show(f.hi, " °C")}, low of ${show(f.lo, " °C")}, peak rain chance ${show(f.prob, "%")}, ${String(f.cond ?? pick(NA)).toLowerCase()}.`,
  (f) => `location: ${f.loc}\nwhen: ${f.start}/${f.end}\ntemp_max_c: ${show(f.hi)}\ntemp_min_c: ${show(f.lo)}\nprecipitation_probability_pct: ${show(f.prob)}\ncondition: ${f.cond ?? pick(NA)}`,
  // A whole miner response body: a sentence plus the fields plus where it came from.
  (f) => JSON.stringify({ answer: `${f.loc}, next ${f.N} hours: ${f.cond ?? pick(NA)}, high ${show(f.hi, " °C")}, low ${show(f.lo, " °C")}, chance of precipitation up to ${show(f.prob, "%")}.`, location: f.loc, when: when(f), temp_max_c: f.hi, temp_min_c: f.lo, precipitation_probability_pct: f.prob, condition: f.cond, window_hours: f.N, source: "Open-Meteo forecast" }),
  (f) => `The forecast for ${f.loc} from ${f.start} to ${f.end} shows a high of ${show(f.hi, " °C")} and a low of ${show(f.lo, " °C")}, with a ${show(f.prob, "%")} peak chance of precipitation. Conditions: ${String(f.cond ?? pick(NA)).toLowerCase()}. Source: Open-Meteo.`,
];
const OPENERS = ["", "", "", "I run a small orchard.", "Logistics check.", "Fleet control here.", "Quick one for the harvest team:", "We have a roofing job booked.", "A market stall sets up outdoors tomorrow.", "School sports day is planned.", "Our crane crew needs a go or no-go.", "For a delivery route plan:", "Checking before we irrigate.", "Site safety briefing.", "A film crew is shooting outside.", "Our fishing co-op wants to know.", "Drone survey planning.", "Greenhouse vents are on manual today.", "The cold-chain truck leaves soon.", "Vineyard netting goes up this week.", "Packing for a work trip.", "Concrete pour is scheduled.", "The beekeepers are asking.", "Planning a road resurfacing shift."];
const CLOSERS = ["", "", "", "Answer for that exact town.", "Please state the place and coordinates you used.", "Use UTC for any times.", "Numbers in metric units, please.", "Include the period your answer covers.", "Keep it to the facts.", "One line is fine.", "This is for an automated system.", "Say which location the answer is for.", "No commentary, just the values.", "If you cannot tell which place I mean, say so."];
const QUESTIONS = [
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
  (P, S) => `Tell me the forecast for ${P}: the next ${S}, with temperatures in Celsius.`,
  (P, S) => `Should I expect rain or a cold snap in ${P} during the next ${S}?`,
  (P, S) => `What's the outlook in ${P} for the next ${S}? I need the high, the low and the rain chance.`,
  (P, S) => `Give a ${S} forecast for ${P}.`,
];
const span = (N) => (N % 24 === 0 && r() < 0.5 ? (N === 24 ? "24 hours" : `${N / 24} days`) : `${N} hours`);
const WINDOWS = [6, 12, 18, 24, 36, 48, 72, 96, 120];

// Answers that say little. Each is built from parts so no two are the same string.
const vague = (f) =>
  `${pick(["Conditions in", "The weather in", "The outlook for", "Expect the next few days in"])} ${f.loc} ${pick(["should be fairly typical for the season", "will be changeable", "looks mixed", "should stay settled for the most part", "will vary through the period"])}, ${pick(["with temperatures on the mild side", "with cool mornings and warmer afternoons", "with some cloud at times", "and it may turn breezy", "with a chance of a shower"])}. ${pick(["Rain cannot be ruled out.", "Carry a jacket to be safe.", "Check again closer to the time.", "It is hard to be more exact this far ahead.", "Local variations are possible."])}`;
const refusal = (f) =>
  `${pick(["I can't access live forecast data", "A live forecast could not be retrieved", "I don't have real-time weather access", "The forecast provider did not respond", "No forecast is available from my sources"])} for ${f.loc} ${pick(["right now", "at the moment", "for that window", "in this session"])}. ${pick(["Please consult a national weather service.", "Try again later.", "Consider checking a local forecast.", "No values can be given.", "I can describe the usual climate instead if that helps."])}`;

const KINDS = [["wrong_place", 32], ["wrong_city", 8], ["wrong_window", 14], ["stale", 7], ["contradiction", 13], ["missing", 9], ["out_of_range", 8], ["not_a_forecast", 4], ["vague", 3], ["refusal", 2]];
const kindBag = KINDS.flatMap(([k, w]) => Array(w).fill(k));
const held = (place) => {
  let h = 0;
  for (const ch of String(place)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 5 === 0;
};

const rows = [];
const seenPrompts = new Set();
let skipped = 0;
for (const c of cases) {
  for (let k = 0; k < 3; k++) {
    const kind = pick(kindBag);
    const N = pick(WINDOWS);
    const style = STYLES[r() < 0.4 ? Math.floor(r() * 2) : 2 + Math.floor(r() * (STYLES.length - 2))];
    try {
      let ask = c.ask_variants && r() < 0.35 ? pick(c.ask_variants) : c.ask;
      let place = c.place;
      let other = null;
      if (kind === "wrong_place") {
        other = c.trap;
        // Half the time the question is about the BIG town and the worse answer is the small one. With the
        // pack's one in five, a word counter could still win by betting against "France" and "England".
        if (r() < 0.5) {
          place = c.trap;
          other = c.place;
          ask = place.country_code === "US" && place.admin1 ? `${place.name}, ${place.admin1}` : `${place.name}, ${place.country}`;
        }
      } else if (kind === "wrong_city") {
        other = pick(majors).place;
        if (km(other, place) < 300) continue;
      }
      if (!(await unambiguous(ask, place))) {
        skipped++;
        continue;
      }
      const good = await facts(place, N);
      let bad;
      let note;
      if (kind === "wrong_place" || kind === "wrong_city") {
        bad = await facts(other, N);
        note = `${Math.round(km(place, other)).toLocaleString("en-US")} km from the place asked`;
      } else if (kind === "wrong_window") {
        const M = N <= 24 ? pick([120, 144, 168]) : pick([3, 6]);
        bad = await facts(place, M);
        note = `covers ${M} hours, asked ${N}`;
      } else if (kind === "stale") {
        const daysAgo = 5 + Math.floor(r() * 20);
        const s = addHours(T0, -24 * daysAgo);
        bad = { ...good, start: `${s}Z`, end: `${addHours(s, N)}Z` };
        note = `a forecast for ${daysAgo} days earlier`;
      } else if (kind === "contradiction") {
        const clear = good.prob >= 70 || good.prob <= 10;
        if ((r() < 0.5 || !clear) && good.hi - good.lo >= 2) {
          bad = { ...good, hi: good.lo, lo: good.hi };
          note = "the high is below the low";
        } else if (!clear) continue;
        else {
          bad = { ...good, cond: good.prob >= 70 ? pick(["Clear sky", "Sunny and dry", "Mainly clear"]) : pick(["Heavy rain", "Thunderstorm with heavy hail", "Violent rain showers", "Heavy snow"]) };
          note = `the words say "${bad.cond}", the rain chance is ${good.prob}%`;
        }
      } else if (kind === "missing") {
        const drop = pick(["temps", "prob", "cond", "all"]);
        bad = { ...good };
        if (drop === "temps") (bad.hi = null), (bad.lo = null);
        if (drop === "prob" || drop === "all") bad.prob = null;
        if (drop === "cond" || drop === "all") bad.cond = null;
        if (drop === "all") (bad.when = null), (bad.loc = r() < 0.5 ? null : bad.loc);
        note = `missing: ${drop}`;
      } else if (kind === "out_of_range") {
        const how = pick(["kelvin", "prob_over_100", "prob_negative", "fahrenheit"]);
        bad = { ...good };
        if (how === "kelvin") (bad.hi = r1(good.hi + 273.15)), (bad.lo = r1(good.lo + 273.15));
        if (how === "prob_over_100") bad.prob = 100 + Math.round(10 + r() * 150);
        if (how === "prob_negative") bad.prob = -Math.round(5 + r() * 40);
        if (how === "fahrenheit") {
          if ((good.hi * 9) / 5 + 32 <= 61) continue; // only when the Fahrenheit number is impossible as Celsius
          (bad.hi = r1((good.hi * 9) / 5 + 32)), (bad.lo = r1((good.lo * 9) / 5 + 32));
        }
        note = how.replaceAll("_", " ");
      } else if (kind === "not_a_forecast") {
        bad = { text: pick([`It is currently ${good.now} °C in ${good.loc}.`, `${good.loc}: ${good.now} °C right now, observed at ${good.start}.`, JSON.stringify({ location: good.loc, temperature_c: good.now, observed_at: good.start }), `Current conditions for ${good.loc} as of ${good.start}: air temperature ${good.now} °C.`]) };
        note = "the temperature now, not a forecast";
      } else if (kind === "vague") {
        bad = { text: vague(good) };
        note = "no numbers";
      } else {
        bad = { text: refusal(good) };
        note = "a refusal";
      }
      const prompt = [pick(OPENERS), pick(QUESTIONS)(ask, span(N)), pick(CLOSERS)].filter(Boolean).join(" ");
      const chosen = style(good);
      const rejected = bad.text ?? style(bad);
      if (chosen === rejected || seenPrompts.has(prompt)) continue;
      seenPrompts.add(prompt);
      rows.push({ row: { prompt, chosen, rejected, label_kind: "preference_pair" }, meta: { kind, asked: ask, place: place.location, other: other?.location ?? null, window_hours: N, note, split: held(place.location) || (other && held(other.location)) ? "heldout" : "train", from: "generated" } });
    } catch (e) {
      skipped++;
    }
  }
}
writeFileSync(cachePath, JSON.stringify(cache));

// The uploaded pack's rows go in too, on the side of the split the pack already gave them.
const pack = readFileSync(here("../packs/WEATHER_FORECAST_GENERAL.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const packMeta = readFileSync(here("../packs/WEATHER_FORECAST_GENERAL.meta.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
for (const [i, p] of pack.entries()) {
  if (seenPrompts.has(p.prompt)) continue;
  const m = packMeta[i];
  rows.push({ row: { prompt: p.prompt, chosen: p.chosen, rejected: p.rejected, label_kind: "preference_pair" }, meta: { kind: m.kind, asked: m.asked, place: m.place, other: m.other ?? null, window_hours: m.window_hours ?? null, note: m.note, split: m.split === "heldout" || held(m.place) || (m.other && held(m.other)) ? "heldout" : "train", from: m.real_traffic ? "paid answer" : "uploaded pack" } });
}

const write = (name, list) => {
  writeFileSync(here(`./${name}.jsonl`), list.map((x) => JSON.stringify(x.row)).join("\n") + "\n");
  writeFileSync(here(`./${name}.meta.jsonl`), list.map((x, i) => JSON.stringify({ line: i + 1, ...x.meta })).join("\n") + "\n");
};
const train = rows.filter((x) => x.meta.split === "train");
const heldout = rows.filter((x) => x.meta.split === "heldout");
write("train", train);
write("heldout", heldout);
write("train-without-place", train.filter((x) => x.meta.kind !== "wrong_place" && x.meta.kind !== "wrong_city"));
const count = (list) => list.reduce((a, x) => ((a[x.meta.kind] = (a[x.meta.kind] ?? 0) + 1), a), {});
console.log(`train ${train.length}`, JSON.stringify(count(train)));
console.log(`heldout ${heldout.length}`, JSON.stringify(count(heldout)));
console.log(`train without place rows ${train.filter((x) => x.meta.kind !== "wrong_place" && x.meta.kind !== "wrong_city").length}; skipped ${skipped}`);
