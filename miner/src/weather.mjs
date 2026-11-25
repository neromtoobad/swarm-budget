// The four answers this miner sells. Each one is built from public forecast data for the resolved
// coordinates and carries the place, the sources (as URLs anyone can open) and its own limits.

import { getJson, cached, UpstreamError } from "./http.mjs";
import { placeBlock, fix4 } from "./places.mjs";
import { assess, conditionOver, wmoText, levelOf, bandScore, BANDS } from "./risk.mjs";

const OM = "https://api.open-meteo.com/v1/forecast";
const OM_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const NWS = "https://api.weather.gov";
const POWER = "https://power.larc.nasa.gov/api/temporal/daily/point";
const METNO = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const UA = "pinpoint-weather-miner/1.0 (+https://github.com/neromtoobad/swarm-budget)";

export class RequestError extends Error {
  constructor(code, message, extra = {}, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const r1 = (n) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(1)));
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(2)));
const nums = (a) => (a ?? []).filter((v) => v != null && Number.isFinite(v));
const maxOf = (a) => (nums(a).length ? Math.max(...nums(a)) : null);
const minOf = (a) => (nums(a).length ? Math.min(...nums(a)) : null);
const sumOf = (a) => (nums(a).length ? nums(a).reduce((x, y) => x + y, 0) : null);
const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
const hourFloor = (d = new Date()) => new Date(Math.floor(d.getTime() / 3600e3) * 3600e3);

export function readWindowHours(value, question, fallback = 24) {
  let n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) {
    const q = String(question ?? "").toLowerCase();
    const m = q.match(/(\d+(?:\.\d+)?)\s*-?\s*(hours?|hrs?|h|days?|d|weeks?|wks?)\b/);
    if (m) n = Number(m[1]) * (/^h/.test(m[2]) ? 1 : /^d/.test(m[2]) ? 24 : 168);
    else if (/\btonight\b/.test(q)) n = 12;
    else if (/\btomorrow\b/.test(q)) n = 48;
    else if (/\bthis week\b|\bnext week\b|\bcoming week\b/.test(q)) n = 168;
    else if (/\bweekend\b/.test(q)) n = 120;
    else n = fallback;
  }
  n = Math.round(n);
  if (n < 1 || n > 240) throw new RequestError("window_out_of_range", `window_hours must be between 1 and 240. Got ${n}.`, { window_hours: n });
  return n;
}

// Largest sum over any `width` consecutive values (or the whole series if it is shorter).
export function wettest(values, width) {
  const v = values.map((x) => (x == null ? 0 : x));
  if (!nums(values).length) return null;
  if (v.length <= width) return v.reduce((a, b) => a + b, 0);
  let run = v.slice(0, width).reduce((a, b) => a + b, 0);
  let best = run;
  for (let i = width; i < v.length; i++) {
    run += v[i] - v[i - width];
    if (run > best) best = run;
  }
  return best;
}

const MODELS = ["best_match", "gfs_seamless", "icon_seamless"];
const MODEL_NAMES = { best_match: "Open-Meteo best match", gfs_seamless: "NOAA GFS", icon_seamless: "DWD ICON" };

async function hourly(place, hours) {
  const start = hourFloor();
  const url =
    `${OM}?latitude=${fix4(place.lat)}&longitude=${fix4(place.lon)}` +
    `&hourly=temperature_2m,precipitation,precipitation_probability,wind_gusts_10m,wind_speed_10m,weather_code,snowfall` +
    `&forecast_hours=${hours + 1}&timezone=UTC&models=${MODELS.join(",")}`;
  const data = await cached(`om:${fix4(place.lat)},${fix4(place.lon)}:${hours}:${start.getTime()}`, 10 * 60e3, () => getJson(url));
  const h = data?.hourly;
  if (!h?.time?.length) throw new UpstreamError("Open-Meteo returned no hourly forecast for this point", { url });
  // Open-Meteo stamps precipitation, gusts and snowfall on the END of the hour they cover. Asking for
  // hours+1 steps and dropping the first gives exactly the window [start, start + hours].
  const series = (name, model, fromIndex) => (h[`${name}_${model}`] ?? []).slice(fromIndex, hours + 1);
  return { url, start, end: new Date(start.getTime() + hours * 3600e3), times: h.time.slice(0, hours + 1), series, grid: { latitude: data.latitude, longitude: data.longitude, elevation_m: data.elevation } };
}

async function nwsAlerts(place) {
  if (place.country_code && place.country_code !== "US") return { covered: false, alerts: [] };
  // Without a country code (bare coordinates with no label) only try inside a box around the US.
  if (!place.country_code && !(place.lat > 17 && place.lat < 72 && place.lon > -180 && place.lon < -64)) return { covered: false, alerts: [] };
  const url = `${NWS}/alerts/active?point=${fix4(place.lat)},${fix4(place.lon)}`;
  try {
    const data = await cached(`nws:${fix4(place.lat)},${fix4(place.lon)}`, 5 * 60e3, () => getJson(url, { timeoutMs: 2500, retries: 0, headers: { "User-Agent": UA, accept: "application/geo+json" } }));
    const weather = /wind|storm|tornado|hurricane|flood|rain|snow|blizzard|ice|thunder|gale|typhoon|squall|freez|winter|tropical|surge|dust|hail/i;
    const alerts = (data?.features ?? [])
      .map((f) => f.properties)
      .filter((p) => p && weather.test(p.event ?? ""))
      .map((p) => ({ event: p.event, severity: p.severity, certainty: p.certainty, headline: p.headline, expires: p.expires }));
    return { covered: true, alerts, url };
  } catch {
    return { covered: true, alerts: [], url, failed: true };
  }
}

const whenAt = (times, values) => {
  let best = -1;
  values.forEach((v, i) => {
    if (v != null && (best < 0 || v > values[best])) best = i;
  });
  return best < 0 ? null : `${times[best]}Z`;
};

function envelope(place, sources, limitations) {
  return {
    place: placeBlock(place),
    sources,
    checked_at: iso(Date.now()),
    limitations,
    provider: "Pinpoint Weather, a Telegraph miner by the Swarm Budget team (testnet)",
  };
}

// ---------- STORM_ALERT_GENERAL ----------
export async function stormAlert(place, { window_hours, question } = {}) {
  const hours = readWindowHours(window_hours, question, 24);
  const [fc, official] = await Promise.all([hourly(place, hours), nwsAlerts(place)]);
  const times = fc.times.slice(1);

  const perModel = {};
  for (const m of MODELS) {
    const gust = fc.series("wind_gusts_10m", m, 1);
    const rain = fc.series("precipitation", m, 1);
    const snow = fc.series("snowfall", m, 1);
    const codes = fc.series("weather_code", m, 0);
    if (!nums(gust).length && !nums(rain).length) continue;
    perModel[m] = {
      gust, rain, snow, codes,
      peakGust: maxOf(gust),
      total: sumOf(rain),
      precip24h: wettest(rain, 24),
      precip1h: maxOf(rain),
      snow24h: wettest(snow, 24),
      thunderCodes: [...new Set(nums(codes).filter((c) => c >= 95))],
      gustHours: nums(gust).length,
      rainHours: nums(rain).length,
    };
  }
  const main = perModel.best_match ?? Object.values(perModel)[0];
  if (!main) throw new UpstreamError("No forecast model returned wind or precipitation for this point", { url: fc.url });

  const { risk_score, risk_level, drivers } = assess({ ...main, alerts: official.alerts });
  const limitations = [
    "Risk is a published threshold rule over forecast gusts, precipitation, snowfall, thunderstorms and official alerts. It is not a calibrated probability and not an official warning.",
    "Forecast values are for the model grid cell that contains the coordinates, not a station reading.",
  ];
  if (main.gustHours < hours) limitations.push(`Gust forecasts cover ${main.gustHours} of the ${hours} hours asked; the peak is over the covered hours only.`);
  if (main.rainHours < hours) limitations.push(`Precipitation forecasts cover ${main.rainHours} of the ${hours} hours asked; the total is over the covered hours only.`);
  if (!official.covered) limitations.push("Official alerts are only checked inside the United States (US National Weather Service).");
  if (official.failed) limitations.push("The US National Weather Service alert feed did not answer in time; official alerts were not included in this answer.");

  // How far apart do independent models put the peak gust, and do they land in the same risk band?
  const peaks = Object.entries(perModel).map(([m, v]) => ({ model: MODEL_NAMES[m], peak_gust_kmh: r1(v.peakGust), precipitation_mm: r1(v.total), gust_level: v.peakGust == null ? null : levelOf(bandScore(v.peakGust, BANDS.gust_kmh)) }));
  const pk = nums(peaks.map((p) => p.peak_gust_kmh));
  const spread = pk.length > 1 ? Math.max(...pk) - Math.min(...pk) : null;
  const model_agreement = spread == null ? null : r2(Math.max(0, 1 - spread / Math.max(40, Math.max(...pk))));
  const bandsSeen = [...new Set(peaks.map((p) => p.gust_level).filter(Boolean))];

  const gustAt = whenAt(times, main.gust);
  const thunder = main.thunderCodes.length > 0;
  const window = `${iso(fc.start)}/${iso(fc.end)}`;
  const bits = [
    main.peakGust == null ? "no gust forecast for this window" : `gusts peak at ${r1(main.peakGust)} km/h${gustAt ? ` around ${gustAt}` : ""}`,
    main.total == null ? "no precipitation forecast" : `${r1(main.total)} mm of precipitation`,
    thunder ? `thunderstorms forecast (${main.thunderCodes.map(wmoText).join(", ").toLowerCase()})` : "no thunderstorms forecast",
  ];
  if (official.alerts.length) bits.push(`${official.alerts.length} official alert${official.alerts.length > 1 ? "s" : ""} active (${official.alerts.map((a) => a.event).join("; ")})`);

  return {
    answer: `${risk_level} storm risk for ${place.location} over the next ${hours} hours: ${bits.join(", ")}.`,
    location: place.location,
    risk_score,
    risk_level,
    peak_gust_kmh: r1(main.peakGust),
    precipitation_mm: r1(main.total),
    window,
    window_hours: hours,
    peak_gust_at: gustAt,
    wettest_hour_mm: r1(main.precip1h),
    wettest_24h_mm: r1(main.precip24h),
    snowfall_cm: r1(sumOf(main.snow)),
    thunderstorm: thunder,
    drivers,
    official_alerts: official.covered ? official.alerts : null,
    models: peaks,
    model_agreement,
    models_agree_on_gust_level: bandsSeen.length <= 1,
    ...envelope(
      place,
      [
        { name: "Open-Meteo forecast (best match, NOAA GFS, DWD ICON)", url: fc.url, grid_cell: fc.grid },
        ...(official.url ? [{ name: "US National Weather Service active alerts", url: official.url }] : []),
      ],
      limitations,
    ),
  };
}

// ---------- WEATHER_FORECAST_GENERAL ----------
export async function forecast(place, { window_hours, question } = {}) {
  const hours = readWindowHours(window_hours, question, 24);
  const fc = await hourly(place, hours);
  const perModel = {};
  for (const m of MODELS) {
    const temp = fc.series("temperature_2m", m, 0);
    if (!nums(temp).length) continue;
    perModel[m] = {
      temp,
      prob: fc.series("precipitation_probability", m, 1),
      rain: fc.series("precipitation", m, 1),
      gust: fc.series("wind_gusts_10m", m, 1),
      codes: fc.series("weather_code", m, 0),
    };
  }
  const main = perModel.best_match ?? Object.values(perModel)[0];
  if (!main) throw new UpstreamError("No forecast model returned temperatures for this point", { url: fc.url });

  const hi = maxOf(main.temp);
  const lo = minOf(main.temp);
  const prob = maxOf(main.prob);
  const condition = conditionOver(nums(main.codes));
  const when = `${iso(fc.start)}/${iso(fc.end)}`;
  const limitations = ["Forecast values are for the model grid cell that contains the coordinates, not a station reading."];
  if (nums(main.temp).length < hours + 1) limitations.push(`Temperatures cover ${nums(main.temp).length - 1} of the ${hours} hours asked.`);
  if (prob == null) limitations.push("No precipitation probability is published for this point and window; the field is null, not zero.");

  const models = Object.entries(perModel).map(([m, v]) => ({ model: MODEL_NAMES[m], temp_max_c: r1(maxOf(v.temp)), temp_min_c: r1(minOf(v.temp)), precipitation_mm: r1(sumOf(v.rain)) }));
  const his = nums(models.map((m) => m.temp_max_c));
  const spread = his.length > 1 ? Math.max(...his) - Math.min(...his) : null;

  return {
    answer: `${place.location}, next ${hours} hours: ${condition ?? "conditions not available"}, high ${r1(hi)} °C, low ${r1(lo)} °C${prob == null ? "" : `, chance of precipitation up to ${Math.round(prob)}%`}.`,
    location: place.location,
    when,
    temp_max_c: r1(hi),
    temp_min_c: r1(lo),
    precipitation_probability_pct: prob == null ? null : Math.round(prob),
    condition,
    window_hours: hours,
    temp_max_at: whenAt(fc.times, main.temp),
    precipitation_mm: r1(sumOf(main.rain)),
    peak_gust_kmh: r1(maxOf(main.gust)),
    models,
    model_agreement: spread == null ? null : r2(Math.max(0, 1 - spread / 10)),
    ...envelope(place, [{ name: "Open-Meteo forecast (best match, NOAA GFS, DWD ICON)", url: fc.url, grid_cell: fc.grid }], limitations),
  };
}

// ---------- WEATHER_FORECAST_VERIFY_GENERAL ----------
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// Accepts 2026-11-15, "15 November 2026", "November 15, 2026", "yesterday". Never guesses 03/04/2026.
export function readDate(value, question, today = ymd(new Date())) {
  const tryOne = (text) => {
    const t = String(text ?? "").trim();
    if (!t) return null;
    let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
    if (m) {
      const mi = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3)));
      if (mi >= 0) return `${m[3]}-${pad(mi + 1)}-${pad(Number(m[1]))}`;
    }
    m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
    if (m) {
      const mi = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
      if (mi >= 0) return `${m[3]}-${pad(mi + 1)}-${pad(Number(m[2]))}`;
    }
    if (/\byesterday\b/i.test(t)) return ymd(new Date(Date.parse(`${today}T00:00:00Z`) - 86400e3));
    return null;
  };
  const d = tryOne(value) ?? tryOne(question);
  if (!d) throw new RequestError("missing_date", "Send a past date as YYYY-MM-DD, for example ?date=2026-11-15.", {}, 400);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(t) || ymd(new Date(t)) !== d) throw new RequestError("bad_date", `"${d}" is not a real calendar date.`, { date: d }, 400);
  if (d < "1940-01-01") throw new RequestError("date_out_of_range", "Records start on 1940-01-01.", { date: d });
  return d;
}

async function nasaPower(place, date) {
  const compact = date.replaceAll("-", "");
  const url = `${POWER}?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR&community=AG&longitude=${fix4(place.lon)}&latitude=${fix4(place.lat)}&start=${compact}&end=${compact}&format=JSON`;
  try {
    const d = await cached(`power:${fix4(place.lat)},${fix4(place.lon)}:${date}`, 12 * 3600e3, () => getJson(url, { timeoutMs: 3500, retries: 0 }));
    const p = d?.properties?.parameter;
    const v = (k) => (p?.[k]?.[compact] == null || p[k][compact] <= -900 ? null : p[k][compact]);
    if (v("T2M_MAX") == null && v("PRECTOTCORR") == null) return { url, missing: true };
    return { url, temp_max_c: r1(v("T2M_MAX")), temp_min_c: r1(v("T2M_MIN")), precipitation_mm: r1(v("PRECTOTCORR")) };
  } catch {
    return { url, failed: true };
  }
}

export async function verifyDay(place, { date, question } = {}) {
  const todayUtc = ymd(new Date());
  const day = readDate(date, question, todayUtc);
  if (day > ymd(new Date(Date.now() + 86400e3))) throw new RequestError("day_not_finished", `${day} is in the future. This answer is only for days that have ended.`, { date: day });

  const ageDays = Math.round((Date.parse(`${todayUtc}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400e3);
  const daily = "daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,wind_gusts_10m_max";
  const q = `latitude=${fix4(place.lat)}&longitude=${fix4(place.lon)}&start_date=${day}&end_date=${day}&${daily}&timezone=auto`;
  const archiveUrl = `${OM_ARCHIVE}?${q}`;
  const recentUrl = `${OM}?${q}`;
  const useArchiveFirst = ageDays >= 6;
  const ttl = ageDays >= 6 ? 12 * 3600e3 : 30 * 60e3;
  const load = (url) => cached(`day:${url}`, ttl, () => getJson(url));

  const second = nasaPower(place, day); // starts now, in parallel
  let data, used;
  const order = useArchiveFirst ? [archiveUrl, recentUrl] : [recentUrl, archiveUrl];
  let lastErr;
  for (const url of order) {
    if (url === recentUrl && ageDays > 92) continue; // the forecast API only keeps about three months of past days
    try {
      const d = await load(url);
      if (d?.daily?.temperature_2m_max?.[0] != null || d?.daily?.precipitation_sum?.[0] != null) {
        data = d;
        used = url;
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (!data) {
    if (lastErr && !(lastErr.upstreamStatus >= 400 && lastErr.upstreamStatus < 500)) throw lastErr;
    throw new RequestError("no_record", `No recorded weather is available for ${place.location} on ${day}.`, { date: day }, 404);
  }

  // "Has that day ended there?" is a question about the place's own clock, not UTC.
  const localToday = ymd(new Date(Date.now() + (data.utc_offset_seconds ?? 0) * 1000));
  if (day >= localToday) throw new RequestError("day_not_finished", `${day} has not ended yet in ${place.location} (local date there is ${localToday}).`, { date: day, local_date: localToday, timezone: data.timezone });

  const d = data.daily;
  const fromArchive = used === archiveUrl;
  const cross = await second;
  const out = {
    temp_max_c: r1(d.temperature_2m_max?.[0]),
    temp_min_c: r1(d.temperature_2m_min?.[0]),
    precipitation_mm: r1(d.precipitation_sum?.[0]),
    condition: wmoText(d.weather_code?.[0]),
  };
  const limitations = [
    fromArchive
      ? "Values are a reanalysis estimate (Open-Meteo archive: ERA5 and ECMWF IFS) for the grid cell that contains the coordinates, not a station reading."
      : "This day is too recent for the reanalysis archive, so values come from the forecast model's own analysis for that day. They can change slightly once the archive catches up.",
    `"The day" means the local calendar day in ${data.timezone}.`,
  ];
  let second_source = null;
  if (cross.failed) limitations.push("The second source (NASA POWER) did not answer in time; this answer rests on one source.");
  else if (cross.missing) limitations.push("The second source (NASA POWER) has no value for this day yet; this answer rests on one source.");
  else {
    const diff = (a, b) => (a == null || b == null ? null : r1(Math.abs(a - b)));
    second_source = {
      name: "NASA POWER (GEOS reanalysis, about 50 km grid)",
      temp_max_c: cross.temp_max_c,
      temp_min_c: cross.temp_min_c,
      precipitation_mm: cross.precipitation_mm,
      difference: { temp_max_c: diff(out.temp_max_c, cross.temp_max_c), temp_min_c: diff(out.temp_min_c, cross.temp_min_c), precipitation_mm: diff(out.precipitation_mm, cross.precipitation_mm) },
    };
  }
  const agree = second_source && second_source.difference.temp_max_c != null ? second_source.difference.temp_max_c <= 3 : null;

  return {
    answer: `${place.location} on ${day}: high ${out.temp_max_c} °C, low ${out.temp_min_c} °C, ${out.precipitation_mm} mm of precipitation${out.condition ? `, ${out.condition.toLowerCase()}` : ""}.`,
    location: place.location,
    date: day,
    ...out,
    peak_gust_kmh: r1(d.wind_gusts_10m_max?.[0]),
    record_kind: fromArchive ? "reanalysis" : "model analysis (recent day)",
    timezone: data.timezone,
    second_source,
    sources_agree_on_high: agree,
    ...envelope(
      place,
      [
        { name: fromArchive ? "Open-Meteo historical archive" : "Open-Meteo forecast API, past day", url: used, grid_cell: { latitude: data.latitude, longitude: data.longitude, elevation_m: data.elevation } },
        ...(second_source ? [{ name: "NASA POWER daily", url: cross.url }] : []),
      ],
      limitations,
    ),
  };
}

// ---------- WEATHER_CHECK_TEMPERATURE ----------
export async function temperatureNow(place) {
  const url = `${OM}?latitude=${fix4(place.lat)}&longitude=${fix4(place.lon)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code&timezone=UTC`;
  const metUrl = `${METNO}?lat=${fix4(place.lat)}&lon=${fix4(place.lon)}`;
  const second = cached(`met:${fix4(place.lat)},${fix4(place.lon)}`, 10 * 60e3, () => getJson(metUrl, { timeoutMs: 2500, retries: 0, headers: { "User-Agent": UA } })).catch(() => null);
  const data = await cached(`now:${fix4(place.lat)},${fix4(place.lon)}`, 3 * 60e3, () => getJson(url));
  const c = data?.current;
  if (c?.temperature_2m == null) throw new UpstreamError("Open-Meteo returned no current temperature for this point", { url });
  const met = await second;
  const metTemp = met?.properties?.timeseries?.[0]?.data?.instant?.details?.air_temperature ?? null;
  const limitations = ["The temperature is the model's current value for the grid cell that contains the coordinates, updated every 15 minutes. It is not a thermometer at the site."];
  if (metTemp == null) limitations.push("The second source (MET Norway) did not answer in time; this answer rests on one source.");
  return {
    answer: `It is ${c.temperature_2m} °C in ${place.location} as of ${c.time}Z.`,
    location: place.location,
    temperature_c: c.temperature_2m,
    observed_at: `${c.time}Z`,
    feels_like_c: c.apparent_temperature ?? null,
    humidity_pct: c.relative_humidity_2m ?? null,
    wind_kmh: c.wind_speed_10m ?? null,
    gust_kmh: c.wind_gusts_10m ?? null,
    condition: wmoText(c.weather_code),
    second_source: metTemp == null ? null : { name: "MET Norway locationforecast", temperature_c: metTemp, difference_c: r1(Math.abs(metTemp - c.temperature_2m)) },
    ...envelope(
      place,
      [
        { name: "Open-Meteo current conditions", url, grid_cell: { latitude: data.latitude, longitude: data.longitude, elevation_m: data.elevation } },
        ...(metTemp == null ? [] : [{ name: "MET Norway locationforecast", url: metUrl }]),
      ],
      limitations,
    ),
  };
}
