// Per-machine budget caps: one daily pool, a share per machine, checked before every purchase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/src/store.mjs";
import { createBuyer } from "../server/src/buyer.mjs";
import { createFleet, MACHINES } from "../server/src/fleet.mjs";
import { createBudget, parseShares } from "../server/src/budget.mjs";

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
const store = () => openStore(mkdtempSync(join(tmpdir(), "swarm-budget-")));
const spend = (s, machine, usd) => s.addPurchase({ at: new Date().toISOString(), farm: "f", machine, intent: "X", params: {}, attempt: 1, routed: "telegraph", status: 200, cost_usd: usd, verdict: "accepted", checks: [] });

function rig(daily) {
  const s = store();
  const asked = [];
  const tg = { intentMiners: async () => ({ miners: [] }), askEscrow: async (body) => (asked.push(body.intent), load(REPLAY[body.intent])) };
  const budget = createBudget({ store: s, daily, machines: MACHINES });
  return { s, asked, budget, fleet: createFleet({ store: s, buy: createBuyer({ tg, store: s, budget }) }) };
}

test("default shares split the day by weight: Kite and Mule 25%, Lark 20%, Haul and Ledger 15%", () => {
  const b = createBudget({ store: store(), daily: 1, machines: MACHINES });
  assert.deepEqual(b.state().machines.map((m) => [m.machine, m.share_pct, m.cap_usd]),
    [["kite", 25, 0.25], ["mule", 25, 0.25], ["haul", 15, 0.15], ["lark", 20, 0.2], ["ledger", 15, 0.15]]);
});

test("MACHINE_SHARES overrides some weights and keeps the rest", () => {
  assert.deepEqual(parseShares("kite=50, haul=0"), { kite: 50, haul: 0 });
  const b = createBudget({ store: store(), daily: 1, machines: MACHINES, shares: parseShares("kite=50,haul=0") });
  assert.equal(b.capOf("haul"), 0);
  assert.equal(b.canSpend("haul").ok, false);
});

test("a machine that used its share is stopped while the others can still buy", () => {
  const s = store();
  const b = createBudget({ store: s, daily: 0.15, machines: MACHINES }); // Kite's share: $0.0375
  spend(s, "kite", 0.03);
  const no = b.canSpend("kite");
  assert.equal(no.ok, false);
  assert.match(no.why, /Kite's share of today's budget \(\$0\.03[78]\) is spent/);
  assert.equal(b.canSpend("mule").ok, true);
});

test("the shared pool still caps the day even when a machine has share left", () => {
  const s = store();
  const b = createBudget({ store: s, daily: 0.05, machines: MACHINES });
  spend(s, "mule", 0.045);
  assert.match(b.canSpend("haul").why, /today's intelligence budget of \$0\.050 is spent/);
});

test("yesterday's spend does not count against today's share", () => {
  const s = store();
  const b = createBudget({ store: s, daily: 0.15, machines: MACHINES });
  s.addPurchase({ at: "2000-01-01T12:00:00.000Z", farm: "f", machine: "kite", intent: "X", params: {}, attempt: 1, routed: "telegraph", status: 200, cost_usd: 1, verdict: "accepted", checks: [] });
  assert.equal(b.canSpend("kite").ok, true);
});

test("Kite stops buying mid-decision when its share runs out, and does not act on half the evidence", async () => {
  const { fleet, asked } = rig(0.06); // Kite's share: $0.015, room for one $0.01 answer
  const d = await fleet.decide("kite", FRESNO_FARM);
  assert.deepEqual(asked, ["STORM_ALERT_GENERAL"]);
  assert.notEqual(d.outcome, "act");
  assert.match(d.summary, /No purchase was made: Kite's share of today's budget/);
});

test("a capped Kite does not stop Haul", async () => {
  const { fleet, asked, s } = rig(0.1); // Kite $0.025, Haul $0.015
  spend(s, "kite", 0.025);
  const d = await fleet.decide("haul", KERMAN_FARM);
  assert.deepEqual(asked, ["ROUTE_ETA_GENERAL"]);
  assert.equal(d.outcome, "act", d.summary);
});
