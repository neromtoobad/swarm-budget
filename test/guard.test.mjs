// Guard tests against real answers bought from the Telegraph testnet (fixtures in evidence/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { judge, placeMatches, coordsInText } from "../server/src/guard.mjs";

const FRESNO = { name: "Fresno", region: "California", lat: 36.7378, lon: -119.7871 };
const KERMAN = { name: "Kerman", region: "California", lat: 36.7238, lon: -120.06 };
const load = (f) => JSON.parse(readFileSync(new URL(`../evidence/${f}`, import.meta.url)));
const verdictOf = (f, place, extra = {}) => {
  const e = load(f);
  return judge(e, { intent: e.intent ?? e.request?.intent, params: e.params ?? e.request?.params, place, ...extra });
};

test("Fresno forecast from the first paid request is accepted", () => {
  const e = load("first-request-1795093257948.json");
  const v = judge(e, { intent: e.request.intent, params: e.request.params, place: FRESNO });
  assert.equal(v.verdict, "accepted", JSON.stringify(v.checks));
});

test("storm alert for Fresno is accepted", () => {
  assert.equal(verdictOf("probe-STORM_ALERT_GENERAL.json", FRESNO).verdict, "accepted");
});

test("Estonian grid price with no node, market or currency is rejected", () => {
  const v = verdictOf("probe-GRID_POWER_PRICE_GENERAL.json", FRESNO);
  assert.equal(v.verdict, "rejected");
  assert.ok(v.checks.some((c) => !c.pass && /not tied to a node/.test(c.why)));
});

test("re-bought CAISO price for the exact node is accepted", () => {
  const v = verdictOf("rebuy-GRID_POWER_PRICE_GENERAL-714106.json", FRESNO);
  assert.equal(v.verdict, "accepted", JSON.stringify(v.checks));
});

test("satellite answer about Illinois is rejected for a California farm", () => {
  const v = verdictOf("probe-SATELLITE_IMAGERY_ANALYSIS_GENERAL.json", KERMAN);
  assert.equal(v.verdict, "rejected");
  assert.ok(v.checks.some((c) => !c.pass && /km away/.test(c.why)), JSON.stringify(v.checks));
});

test("satellite answer that analysed no image is rejected", () => {
  assert.equal(verdictOf("rebuy-SATELLITE_IMAGERY_ANALYSIS_GENERAL-7445.json", KERMAN).verdict, "rejected");
});

test("Kerman to Fresno drive time is plausible", () => {
  const v = verdictOf("probe-ROUTE_ETA_GENERAL.json", KERMAN, { origin: KERMAN, destination: FRESNO });
  assert.equal(v.verdict, "accepted", JSON.stringify(v.checks));
});

test("a 25-minute drive for 2,800 km is rejected", () => {
  const e = load("probe-ROUTE_ETA_GENERAL.json");
  const v = judge(e, { intent: e.intent, params: e.params, place: KERMAN, origin: KERMAN, destination: { lat: 41.61, lon: -88.03 } });
  assert.equal(v.verdict, "rejected");
});

test("yesterday's recorded weather and the task judge are accepted", () => {
  assert.equal(verdictOf("probe-WEATHER_FORECAST_VERIFY_GENERAL.json", FRESNO).verdict, "accepted");
  assert.equal(verdictOf("probe-TASK_EXECUTION_QUALITY_GENERAL.json", FRESNO).verdict, "accepted");
});

test("a failed request is never acted on", () => {
  const v = judge({ ok: false, status: 402, body: { reason: "settlement failed" } }, { intent: "WEATHER_FORECAST_GENERAL", params: {}, place: FRESNO });
  assert.equal(v.verdict, "failed");
});

test("place matching uses coordinates when present", () => {
  assert.equal(coordsInText("Near The Fields, Illinois (41.6117, -88.0256)").length, 1);
  assert.equal(placeMatches("Fresno, California, United States", FRESNO).ok, true);
  assert.equal(placeMatches("Berlin, Germany", FRESNO).ok, false);
});
