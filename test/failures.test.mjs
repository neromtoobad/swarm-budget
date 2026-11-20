// Mission 11 failure tests, run through the real buyer, guard and fleet with a stand-in node that replays
// real answers bought from the Telegraph testnet (evidence/). No network, no spend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/src/store.mjs";
import { createBuyer } from "../server/src/buyer.mjs";
import { createFleet, haulHours } from "../server/src/fleet.mjs";
import { costReport } from "../server/src/costs.mjs";

const load = (f) => JSON.parse(readFileSync(new URL(`../evidence/${f}`, import.meta.url)));
const REPLAY = {
  STORM_ALERT_GENERAL: "probe-STORM_ALERT_GENERAL.json",
  WEATHER_FORECAST_GENERAL: "first-request-1795093257948.json",
  ROUTE_ETA_GENERAL: "probe-ROUTE_ETA_GENERAL.json",
};
const FRESNO = { name: "Fresno", region: "California", country: "United States", lat: 36.7378, lon: -119.7871 };
const KERMAN = { name: "Kerman", region: "California", country: "United States", lat: 36.7238, lon: -120.06 };
const FRESNO_FARM = { id: "fresno-test", label: "Fresno, California", place: FRESNO, packhouse: KERMAN, gridNode: null };
const KERMAN_FARM = { id: "kerman-test", label: "Kerman, California", place: KERMAN, packhouse: FRESNO, gridNode: null };

function rig({ authority = { revoked: false } } = {}) {
  const store = openStore(mkdtempSync(join(tmpdir(), "swarm-")));
  const asked = [];
  const tg = {
    intentMiners: async () => ({ miners: [] }),
    askEscrow: async (body) => {
      asked.push(body.intent);
      return load(REPLAY[body.intent]);
    },
  };
  const budget = { canSpend: () => (authority.revoked ? { ok: false, why: "the farm owner revoked spending permission" } : { ok: true }) };
  const fleet = createFleet({ store, buy: createBuyer({ tg, store, budget }) });
  return { store, fleet, asked, authority };
}

test("baseline: with both answers accepted, Kite decides on them", async () => {
  const { fleet, asked } = rig();
  const d = await fleet.decide("kite", FRESNO_FARM);
  assert.deepEqual(asked, ["STORM_ALERT_GENERAL", "WEATHER_FORECAST_GENERAL"]);
  assert.ok(["act", "hold"].includes(d.outcome), d.summary);
  assert.equal(d.purchases.length, 2);
});

test("revoked spend authorization mid-task: no purchase after the withdrawal, and the drone does not act", async () => {
  const { fleet, asked } = rig();
  const d = await fleet.decide("kite", FRESNO_FARM, { revokeAfter: 1 });
  assert.deepEqual(asked, ["STORM_ALERT_GENERAL"], "the forecast must not be bought after the withdrawal");
  assert.equal(d.outcome, "unverified");
  assert.equal(d.op_hours, 0);
  assert.match(d.summary, /withdrew spending permission after 1 paid answer/);
  assert.equal(d.purchases.length, 1);
});

test("owner's standing revocation: nothing is bought at all", async () => {
  const { fleet, asked } = rig({ authority: { revoked: true } });
  const d = await fleet.decide("haul", KERMAN_FARM);
  assert.deepEqual(asked, []);
  assert.equal(d.cost_usd, 0);
  assert.notEqual(d.outcome, "act");
  assert.match(d.summary, /No purchase was made: the farm owner revoked spending permission/);
});

test("disconnected sensor: Haul holds the load and buys nothing", async () => {
  const { fleet, asked } = rig();
  const d = await fleet.decide("haul", KERMAN_FARM, { offline: ["reefer thermometer"] });
  assert.deepEqual(asked, []);
  assert.equal(d.outcome, "hold");
  assert.equal(d.cost_usd, 0);
  assert.match(d.summary, /reefer thermometer stopped reporting/);
});

test("a completed Haul job records the round trip as operating hours, and the cost report divides by it", async () => {
  const { fleet, store } = rig();
  const d = await fleet.decide("haul", KERMAN_FARM);
  assert.equal(d.outcome, "act", d.summary);
  const min = Number(/(\d+) min drive/.exec(d.summary)[1]);
  assert.equal(d.op_hours, haulHours(min));
  await fleet.decide("haul", KERMAN_FARM, { offline: ["reefer thermometer"] });
  const r = costReport(store.costRows(), [{ id: "haul" }]);
  assert.equal(r.completed_jobs, 1);
  assert.equal(r.decisions, 2);
  assert.equal(r.per_job_usd, Math.round((d.cost_usd / 1) * 1e4) / 1e4);
  assert.equal(r.per_hour_usd, Math.round((d.cost_usd / d.op_hours) * 1e4) / 1e4);
});

test("recovery time runs from the refused answer to the accepted re-buy", () => {
  const r = costReport({
    decisions: [{ id: 1, machine: "mule", outcome: "act", cost_usd: 0.03, op_hours: 1 }],
    purchases: [
      { decision_id: 1, at: "2026-11-20T10:00:00.000Z", verdict: "rejected" },
      { decision_id: 1, at: "2026-11-20T10:00:42.000Z", verdict: "accepted" },
      { decision_id: 1, at: "2026-11-20T10:01:00.000Z", verdict: "accepted" },
    ],
  }, [{ id: "mule" }]);
  assert.equal(r.recoveries, 1);
  assert.equal(r.mean_recovery_s, 42);
  assert.equal(r.per_hour_usd, 0.03);
});
