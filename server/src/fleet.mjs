// The fleet: four simulated machines on a real farm location. Every decision buys real Telegraph answers,
// runs them through the guard, and only then acts. Machines never act on an answer the guard rejected.

export const DEFAULT_FARM = {
  id: "kerman-ca",
  label: "Kerman, California",
  place: { name: "Kerman", region: "California", country: "United States", lat: 36.72356, lon: -120.05988 },
  packhouse: { name: "Fresno", region: "California", country: "United States", lat: 36.74773, lon: -119.77237 },
  gridNode: "TH_ZP26_GEN-APND", // CAISO day-ahead zone covering the Central Valley
};

export const MACHINES = [
  { id: "kite", name: "Kite", type: "spray-drone", job: "Spray block 3 if wind and rain allow" },
  { id: "mule", name: "Mule", type: "rover", job: "Charge in the cheaper of this hour or 3 hours from now" },
  { id: "haul", name: "Haul", type: "truck", job: "Leave for the packhouse if the drive fits the 45-minute cold-chain window" },
  { id: "lark", name: "Lark", type: "scout-drone", job: "Check satellite imagery for standing water before irrigating" },
  { id: "ledger", name: "Ledger", type: "auditor", job: "Check yesterday's spray call against what the weather actually did" },
];

const LIMITS = { gustKmh: 15, rainPct: 40, coldChainMin: 45 };

// Read a verified satellite answer: "wet", "dry" or "inconclusive". Clouds or "can't tell" always win,
// because a machine should not act on imagery that never saw the ground.
export function readImagery(sat) {
  const text = `${sat.summary ?? ""} ${[].concat(sat.findings ?? []).join(" ")} ${sat.brief ?? ""}`;
  if (/cloud|obscur|impossible to (determine|tell|observe)|cannot (determine|tell|see)|not visible|unclear|inconclusive/i.test(text)) return "inconclusive";
  if (/\bno (visible |signs? of )?(standing water|flood|ponding)/i.test(text)) return "dry";
  if (/(shows?|visible|evidence of|detected|observed)[^.]{0,50}(standing water|flood|ponding|inundat)/i.test(text)) return "wet";
  return "dry";
}
const placeStr = (p) => [p.name, p.region].filter(Boolean).join(", ");
const placeFull = (p) => [p.name, p.region, p.country].filter(Boolean).join(", "); // country stops "Kerman" resolving to Iran
const hourIso = (offsetH = 0) => new Date((Math.floor(Date.now() / 3600e3) + offsetH) * 3600e3).toISOString().replace(".000", "");

// Geocode a farm typed by a visitor ("Town, Region"). Open-Meteo geocoding, no key. Setup only, not a decision input.
export async function geocode(text) {
  const [name, ...rest] = String(text).split(",").map((s) => s.trim()).filter(Boolean);
  if (!name) throw new Error("type a town, e.g. Salinas, California");
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10`).then((x) => x.json());
  const hint = rest.join(" ").toLowerCase();
  const hit = (r.results ?? []).find((g) => !hint || `${g.admin1} ${g.country} ${g.country_code}`.toLowerCase().includes(hint)) ?? r.results?.[0];
  if (!hit) throw new Error(`could not find "${text}"`);
  return { name: hit.name, region: hit.admin1 ?? null, country: hit.country, lat: hit.latitude, lon: hit.longitude };
}

export async function farmFromInput(farmText, packhouseText) {
  const place = await geocode(farmText);
  const packhouse = await geocode(packhouseText || place.region || place.name);
  const inCalifornia = place.region === "California" && place.country === "United States";
  return {
    id: `${place.name}-${place.region ?? place.country}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label: placeStr(place),
    place,
    packhouse,
    gridNode: inCalifornia ? (place.lat > 37.5 ? "TH_NP15_GEN-APND" : "TH_ZP26_GEN-APND") : null,
  };
}

export function createFleet({ store, buy, emit = () => {} }) {
  async function decide(machineId, farm = DEFAULT_FARM, opts = {}) {
    const m = MACHINES.find((x) => x.id === machineId);
    if (!m) throw new Error(`unknown machine ${machineId}`);
    const ctx = { farm: farm.id, machine: m.id, place: farm.place, forceMinerId: opts.forceMinerId };
    const bought = [];
    const get = async (intent, params, extra = {}) => {
      const r = await buy({ ...ctx, intent, params, ...extra });
      bought.push(...r.attempts);
      return r.accepted?.result ? JSON.parse(JSON.stringify(r.accepted.result)) : null;
    };
    emit({ type: "thinking", farm: farm.id, machine: m.id });

    let outcome = "unverified";
    let summary = "";
    const where = placeFull(farm.place);
    // Weather miners geocode names loosely ("Kerman, California" came back as Kerman, Iran), so weather asks use coordinates.
    const at = `${farm.place.lat.toFixed(4)},${farm.place.lon.toFixed(4)}`;

    if (m.id === "kite") {
      const storm = await get("STORM_ALERT_GENERAL", { location: at, window_hours: 6 });
      const fc = storm && (await get("WEATHER_FORECAST_GENERAL", { location: at, window_hours: 6 }, { forceMinerId: undefined }));
      if (!storm || !fc) summary = "Could not get a verified wind and rain answer, so the drone stays on the pad.";
      else {
        const gust = storm.peak_gust_kmh;
        const rain = fc.precipitation_probability_pct;
        const reasons = [];
        if (gust > LIMITS.gustKmh) reasons.push(`gusts ${gust} km/h (limit ${LIMITS.gustKmh})`);
        if (rain > LIMITS.rainPct) reasons.push(`${rain}% rain chance (limit ${LIMITS.rainPct}%)`);
        if (["HIGH", "SEVERE", "EXTREME"].includes(String(storm.risk_level).toUpperCase())) reasons.push(`storm risk ${storm.risk_level}`);
        outcome = reasons.length ? "hold" : "act";
        summary = reasons.length ? `Holds spraying: ${reasons.join(", ")}.` : `Sprays block 3: gusts ${gust} km/h, ${rain}% rain chance.`;
      }
    } else if (m.id === "mule") {
      if (!farm.gridNode) summary = `No verified wholesale power market for ${where} yet, so the rover charges on its normal schedule.`;
      else {
        const prefer = { prefer: ["caiso"] }; // on a re-buy, try miners that say they serve this market first
        const now = await get("GRID_POWER_PRICE_GENERAL", { node_or_zone: farm.gridNode, interval_start: hourIso(0) }, prefer);
        const later = now && (await get("GRID_POWER_PRICE_GENERAL", { node_or_zone: farm.gridNode, interval_start: hourIso(3) }, prefer));
        if (now == null || later == null) summary = "Could not get two verified power prices, so the rover keeps its current plan.";
        else {
          const a = now.lmp_usd_per_mwh;
          const b = later.lmp_usd_per_mwh;
          outcome = a <= b ? "act" : "hold";
          summary = a <= b
            ? `Charges now at $${a.toFixed(2)}/MWh (3 hours later: $${b.toFixed(2)}).`
            : `Waits 3 hours: $${b.toFixed(2)}/MWh then vs $${a.toFixed(2)} now.`;
        }
      }
    } else if (m.id === "haul") {
      const eta = await get(
        "ROUTE_ETA_GENERAL",
        { origin: where, destination: placeStr(farm.packhouse) },
        { origin: farm.place, destination: farm.packhouse },
      );
      if (!eta) summary = "Could not get a verified drive time, so the truck waits.";
      else {
        const min = Math.round(eta.duration / 60);
        outcome = min <= LIMITS.coldChainMin ? "act" : "hold";
        summary = outcome === "act"
          ? `Leaves for ${farm.packhouse.name}: ${min} min drive fits the ${LIMITS.coldChainMin}-min cold chain.`
          : `Holds the load: ${min} min to ${farm.packhouse.name} breaks the ${LIMITS.coldChainMin}-min cold chain.`;
      }
    } else if (m.id === "lark") {
      const d = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
      const { lat, lon } = farm.place;
      const img = `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME=${d}&BBOX=${(lat - 0.1).toFixed(3)},${(lon - 0.14).toFixed(3)},${(lat + 0.1).toFixed(3)},${(lon + 0.14).toFixed(3)}&CRS=EPSG:4326&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&WRAP=day&FORMAT=image/jpeg&WIDTH=512&HEIGHT=512`;
      const sat = await get("SATELLITE_IMAGERY_ANALYSIS_GENERAL", {
        location: `${lat.toFixed(4)},${lon.toFixed(4)} (${where})`,
        question: `Is there standing water or flooding in the fields? image_url=${img}`,
      });
      if (!sat) summary = "No satellite answer passed the checks (wrong place or no imagery analysed), so irrigation stays on its schedule.";
      else {
        const read = readImagery(sat);
        if (read === "inconclusive") {
          outcome = "unverified";
          summary = `Imagery from ${sat.capture_date} is inconclusive (${sat.brief || "cloud cover"}), so irrigation stays on its normal schedule.`;
        } else {
          const wet = read === "wet";
          outcome = wet ? "hold" : "act";
          summary = wet ? `Pauses irrigation: imagery from ${sat.capture_date} shows standing water.` : `Irrigates on schedule: imagery from ${sat.capture_date} shows no standing water.`;
        }
      }
    } else if (m.id === "ledger") {
      const yday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
      const rec = await get("WEATHER_FORECAST_VERIFY_GENERAL", { location: at, date: yday });
      const lastKite = store.recent(50, farm.id).find((x) => x.machine === "kite" && x.at.slice(0, 10) <= yday && x.outcome !== "unverified");
      if (!rec) summary = "Could not get verified records for yesterday, so no audit today.";
      else if (!lastKite) {
        outcome = "act";
        summary = `Yesterday in ${farm.place.name}: ${rec.precipitation_mm ?? "?"} mm rain, high ${rec.temp_max_c?.toFixed?.(1) ?? "?"} °C. No spray call from yesterday to audit yet.`;
      } else {
        const q = await get("TASK_EXECUTION_QUALITY_GENERAL", {
          task: `Only spray when gusts are under ${LIMITS.gustKmh} km/h and rain chance under ${LIMITS.rainPct}%. Weather recorded that day: ${rec.precipitation_mm} mm rain.`,
          result: lastKite.summary,
        });
        outcome = q ? "act" : "unverified";
        summary = q ? `Yesterday's spray call "${lastKite.summary}" was judged: ${q.verdict}. ${q.reason ?? ""}` : "The judge's answer did not pass the checks.";
      }
    }

    const cost = bought.reduce((s, p) => s + (p.cost_usd || 0), 0);
    const decision = { at: new Date().toISOString(), farm: farm.id, machine: m.id, kind: m.type, outcome, summary, cost_usd: cost, trigger: opts.trigger ?? "auto" };
    decision.id = store.addDecision(decision);
    store.linkPurchases(decision.id, bought.filter((p) => p.id).map((p) => p.id));
    const full = { ...decision, purchases: bought.filter((p) => p.id) };
    emit({ type: "decision", decision: full });
    return full;
  }

  return { decide, machines: MACHINES };
}
