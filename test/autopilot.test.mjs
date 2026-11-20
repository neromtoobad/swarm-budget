// The automatic loop's schedule comes from saved decisions, so a restart neither resets the clock nor the turn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextAutoRun } from "../server/src/autopilot.mjs";
import { openStore } from "../server/src/store.mjs";
import { MACHINES } from "../server/src/fleet.mjs";

const H = 3600e3;
const tickMs = 6 * H;
const now = Date.parse("2026-11-21T12:00:00Z");
const ago = (ms) => new Date(now - ms).toISOString();

test("with no automatic run yet, the first machine goes at once", () => {
  assert.deepEqual(nextAutoRun({ machines: MACHINES, tickMs, now }), { due: true, machine: "kite", waitMs: 0 });
});

test("after a restart the turn continues from the last automatic run, and the clock is not reset", () => {
  const early = nextAutoRun({ machines: MACHINES, tickMs, now, lastAuto: { machine: "mule", at: ago(2 * H) } });
  assert.equal(early.due, false);
  assert.equal(early.machine, "haul");
  assert.equal(early.waitMs, 4 * H);
  const due = nextAutoRun({ machines: MACHINES, tickMs, now, lastAuto: { machine: "mule", at: ago(6 * H) } });
  assert.deepEqual(due, { due: true, machine: "haul", waitMs: 0 });
});

test("Ledger's turn is passed to the next machine when it audited in the last 20 hours", () => {
  const last = { machine: "lark", at: ago(7 * H) };
  assert.equal(nextAutoRun({ machines: MACHINES, tickMs, now, lastAuto: last, lastLedgerAt: ago(5 * H) }).machine, "kite");
  assert.equal(nextAutoRun({ machines: MACHINES, tickMs, now, lastAuto: last, lastLedgerAt: ago(21 * H) }).machine, "ledger");
});

test("a run that failed without saving a decision is not retried before the next tick", () => {
  const plan = nextAutoRun({ machines: MACHINES, tickMs, now, lastAuto: { machine: "kite", at: ago(9 * H) }, lastAttemptAt: now - 60e3 });
  assert.equal(plan.due, false);
  assert.equal(plan.machine, "mule");
});

test("the store finds the last automatic decision and ignores visitor runs", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "swarm-auto-")));
  const add = (machine, trigger, at) => store.addDecision({ at, farm: "kerman-ca", machine, kind: "x", outcome: "act", summary: "s", cost_usd: 0, op_hours: 0, trigger });
  add("kite", "auto", ago(8 * H));
  add("mule", "visitor", ago(1 * H));
  assert.equal(store.lastAutoDecision("kerman-ca").machine, "kite");
  assert.equal(nextAutoRun({ machines: MACHINES, tickMs, now, lastAuto: store.lastAutoDecision("kerman-ca") }).machine, "mule");
});
