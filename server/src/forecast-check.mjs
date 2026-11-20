// Did the forecast come true? (Mission 06: forecast error by site and horizon.)
// Every forecast the fleet buys is later compared with the recorded weather for the day it covered, which Ledger
// also buys on Telegraph (WEATHER_FORECAST_VERIFY_GENERAL). A forecast whose day has not ended, or whose record is
// not bought yet, stays waiting and is checked on a later run.
//
// The day a forecast covers is the local calendar date of its window's midpoint. Local time is solar time from
// the site's longitude (Kerman, CA: UTC-8), close enough for a daily record.
//
// Horizons:
// - 24 h (Ledger buys one each run): scored on rain and on the day's high and low.
// - 6 h (Kite's pre-spray forecast): scored on rain only. Its window is a quarter of the day, so its high and low
//   are not the day's, and rain outside the window still counts as a rainy day. Its rain score is therefore harsher.
export const HORIZONS = { 24: { temps: true }, 6: { temps: false } };
export const RAIN_MM = 1; // a day counts as rainy from 1 mm, the usual "wet day" threshold
export const MAX_AGE_DAYS = 10; // older unchecked days are not bought any more

const offsetMs = (lon) => Math.round(lon / 15) * 3600e3;
export const coordsOf = (location) => {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(String(location ?? ""));
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
};
export const targetDate = (atIso, lon, windowH) =>
  new Date(Date.parse(atIso) + (windowH * 3600e3) / 2 + offsetMs(lon)).toISOString().slice(0, 10);
export const dayEnded = (date, lon, now = Date.now()) => now >= Date.parse(`${date}T00:00:00Z`) + 86400e3 - offsetMs(lon);

const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// forecasts: accepted WEATHER_FORECAST_GENERAL purchases; records: accepted WEATHER_FORECAST_VERIFY_GENERAL ones.
// Each needs { farm, at, params, result, signal_hash }.
export function pairForecasts(forecasts, records) {
  return forecasts
    .filter((f) => HORIZONS[Number(f.params?.window_hours)] && coordsOf(f.params?.location) && f.result)
    .map((f) => {
      const horizon = Number(f.params.window_hours);
      const { lon } = coordsOf(f.params.location);
      const date = targetDate(f.at, lon, horizon);
      const temps = HORIZONS[horizon].temps;
      const said = {
        rain_pct: num(f.result.precipitation_probability_pct),
        high: temps ? num(f.result.temp_max_c) : null,
        low: temps ? num(f.result.temp_min_c) : null,
      };
      const row = { farm: f.farm, bought_at: f.at, date, lon, horizon_h: horizon, said, forecast_signal: f.signal_hash ?? null };
      const rec = records.find((o) => o.farm === f.farm && o.params?.date === date && o.result);
      if (!rec) return { ...row, recorded: null };
      const got = { rain_mm: num(rec.result.precipitation_mm), high: num(rec.result.temp_max_c), low: num(rec.result.temp_min_c) };
      const rained = got.rain_mm == null ? null : got.rain_mm >= RAIN_MM;
      const p = said.rain_pct == null ? null : said.rain_pct / 100;
      return {
        ...row,
        recorded: got,
        record_signal: rec.signal_hash ?? null,
        rained,
        rain_call_right: p == null || rained == null ? null : p >= 0.5 === rained,
        brier: p == null || rained == null ? null : r3((p - (rained ? 1 : 0)) ** 2),
        high_err: said.high == null || got.high == null ? null : r1(said.high - got.high),
        low_err: said.low == null || got.low == null ? null : r1(said.low - got.low),
      };
    });
}

// Days that are over, still have no record, and are recent enough to look up: what Ledger buys next, oldest first.
export function datesToCheck(pairs, now = Date.now()) {
  const oldest = new Date(now - MAX_AGE_DAYS * 86400e3).toISOString().slice(0, 10);
  return [...new Set(pairs.filter((p) => !p.recorded && p.date >= oldest && dayEnded(p.date, p.lon, now)).map((p) => p.date))].sort();
}

function score(pairs) {
  const scored = pairs.filter((p) => p.recorded);
  const calls = scored.filter((p) => p.rain_call_right != null);
  const highs = scored.filter((p) => p.high_err != null);
  const lows = scored.filter((p) => p.low_err != null);
  return {
    forecasts: pairs.length,
    scored: scored.length,
    waiting: pairs.length - scored.length,
    rain_calls: calls.length,
    rain_calls_right: calls.filter((p) => p.rain_call_right).length,
    brier: r3(mean(calls.map((p) => p.brier))),
    high_mae_c: r1(mean(highs.map((p) => Math.abs(p.high_err)))),
    low_mae_c: r1(mean(lows.map((p) => Math.abs(p.low_err)))),
  };
}

// The report the page shows: totals, one row per site and horizon, and the latest pairs.
export function forecastReport(pairs, now = Date.now()) {
  const keys = [...new Set(pairs.map((p) => `${p.farm}|${p.horizon_h}`))];
  const groups = keys
    .map((k) => {
      const [farm, h] = k.split("|");
      return { farm, horizon_h: Number(h), ...score(pairs.filter((p) => p.farm === farm && p.horizon_h === Number(h))) };
    })
    .sort((a, b) => b.horizon_h - a.horizon_h || b.scored - a.scored);
  return {
    ...score(pairs),
    overdue: datesToCheck(pairs, now),
    groups,
    rows: [...pairs].filter((p) => p.recorded).sort((a, b) => b.bought_at.localeCompare(a.bought_at)).slice(0, 10),
    next: [...pairs].filter((p) => !p.recorded).sort((a, b) => b.bought_at.localeCompare(a.bought_at)).slice(0, 3),
  };
}
