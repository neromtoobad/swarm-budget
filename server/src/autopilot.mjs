// The fleet's own schedule: one machine at a time, in turn, every tick, with no visitor involved.
// The schedule is read from the decisions already saved, not kept in memory, so a restart or redeploy
// neither resets the clock nor sends the turn back to the first machine.
export const LEDGER_GAP_MS = 20 * 3600e3; // the auditor runs at most once a day

// lastAuto: the latest decision with trigger "auto" ({ machine, at }), or null.
// lastLedgerAt: when Ledger last ran for any reason, or null.
// lastAttemptAt: when this process last started an automatic run that may not have saved a decision (it failed).
// Returns { due, machine, waitMs }.
export function nextAutoRun({ machines, tickMs, lastAuto = null, lastLedgerAt = null, lastAttemptAt = null, now = Date.now() }) {
  const ids = machines.map((m) => m.id);
  const lastAt = Math.max(lastAuto ? Date.parse(lastAuto.at) : 0, lastAttemptAt ?? 0);
  const waitMs = lastAt ? Math.max(0, lastAt + tickMs - now) : 0;
  const start = lastAuto && ids.includes(lastAuto.machine) ? (ids.indexOf(lastAuto.machine) + 1) % ids.length : 0;
  let machine = null;
  for (let i = 0; i < ids.length && !machine; i++) {
    const id = ids[(start + i) % ids.length];
    if (id === "ledger" && lastLedgerAt && now - Date.parse(lastLedgerAt) < LEDGER_GAP_MS) continue; // audited recently: next in turn
    machine = id;
  }
  return { due: waitMs === 0 && machine != null, machine, waitMs };
}
