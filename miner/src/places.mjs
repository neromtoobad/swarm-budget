// Place resolution: turn whatever the buyer sent into ONE place with coordinates, or refuse and say why.
//
// "Kerman, California"  -> Kerman, California, United States (36.7236, -120.0599)
// "Kerman"              -> Kerman, Iran (the far larger one), with Kerman, California listed in also_matches
// "Springfield"         -> refused: three towns of similar size share the name
// "36.7236,-120.0599"   -> used as given, labelled with the nearest town when one can be found
//
// A qualifier is never dropped. "Paris, Texas" can only resolve to a Paris in Texas; if no Paris in
// Texas is found the request is refused. It never falls back to Paris, France.

import { getJson, cached } from "./http.mjs";

export class PlaceError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.status = code === "place_not_found" ? 404 : 422;
    this.extra = extra;
  }
}

const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const UA = "pinpoint-weather-miner/1.0 (+https://github.com/neromtoobad/swarm-budget)";

export const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// For comparing place NAMES: "Saint Louis" and "St. Louis" are the same town, "New York City" is "New York".
export const nameKey = (s) =>
  norm(s)
    .replace(/\bsaint\b/g, "st")
    .replace(/\bsainte\b/g, "ste")
    .replace(/\bmount\b/g, "mt")
    .replace(/\bfort\b/g, "ft")
    .replace(/\s+city$/, "");

export const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", PR: "Puerto Rico",
};
const CA_PROVINCES = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan",
};
const AU_STATES = { NSW: "New South Wales", QLD: "Queensland", VIC: "Victoria", TAS: "Tasmania" };

// Names people use for a country that are not its GeoNames name. Keys are already normalised.
const COUNTRY_ALIASES = {
  usa: "US", us: "US", "u s": "US", "u s a": "US", america: "US", "united states of america": "US", "the united states": "US",
  uk: "GB", "u k": "GB", britain: "GB", "great britain": "GB", "the united kingdom": "GB",
  uae: "AE", "the netherlands": "NL", holland: "NL", "south korea": "KR", korea: "KR", "north korea": "KP",
  russia: "RU", iran: "IR", syria: "SY", vietnam: "VN", "viet nam": "VN", laos: "LA", bolivia: "BO", venezuela: "VE",
  tanzania: "TZ", "ivory coast": "CI", "cote d ivoire": "CI", "czech republic": "CZ", czechia: "CZ", turkey: "TR",
  turkiye: "TR", "dr congo": "CD", drc: "CD", "democratic republic of the congo": "CD", "republic of the congo": "CG",
  burma: "MM", myanmar: "MM", "the philippines": "PH", "the gambia": "GM", "the bahamas": "BS", macedonia: "MK",
  "north macedonia": "MK", moldova: "MD", palestine: "PS", taiwan: "TW", "hong kong": "HK", macau: "MO", brunei: "BN",
  "cape verde": "CV", swaziland: "SZ", eswatini: "SZ", "east timor": "TL", "timor leste": "TL",
};
// The four nations of the UK are admin1 in GeoNames, so "London, England" works without help. These
// names are also countries in everyday speech, so accept them as a country qualifier for GB.
const GB_NATIONS = new Set(["england", "scotland", "wales", "northern ireland"]);

let regionNames;
function countryName(code) {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code);
  } catch {
    return undefined;
  }
}

// ---------- reading the request ----------

// "36.7236,-120.0599", "(36.72, -120.06)", "36.72 -120.06", "36.72N 120.06W"
export function parseCoords(text) {
  const t = String(text ?? "").trim();
  let m = t.match(/^\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?\s*\)?$/i);
  if (!m) m = t.match(/^(?:lat(?:itude)?)\s*[:=]?\s*(-?\d{1,2}(?:\.\d+)?)()\s*[,;\s]\s*(?:lon(?:g|gitude)?)\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)()$/i);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2] && m[2].toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4] && m[4].toUpperCase() === "W") lon = -Math.abs(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const TIME_WORDS =
  "in the next|in the coming|over the next|over the coming|during the next|during|within the next|within|for the next|for the coming|through the next|next|today|tonight|tomorrow|this (?:morning|afternoon|evening|week|weekend)|on|between|from|by|right now|now|currently|at the moment|at this moment|before|after|until|yesterday|last|as of|\\d";
const LEAD_WORDS = "in|for|at|near|around|over|of|across|hit|hits|hitting|reach|reaches|reaching|affect|affects|affecting|threaten|threatens|threatening";

// Pull the place out of a whole sentence: "Is there a storm risk in Paris, Texas in the next 6 hours?" -> "Paris, Texas"
const FUNCTION_WORDS = /^(in|at|on|for|with|and|or|expressed|measured|please|right|as|to|from|by|during|over|within|before|after|until|if|is|are|was|were|will|did|does|do|how|what|when|the)\b/i;
const NOT_A_PLACE = new Set(["is", "are", "will", "what", "whats", "how", "does", "do", "did", "should", "can", "could", "any", "give", "tell", "check", "storm", "weather", "forecast", "was", "were", "has", "have", "when", "which", "please", "i", "celsius", "fahrenheit", "utc", "gmt", "c", "f", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "today", "tonight", "tomorrow", "yesterday", "json", "yaml", "english", "km", "mm"]);

// "Karachi, in degrees Celsius" -> "Karachi". Region and country qualifiers are written with a capital
// letter or as a code; a comma followed by an ordinary lowercase word ends the place.
function trimPlace(text, lowercaseInput = false) {
  const parts = String(text).split(",").map((x) => x.trim()).filter(Boolean);
  const keep = [];
  for (const [i, part] of parts.entries()) {
    if (i > 0 && (lowercaseInput ? FUNCTION_WORDS.test(part) : !/^[\p{Lu}\d]/u.test(part) || FUNCTION_WORDS.test(part))) break;
    keep.push(part);
  }
  if (!lowercaseInput && keep.length) {
    // "Kerman, California, USA fly" -> drop ordinary words that trail the name.
    const words = keep[keep.length - 1].split(/\s+/);
    while (words.length > 1 && /^\p{Ll}/u.test(words[words.length - 1])) words.pop();
    keep[keep.length - 1] = words.join(" ");
  }
  let out = keep.join(", ").replace(/[\s,]+$/, "").trim();
  // A full stop that ends the sentence is not part of the name; the ones in "D.C." are.
  if (/\.$/.test(out) && !/\.\p{L}+\.$/u.test(out)) out = out.slice(0, -1).trim();
  return out || null;
}

export function placeFromQuestion(text) {
  const q = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!q) return null;
  const coords = q.match(/-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+/);
  if (coords) return coords[0];
  // A place ends at a time phrase, at ? ! ; : or at a full stop that ends the sentence ("St. Louis" and "D.C." carry on).
  const stop = `(?=\\s+(?:${TIME_WORDS})\\b|\\s*[?!;:]|(?<!\\b(?:St|Mt|Ft|Pt|Ste|Sta|Dr))\\.\\s+\\p{Lu}|\\.?\\s*$|\\s+-\\s)`;

  // 1. After a lead word, starting with a capital letter: "... in Paris, Texas in the next 6 hours?"
  const cap = new RegExp(`\\b(?:${LEAD_WORDS})\\s+((?:the\\s+)?[\\p{Lu}][^?!;:]*?)${stop}`, "gu");
  let best = null;
  for (const m of q.matchAll(cap)) {
    if (NOT_A_PLACE.has(norm(m[1]).split(" ")[0])) continue;
    best = m[1]; // the first place named wins: "Storm risk in Lagos. Reply in JSON."
    break;
  }
  if (best) {
    if (!/^the\s+(hague|bronx|gambia|bahamas|dalles|woodlands|villages)\b/i.test(best)) best = best.replace(/^the\s+/i, "");
    return trimPlace(best);
  }

  // 2. Possessive: "London's high on 10 September 2026 was forecast at 21 C"
  const poss = q.match(/((?:[\p{Lu}][\p{L}.\-]*(?:,?\s+)?)+)['’]s\b/u);
  if (poss && !NOT_A_PLACE.has(norm(poss[1]).split(" ")[0])) return trimPlace(poss[1]);

  // 3. A run of capitalised words that is not the opening question word: "Will Chicago see storms tonight?"
  const runs = [...q.matchAll(/(?:[\p{Lu}][\p{L}.\-']*|\b[A-Z]{2,3}\b)(?:,?\s+(?:[\p{Lu}][\p{L}.\-']*|[A-Z]{2,3}\b))*/gu)]
    .map((m) => m[0].split(/\s+/).filter((w, i, arr) => !(i === 0 && NOT_A_PLACE.has(norm(w)))).join(" "))
    .map((r) => r.replace(/^(?:(?:Is|Are|Will|What|How|Does|Do|Did|Should|Can|Could|Any|Give|Tell|Check|Was|Were|Has|Have|When|Which|Storm|Weather|Forecast)\s+)+/, "").trim())
    .filter((r) => r && !NOT_A_PLACE.has(norm(r)));
  if (runs.length) return trimPlace(runs.sort((x, y) => y.length - x.length)[0]);

  // 4. All-lowercase input: "weather in paris, texas tomorrow"
  const low = new RegExp(`\\b(?:in|for|at|near|around)\\s+((?!the next|the coming|the last)[\\p{L}][^?!;:]*?)${stop}`, "giu");
  for (const m of q.matchAll(low)) best = m[1];
  return best ? trimPlace(best, true) : null;
}

const looksLikeSentence = (t) => /\?/.test(t) || t.split(/\s+/).length > 6 || /^(is|are|will|what|how|does|do|should|can|could|any|give|tell|check|storm|weather|forecast|did|was|were|has|have|when)\b/i.test(t);

// What did the buyer mean? Returns { text, coords } where text is the place phrase to look up.
export function readPlaceRequest({ location, question } = {}) {
  const loc = String(location ?? "").trim();
  const q = String(question ?? "").trim();
  if (loc) {
    const c = parseCoords(loc);
    if (c) return { coords: c, text: loc, from: "location" };
    if (!looksLikeSentence(loc)) return { text: loc, from: "location" };
    const inner = placeFromQuestion(loc);
    if (inner) return parseCoords(inner) ? { coords: parseCoords(inner), text: inner, from: "location" } : { text: inner, from: "location" };
    return { text: loc, from: "location" };
  }
  if (q) {
    const inner = placeFromQuestion(q);
    if (inner) return parseCoords(inner) ? { coords: parseCoords(inner), text: inner, from: "question" } : { text: inner, from: "question" };
  }
  return null;
}

// "Kerman, California, USA" -> { name: "Kerman", qualifiers: ["California", "USA"] }
// "Austin TX" -> { name: "Austin", qualifiers: ["TX"] }
export function splitPlace(text) {
  const parts = String(text).split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return { name: parts[0], qualifiers: parts.slice(1) };
  const one = parts[0] ?? "";
  const m = one.match(/^(.+?)\s+([A-Z]{2,3})$/); // trailing state or country code written in capitals
  if (m && (US_STATES[m[2]] || CA_PROVINCES[m[2]] || AU_STATES[m[2]] || COUNTRY_ALIASES[m[2].toLowerCase()])) return { name: m[1].trim(), qualifiers: [m[2]] };
  return { name: one, qualifiers: [] };
}

// Does one qualifier ("California", "CA", "USA", "Fresno County") describe this candidate?
export function qualifierMatches(q, cand) {
  const raw = String(q).trim();
  const n = norm(raw);
  if (!n) return true;
  const cc = String(cand.country_code ?? "").toUpperCase();
  const fields = [cand.admin1, cand.admin2, cand.admin3, cand.country, countryName(cc)].filter(Boolean).map(norm);
  const stripped = (s) => s.replace(/\b(county|province|region|state|governorate|prefecture|district|oblast|parish|department|canton|territory|municipality)\b/g, "").replace(/\s+/g, " ").trim();
  if (fields.some((f) => f === n || stripped(f) === stripped(n))) return true;
  // "Newfoundland" for "Newfoundland and Labrador". Leading words only, so "Virginia" never matches "West Virginia".
  if (n.length >= 4 && fields.some((f) => f.startsWith(`${n} `))) return true;
  if (COUNTRY_ALIASES[n] && COUNTRY_ALIASES[n] === cc) return true;
  if (/^[a-z]{2}$/i.test(raw) && raw.toUpperCase() === cc && raw === raw.toUpperCase()) return true; // ISO code, written in capitals
  const up = raw.toUpperCase().replace(/\./g, "");
  if (cc === "US" && US_STATES[up] && norm(US_STATES[up]) === norm(cand.admin1)) return true;
  if (cc === "CA" && CA_PROVINCES[up] && norm(CA_PROVINCES[up]) === norm(cand.admin1)) return true;
  if (cc === "AU" && AU_STATES[up] && norm(AU_STATES[up]) === norm(cand.admin1)) return true;
  if (cc === "GB" && GB_NATIONS.has(n) && norm(cand.admin1) === n) return true;
  return false;
}

// ---------- looking it up ----------

function toCandidate(r) {
  return {
    name: r.name,
    admin1: r.admin1 ?? null,
    admin2: r.admin2 ?? null,
    admin3: r.admin3 ?? null,
    country: r.country ?? countryName(String(r.country_code ?? "").toUpperCase()) ?? null,
    country_code: r.country_code ? String(r.country_code).toUpperCase() : null,
    lat: r.latitude,
    lon: r.longitude,
    population: r.population ?? null,
    feature_code: r.feature_code ?? null,
    timezone: r.timezone ?? null,
    elevation_m: r.elevation ?? null,
  };
}

async function geocodeByName(name) {
  const url = `${GEOCODE}?name=${encodeURIComponent(name)}&count=30&language=en&format=json`;
  const data = await cached(`geo:${norm(name)}`, 24 * 3600e3, () => getJson(url, { timeoutMs: 6000 }));
  return { url, results: (data?.results ?? []).map(toCandidate) };
}

async function nominatimSearch(text) {
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(text)}&format=jsonv2&addressdetails=1&limit=5&accept-language=en`;
  const rows = await cached(`nom:${norm(text)}`, 24 * 3600e3, () => getJson(url, { timeoutMs: 6000, headers: { "User-Agent": UA } }));
  return {
    url,
    results: (rows ?? []).map((r) => {
      const a = r.address ?? {};
      return {
        name: a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.suburb ?? r.name ?? String(r.display_name ?? "").split(",")[0],
        admin1: a.state ?? a.province ?? a.region ?? null,
        admin2: a.county ?? a.state_district ?? null,
        admin3: null,
        country: a.country ?? null,
        country_code: a.country_code ? String(a.country_code).toUpperCase() : null,
        lat: Number(r.lat),
        lon: Number(r.lon),
        population: null,
        feature_code: r.addresstype ?? r.type ?? null,
        timezone: null,
        elevation_m: null,
      };
    }),
  };
}

const R = 6371;
export function km(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function label(c) {
  const parts = [c.name, c.admin1, c.country].filter(Boolean);
  const out = parts.filter((p, i) => i === 0 || norm(p) !== norm(parts[i - 1]));
  return out.join(", ");
}
export const fix4 = (n) => Number(Number(n).toFixed(4));
export const canonical = (c) => `${label(c)} (${fix4(c.lat).toFixed(4)}, ${fix4(c.lon).toFixed(4)})`;

const BROAD = /^(PCL|ADM1$|ADM1H|CONT|RGN|TERR|ZN)/; // countries, first-order regions, continents
const DOMINANCE = 3; // the largest namesake must be at least this many times bigger than the next

// Pick one candidate among same-name places, or refuse. Pure: tests call it with recorded data.
export function choose(name, qualifiers, candidates, { requested } = {}) {
  const asked = requested ?? [name, ...qualifiers].join(", ");
  const exact = candidates.filter((c) => nameKey(c.name) === nameKey(name));
  const listed = (arr) => arr.slice(0, 6).map((c) => ({ location: canonical(c), population: c.population }));
  if (!exact.length) throw new PlaceError("place_not_found", `No place named "${name}" was found.`, { requested: asked });

  let pool = exact;
  if (qualifiers.length) {
    pool = exact.filter((c) => qualifiers.every((q) => qualifierMatches(q, c)));
    if (!pool.length)
      throw new PlaceError("place_not_found", `No "${name}" was found in ${qualifiers.join(", ")}. Nothing was guessed.`, {
        requested: asked,
        other_places_with_this_name: listed(exact),
      });
  }
  pool = [...pool].sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  const top = pool[0];
  // Namesakes that are a different place (not the same town listed twice, e.g. the city and its district).
  const others = pool.slice(1).filter((c) => km(c, top) > 60);
  const next = others[0];

  if (BROAD.test(top.feature_code ?? "") && !qualifiers.length)
    throw new PlaceError("place_too_broad", `"${name}" is a country or region, not a point. Name a town or send coordinates.`, {
      requested: asked,
      other_places_with_this_name: listed(others),
    });

  const dominant = !next || ((top.population ?? 0) > 0 && (top.population ?? 0) >= DOMINANCE * (next.population ?? 0));
  if (!dominant)
    throw new PlaceError(
      "ambiguous_location",
      `"${asked}" matches several places of similar size. Add a region or country, or send coordinates.`,
      { requested: asked, candidates: listed(pool) },
    );

  return {
    ...top,
    matched: qualifiers.length ? "name and region" : next ? "name only (largest place with this name)" : "name only (the only match)",
    also_matches: listed(others),
  };
}

async function reverseLabel(lat, lon) {
  const url = `${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&addressdetails=1&accept-language=en`;
  try {
    const r = await cached(`rev:${lat.toFixed(3)},${lon.toFixed(3)}`, 24 * 3600e3, () => getJson(url, { timeoutMs: 2500, headers: { "User-Agent": UA }, retries: 0 }));
    const a = r?.address;
    if (!a) return null;
    return {
      name: a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.county ?? null,
      admin1: a.state ?? a.province ?? a.region ?? null,
      country: a.country ?? null,
      country_code: a.country_code ? String(a.country_code).toUpperCase() : null,
    };
  } catch {
    return null; // the label is a courtesy; the coordinates are what the answer is for
  }
}

// Main entry. Returns a resolved place or throws PlaceError.
export async function resolvePlace({ location, question } = {}) {
  const req = readPlaceRequest({ location, question });
  if (!req) throw new PlaceError("missing_location", "Send a place: ?location=Kerman, California or ?location=36.7236,-120.0599", {});

  if (req.coords) {
    const { lat, lon } = req.coords;
    const near = await reverseLabel(lat, lon);
    const name = near?.name ? `Point near ${near.name}` : "Point";
    const c = { name, admin1: near?.admin1 ?? null, country: near?.country ?? null, country_code: near?.country_code ?? null, lat, lon };
    return {
      ...c,
      admin2: null,
      population: null,
      feature_code: null,
      timezone: null,
      elevation_m: null,
      location: `${near?.name ? label(c) : "Point"} (${fix4(lat).toFixed(4)}, ${fix4(lon).toFixed(4)})`,
      requested: req.text,
      matched: "coordinates",
      also_matches: [],
      resolver: near ? "coordinates as sent; label from OpenStreetMap Nominatim" : "coordinates as sent",
      resolver_url: null,
    };
  }

  const { name, qualifiers } = splitPlace(req.text);
  if (!name || name.length > 120) throw new PlaceError("missing_location", "The place name is empty or too long.", { requested: req.text });

  const geo = await geocodeByName(name);
  let picked;
  let resolver = "Open-Meteo geocoding (GeoNames)";
  let resolverUrl = geo.url;
  try {
    picked = choose(name, qualifiers, geo.results, { requested: req.text });
  } catch (e) {
    // GeoNames has no such town (or none in that region): try OpenStreetMap once, and only accept a
    // result that still satisfies every qualifier the buyer gave.
    if (!(e instanceof PlaceError) || e.code !== "place_not_found") throw e;
    let osm;
    try {
      osm = await nominatimSearch(req.text);
    } catch {
      throw e;
    }
    const ok = osm.results.filter((c) => Number.isFinite(c.lat) && nameKey(c.name) === nameKey(name) && qualifiers.every((q) => qualifierMatches(q, c)));
    if (!ok.length || (!qualifiers.length && ok.length > 1 && km(ok[0], ok[1]) > 60)) throw e;
    picked = { ...ok[0], matched: qualifiers.length ? "name and region" : "name only (the only match)", also_matches: [] };
    resolver = "OpenStreetMap Nominatim";
    resolverUrl = osm.url;
  }
  return { ...picked, location: canonical(picked), requested: req.text, resolver, resolver_url: resolverUrl };
}

// The public, compact form of a resolved place that every answer carries.
export function placeBlock(p) {
  return {
    requested: p.requested,
    name: p.name,
    region: p.admin1,
    county: p.admin2 ?? undefined,
    country: p.country,
    country_code: p.country_code,
    latitude: fix4(p.lat),
    longitude: fix4(p.lon),
    population: p.population ?? undefined,
    timezone: p.timezone ?? undefined,
    matched_on: p.matched,
    also_matches: p.also_matches?.length ? p.also_matches : undefined,
    resolver: p.resolver,
  };
}
