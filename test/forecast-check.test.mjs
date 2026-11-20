// Mission 06: forecasts the fleet bought are scored against the weather recorded for the day they covered.
// Pure scoring tests, then Ledger run through the real buyer, guard and fleet with a stand-in node that replays
// real answers bought from the Telegraph testnet (evidence/). No network, no spend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/src/store.mjs";
import { createBuyer } from "../server/src/buyer.mjs";
import { createFleet } from "../server/src/fleet.mjs";
import { targetDate, dayEnded, pairForecasts, datesToCheck, forecastReport } from "../server/src/forecast-check.mjs";

const load = (f) => JSON.parse(readFileSync(new URL(`../evidence/${f}`, import.meta.url)));
const FORECAST = load("first-request-1795093257948.json"); // 24 h, Fresno: 64% rain, 13.7 / 5.6 °C
const RECORD = load("probe-WEATHER_FORECAST_VERIFY_GENERAL.json"); // Fresno, 2026-11-18: 10.9 mm, 14.4 / 5.6 °C
const FRESNO = { name: "Fresno", region: "California", country: "United States", lat: 36.7378, lon: -119.7871 };
const FARM = { id: "fresno-test", label: "Fresno, California", place: FRESNO, packhouse: FRESNO, gridNode: null };
const AT = "36.7378,-119.7871";
const day = (msAgo) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

const fc = (at, window_hours, result = FORECAST.body.result, farm = FARM.id) => ({ farm, at, params: { location: AT, window_hours }, result, signal_hash: "0xf" });
const rec = (date, result = {}, farm = FARM.id) => ({ farm, at: "x", params: { location: AT, date }, result: { ...RECORD.body.result, date, ...result }, signal_hash: "0xr" });

test("a forecast covers the local date of its window's midpoint, and that day ends at local midnight", () => {
  // bought 13:00 UTC = 05:00 in Fresno; a 24 h window's midpoint is 17:00 local the same day
  assert.equal(targetDate("2026-11-19T13:00:00Z", -119.79, 24), "2026-11-19");
  // bought 06:00 UTC = 22:00 local the day before; a 6 h window's midpoint is 01:00 local on the 19th
  assert.equal(targetDate("2026-11-19T06:00:00Z", -119.79, 6), "2026-11-19");
  assert.equal(dayEnded("2026-11-19", -119.79, Date.parse("2026-11-20T07:59:00Z")), false);
  assert.equal(dayEnded("2026-11-19", -119.79, Date.parse("2026-11-20T08:00:00Z")), true);
});

test("a 24-hour forecast is scored on rain and on the day's high and low", () => {
  const [p] = pairForecasts([fc("2026-11-18T13:00:00Z", 24)], [rec("2026-11-18")]);
  assert.equal(p.date, "2026-11-18");
  assert.equal(p.rained, true); // 10.9 mm
  assert.equal(p.rain_call_right, true); // 64% said rain
  assert.equal(p.brier, 0.13); // (0.64 - 1)^2
  assert.equal(p.high_err, -0.7); // 13.7 forecast vs 14.4 recorded
  assert.equal(p.low_err, 0); // 5.6 vs 5.56
});

test("a 6-hour forecast is scored on rain only", () => {
  const [p] = pairForecasts([fc("2026-11-18T13:00:00Z", 6, { ...FORECAST.body.result, precipitation_probability_pct: 20 })], [rec("2026-11-18")]);
  assert.equal(p.horizon_h, 6);
  assert.equal(p.rain_call_right, false); // said 20%, it rained 10.9 mm
  assert.equal(p.brier, 0.64);
  assert.equal(p.high_err, null);
  assert.equal(p.said.high, null);
});

test("a dry day under a low rain chance is a right call; other sites' records are never used", () => {
  const pairs = pairForecasts(
    [fc("2026-11-18T13:00:00Z", 24, { ...FORECAST.body.result, precipitation_probability_pct: 10 })],
    [rec("2026-11-18", {}, "other-farm"), rec("2026-11-18", { precipitation_mm: 0.2 })],
  );
  assert.equal(pairs[0].rained, false);
  assert.equal(pairs[0].rain_call_right, true);
  assert.equal(pairs[0].brier, 0.01);
});

test("a forecast waits until its day is over, and old unchecked days are not bought any more", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const pairs = pairForecasts([fc("2026-11-20T09:00:00Z", 24), fc("2026-11-18T13:00:00Z", 24), fc("2026-10-01T13:00:00Z", 24)], []);
  assert.deepEqual(pairs.map((p) => p.recorded), [null, null, null]);
  assert.deepEqual(datesToCheck(pairs, now), ["2026-11-18"]); // the 20th is not over; Oct 1 is too old
});

test("the report groups by site and horizon", () => {
  const pairs = pairForecasts(
    [fc("2026-11-18T13:00:00Z", 24), fc("2026-11-18T13:00:00Z", 6), fc("2026-11-18T13:00:00Z", 24, FORECAST.body.result, "salinas")],
    [rec("2026-11-18"), rec("2026-11-18", {}, "salinas")],
  );
  const r = forecastReport(pairs, Date.parse("2026-11-20T12:00:00Z"));
  assert.equal(r.scored, 3);
  assert.deepEqual(r.groups.map((g) => [g.farm, g.horizon_h, g.scored]), [["fresno-test", 24, 1], ["salinas", 24, 1], ["fresno-test", 6, 1]]);
  assert.equal(r.groups.find((g) => g.horizon_h === 6).high_mae_c, null);
  assert.equal(r.high_mae_c, 0.7);
});

function rig({ missing = [] } = {}) {
  const store = openStore(mkdtempSync(join(tmpdir(), "swarm-fc-")));
  const asked = [];
  const tg = {
    intentMiners: async () => ({ miners: [] }),
    askEscrow: async (body) => {
      asked.push([body.intent, body.params.date ?? body.params.window_hours ?? null]);
      if (body.intent === "WEATHER_FORECAST_VERIFY_GENERAL") {
        const r = structuredClone(RECORD);
        r.body.result.date = body.params.date;
        if (missing.includes(body.params.date)) Object.assign(r.body.result, { temp_max_c: null, temp_min_c: null, precipitation_mm: null }); // record not published yet
        return r;
      }
      if (body.intent === "WEATHER_FORECAST_GENERAL") return structuredClone(FORECAST);
      return load("probe-TASK_EXECUTION_QUALITY_GENERAL.json");
    },
  };
  const fleet = createFleet({ store, buy: createBuyer({ tg, store, budget: { canSpend: () => ({ ok: true }) } }) });
  const past = (at) => store.addPurchase({ at, farm: FARM.id, machine: "ledger", intent: "WEATHER_FORECAST_GENERAL", params: { location: AT, window_hours: 24 },
    attempt: 1, routed: "telegraph", status: 200, cost_usd: 0.01, verdict: "accepted", checks: [], result: FORECAST.body.result, signal_hash: "0xold" });
  const report = () => forecastReport(pairForecasts(store.acceptedAnswers("WEATHER_FORECAST_GENERAL"), store.acceptedAnswers("WEATHER_FORECAST_VERIFY_GENERAL")));
  return { store, fleet, asked, past, report };
}

test("Ledger buys the record for a past forecast's day, scores it, and buys a new forecast to check later", async () => {
  const { fleet, asked, past, report } = rig();
  const at = new Date(Date.now() - 4 * 86400e3).toISOString();
  past(at);
  const target = targetDate(at, FRESNO.lon, 24);
  const d = await fleet.decide("ledger", FARM);
  assert.deepEqual(asked.slice(0, 3), [["WEATHER_FORECAST_VERIFY_GENERAL", day(86400e3)], ["WEATHER_FORECAST_VERIFY_GENERAL", target], ["WEATHER_FORECAST_GENERAL", 24]]);
  assert.match(d.summary, /Forecasts checked so far: 1; rain called right 1 of 1, day's high off by 0\.7 °C/);
  const r = report();
  assert.equal(r.scored, 1);
  assert.equal(r.waiting, 1); // the forecast Ledger just bought
  assert.equal(r.rows[0].date, target);
});

test("a day whose record is not published yet stays waiting and is bought again on the next run", async () => {
  const at = new Date(Date.now() - 4 * 86400e3).toISOString();
  const target = targetDate(at, FRESNO.lon, 24);
  const { fleet, asked, past, report } = rig({ missing: [target] });
  past(at);
  await fleet.decide("ledger", FARM);
  assert.equal(report().scored, 0);
  assert.ok(report().overdue.includes(target));
  asked.length = 0;
  await fleet.decide("ledger", FARM);
  assert.ok(asked.some(([i, dt]) => i === "WEATHER_FORECAST_VERIFY_GENERAL" && dt === target), "asked for the same day again");
});
