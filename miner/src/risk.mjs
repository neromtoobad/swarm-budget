// Storm risk: a published rule, not a model's opinion. Every number that moves the score is returned
// in `drivers` with the band it fell in, so a buyer can recompute the grade from the answer alone.

export const LEVELS = ["LOW", "MODERATE", "HIGH", "SEVERE"];

// Each factor has four bands. Inside a band the score moves in a straight line between its edges,
// so 0-0.25 is LOW, 0.25-0.5 MODERATE, 0.5-0.75 HIGH and 0.75-1 SEVERE for every factor.
export const BANDS = {
  // Peak wind gust, km/h. 62 km/h is where gale force (Beaufort 8) starts, 89 km/h storm force (Beaufort 10).
  gust_kmh: [0, 40, 62, 89, 150],
  // Wettest 24 hours in the window, mm.
  precip_24h_mm: [0, 10, 30, 80, 200],
  // Wettest single hour, mm. 7.6 mm/h is the usual line for heavy rain.
  precip_1h_mm: [0, 7.6, 20, 50, 100],
  // Heaviest 24 hours of snowfall, cm.
  snow_24h_cm: [0, 5, 15, 40, 100],
};

export function bandScore(value, edges) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= edges[0]) return 0;
  for (let i = 0; i < 4; i++) {
    if (value < edges[i + 1]) return 0.25 * i + (0.25 * (value - edges[i])) / (edges[i + 1] - edges[i]);
  }
  return 1;
}

export const levelOf = (score) => (score >= 0.75 ? "SEVERE" : score >= 0.5 ? "HIGH" : score >= 0.25 ? "MODERATE" : "LOW");

const bandText = (edges, unit) => (lvl) => {
  const i = LEVELS.indexOf(lvl);
  return i === 3 ? `${edges[3]} ${unit} or more` : `${edges[i]} to ${edges[i + 1]} ${unit}`;
};

// WMO weather codes 95 (thunderstorm), 96 and 99 (thunderstorm with hail).
const THUNDER = { 95: 0.4, 96: 0.6, 99: 0.7 };
// Official alert severity, as the US National Weather Service labels it.
const ALERT = { Minor: 0.2, Moderate: 0.4, Severe: 0.65, Extreme: 0.9 };

// facts: { peakGust, precip24h, precip1h, snow24h, thunderCodes: [..], alerts: [{event, severity}] }
export function assess(facts) {
  const drivers = [];
  const add = (factor, value, unit, score, band) => {
    if (score == null) return;
    drivers.push({ factor, value, unit, level: levelOf(score), score: Number(score.toFixed(3)), band });
  };
  const g = bandScore(facts.peakGust, BANDS.gust_kmh);
  if (g != null) add("peak wind gust", facts.peakGust, "km/h", g, bandText(BANDS.gust_kmh, "km/h")(levelOf(g)));
  const p24 = bandScore(facts.precip24h, BANDS.precip_24h_mm);
  if (p24 != null) add("wettest 24 hours", facts.precip24h, "mm", p24, bandText(BANDS.precip_24h_mm, "mm")(levelOf(p24)));
  const p1 = bandScore(facts.precip1h, BANDS.precip_1h_mm);
  if (p1 != null) add("wettest hour", facts.precip1h, "mm", p1, bandText(BANDS.precip_1h_mm, "mm")(levelOf(p1)));
  const s = bandScore(facts.snow24h, BANDS.snow_24h_cm);
  if (s != null && facts.snow24h > 0) add("heaviest 24 hours of snowfall", facts.snow24h, "cm", s, bandText(BANDS.snow_24h_cm, "cm")(levelOf(s)));
  const worstThunder = Math.max(0, ...(facts.thunderCodes ?? []).map((c) => THUNDER[c] ?? 0));
  if (worstThunder > 0)
    add("thunderstorm in the forecast", facts.thunderCodes.includes(99) || facts.thunderCodes.includes(96) ? "with hail" : "yes", null, worstThunder, "thunderstorm: MODERATE; with hail: HIGH");
  for (const a of facts.alerts ?? []) {
    const sc = ALERT[a.severity];
    if (sc != null) add(`official alert: ${a.event}`, a.severity, null, sc, "Minor LOW, Moderate MODERATE, Severe HIGH, Extreme SEVERE");
  }
  const scored = drivers.map((d) => d.score);
  const risk_score = scored.length ? Number(Math.max(...scored).toFixed(3)) : null;
  return { risk_score, risk_level: risk_score == null ? null : levelOf(risk_score), drivers: drivers.sort((a, b) => b.score - a.score) };
}

// WMO weather interpretation codes -> plain words, and how much each one matters.
const WMO = {
  0: ["Clear sky", 0], 1: ["Mainly clear", 0], 2: ["Partly cloudy", 1], 3: ["Overcast", 2],
  45: ["Fog", 3], 48: ["Freezing fog", 4],
  51: ["Light drizzle", 5], 53: ["Drizzle", 6], 55: ["Heavy drizzle", 7], 56: ["Light freezing drizzle", 8], 57: ["Freezing drizzle", 9],
  61: ["Light rain", 6], 63: ["Rain", 10], 65: ["Heavy rain", 14], 66: ["Light freezing rain", 11], 67: ["Freezing rain", 15],
  71: ["Light snow", 9], 73: ["Snow", 12], 75: ["Heavy snow", 15], 77: ["Snow grains", 8],
  80: ["Light rain showers", 6], 81: ["Rain showers", 10], 82: ["Violent rain showers", 16],
  85: ["Light snow showers", 9], 86: ["Heavy snow showers", 15],
  95: ["Thunderstorm", 18], 96: ["Thunderstorm with hail", 19], 99: ["Thunderstorm with heavy hail", 20],
};
export const wmoText = (code) => WMO[code]?.[0] ?? null;

// One phrase for a run of hours: what the sky mostly does, plus the worst thing that happens.
export function conditionOver(codes) {
  const known = codes.filter((c) => WMO[c]);
  if (!known.length) return null;
  const count = new Map();
  for (const c of known) count.set(c, (count.get(c) ?? 0) + 1);
  const mostly = [...count.entries()].sort((a, b) => b[1] - a[1] || WMO[b[0]][1] - WMO[a[0]][1])[0][0];
  const worst = known.reduce((a, b) => (WMO[b][1] > WMO[a][1] ? b : a));
  if (worst === mostly || WMO[worst][1] <= 2) return WMO[mostly][0];
  const share = count.get(worst) / known.length;
  return share >= 0.5 ? WMO[worst][0] : `${WMO[mostly][0]}, with ${WMO[worst][0].toLowerCase()} at times`;
}
