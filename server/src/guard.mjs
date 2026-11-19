// The guard: decides whether a bought Telegraph answer is safe for a machine to act on.
// Every check is deterministic and explains itself, so a refusal can be shown and audited.

const R = 6371;
export function km(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Pull "(lat, lon)" pairs out of free text, e.g. "Near The Fields, Illinois (41.6117, -88.0256)".
export function coordsInText(text) {
  const out = [];
  const re = /\(?\s*(-?\d{1,2}\.\d{2,})\s*,\s*(-?\d{1,3}\.\d{2,})\s*\)?/g;
  for (const m of String(text ?? "").matchAll(re)) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push({ lat, lon });
  }
  return out;
}

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ");

// Does an echoed place name refer to the place we asked about?
// place = { name: "Kerman", region: "California", country: "United States", lat, lon }
export function placeMatches(echo, place, maxKm = 120) {
  if (!echo) return { ok: null, why: "no place echoed" };
  const pts = coordsInText(echo);
  if (pts.length && place.lat != null) {
    const d = Math.min(...pts.map((p) => km(p, place)));
    return d <= maxKm
      ? { ok: true, why: `echoed coordinates ${Math.round(d)} km from the farm` }
      : { ok: false, why: `answer is about a place ${Math.round(d).toLocaleString("en-US")} km away` };
  }
  const e = norm(echo);
  const tokens = [place.name, place.region].filter(Boolean).map(norm);
  if (tokens.some((t) => t && e.includes(t.trim()))) return { ok: true, why: `echoed "${echo}"` };
  return { ok: false, why: `answer is about "${echo}", not ${[place.name, place.region].filter(Boolean).join(", ")}` };
}

const fail = (why) => ({ pass: false, why });
const okk = (why) => ({ pass: true, why });

// Per-intent checks. Each gets (result, body, ctx) and returns a list of {pass, why}.
const CHECKS = {
  WEATHER_FORECAST_GENERAL(res, body, ctx) {
    const c = [];
    const pm = placeMatches(res.location, ctx.place);
    c.push(pm.ok === false ? fail(pm.why) : okk(pm.why));
    const p = res.precipitation_probability_pct;
    c.push(p == null ? fail("no rain probability in the answer") : p >= 0 && p <= 100 ? okk(`rain chance ${p}%`) : fail(`rain chance ${p}% is out of range`));
    return c;
  },
  STORM_ALERT_GENERAL(res, body, ctx) {
    const c = [];
    const pm = placeMatches(res.location, ctx.place);
    c.push(pm.ok === false ? fail(pm.why) : okk(pm.why));
    const g = res.peak_gust_kmh;
    c.push(g == null ? fail("no gust speed in the answer") : g >= 0 && g < 400 ? okk(`peak gust ${g} km/h`) : fail(`gust ${g} km/h is not plausible`));
    if (res.risk_level == null) c.push(fail("no storm risk level"));
    return c;
  },
  GRID_POWER_PRICE_GENERAL(res, body, ctx) {
    const c = [];
    const asked = ctx.params.node_or_zone;
    c.push(
      res.node_or_zone == null
        ? fail(`price not tied to a node (asked ${asked})`)
        : String(res.node_or_zone).toUpperCase() === String(asked).toUpperCase()
          ? okk(`priced at ${res.node_or_zone}`)
          : fail(`priced at ${res.node_or_zone}, asked ${asked}`),
    );
    c.push(res.currency == null ? fail("no currency stated") : res.currency === "USD" ? okk("in USD") : fail(`price is in ${res.currency}, not USD`));
    if (res.interval_start && ctx.params.interval_start) {
      const dt = Math.abs(Date.parse(res.interval_start) - Date.parse(ctx.params.interval_start));
      c.push(dt <= 3600e3 ? okk("for the hour asked") : fail(`for ${res.interval_start}, not the hour asked`));
    }
    const v = res.lmp_usd_per_mwh;
    c.push(v == null ? fail("no price") : v > -500 && v < 5000 ? okk(`$${v.toFixed(2)}/MWh`) : fail(`$${v}/MWh is not plausible`));
    return c;
  },
  ROUTE_ETA_GENERAL(res, body, ctx) {
    const c = [];
    const s = res.duration;
    if (s == null || !(s > 0)) return [fail("no drive time in the answer")];
    if (ctx.origin?.lat != null && ctx.destination?.lat != null) {
      const d = km(ctx.origin, ctx.destination);
      const kmh = d / (s / 3600);
      // straight-line speed: roads are longer than the crow flies, so 8–110 km/h is the honest band
      c.push(kmh >= 8 && kmh <= 110 ? okk(`${Math.round(s / 60)} min for ${Math.round(d)} km straight-line`) : fail(`${Math.round(s / 60)} min for ${Math.round(d)} km is ${Math.round(kmh)} km/h, not a real drive`));
    } else c.push(okk(`${Math.round(s / 60)} min`));
    return c;
  },
  SATELLITE_IMAGERY_ANALYSIS_GENERAL(res, body, ctx) {
    const c = [];
    const pm = placeMatches(`${res.location ?? ""} ${coordsInText(res.summary).length ? res.summary : ""}`.trim() || null, ctx.place);
    c.push(pm.ok === false ? fail(pm.why) : pm.ok ? okk(pm.why) : fail("imagery not tied to a place"));
    const s = String(res.summary ?? "");
    if (/no image|not supplied|cannot access|can't access|unable to (view|access)|no image classification/i.test(s)) c.push(fail("no imagery was actually analysed"));
    if (!res.capture_date) c.push(fail("no capture date"));
    return c;
  },
  WEATHER_CHECK_TEMPERATURE(res) {
    const t = res.temperature_c;
    return [t == null ? fail("no temperature") : t > -60 && t < 60 ? okk(`${t} °C`) : fail(`${t} °C is not plausible`)];
  },
  WEATHER_FORECAST_VERIFY_GENERAL(res, body, ctx) {
    const c = [];
    const pm = placeMatches(res.location, ctx.place);
    c.push(pm.ok === false ? fail(pm.why) : okk(pm.why));
    c.push(res.date === ctx.params.date ? okk(`records for ${res.date}`) : fail(`records for ${res.date}, asked ${ctx.params.date}`));
    if (res.temp_max_c == null && res.precipitation_mm == null) c.push(fail("no recorded values"));
    return c;
  },
  TASK_EXECUTION_QUALITY_GENERAL(res) {
    return [["satisfies", "partially_satisfies", "fails"].includes(res.verdict) ? okk(`verdict: ${res.verdict}`) : fail("no verdict")];
  },
};

// Main entry. resp = the askEscrow()/ask() return value. ctx = { intent, params, place, origin, destination }.
export function judge(resp, ctx) {
  const checks = [];
  if (!resp.ok) {
    return { verdict: "failed", checks: [fail(`request failed (${resp.status})${resp.body?.reason ? `: ${resp.body.reason}` : ""}`)] };
  }
  const body = resp.body ?? {};
  const res = body.result;
  if (res == null || typeof res !== "object") return { verdict: "rejected", checks: [fail("no answer in the reply")] };
  const rejected = Object.entries(body.field_status ?? {}).filter(([, v]) => v === "rejected").map(([k]) => k);
  if (rejected.length) checks.push(okk(`node rejected optional field(s): ${rejected.join(", ")}`));
  const fn = CHECKS[ctx.intent];
  checks.push(...(fn ? fn(res, body, ctx) : [okk("no specific checks for this intent")]));
  return { verdict: checks.every((c) => c.pass) ? "accepted" : "rejected", checks };
}

export const GUARDED_INTENTS = Object.keys(CHECKS);
