// Ledger of every purchase and decision, in SQLite (node:sqlite, built into Node 22+).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function openStore(dir = process.env.DATA_DIR || "./data") {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "fleet.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL, farm TEXT NOT NULL, machine TEXT NOT NULL, kind TEXT NOT NULL,
      outcome TEXT NOT NULL, summary TEXT NOT NULL, cost_usd REAL NOT NULL DEFAULT 0, trigger TEXT
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER, at TEXT NOT NULL, farm TEXT NOT NULL, machine TEXT NOT NULL,
      intent TEXT NOT NULL, params TEXT NOT NULL, attempt INTEGER NOT NULL, routed TEXT NOT NULL,
      miner_id TEXT, miner_name TEXT, status INTEGER, cost_usd REAL, ms INTEGER,
      signal_hash TEXT, receipt_hash TEXT, epoch_id INTEGER, rail TEXT,
      verdict TEXT NOT NULL, checks TEXT NOT NULL, result TEXT
    );
    CREATE INDEX IF NOT EXISTS purchases_decision ON purchases(decision_id);
    CREATE INDEX IF NOT EXISTS purchases_miner ON purchases(intent, miner_id);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  // op_hours: simulated hours of machine work a completed decision released. Added Nov 20; older rows are
  // back-filled from the same per-machine table the fleet uses, and from the drive time Haul recorded.
  if (!db.prepare("PRAGMA table_info(decisions)").all().some((c) => c.name === "op_hours")) {
    db.exec("ALTER TABLE decisions ADD COLUMN op_hours REAL NOT NULL DEFAULT 0");
    const set = db.prepare("UPDATE decisions SET op_hours = ? WHERE id = ?");
    for (const d of db.prepare("SELECT id, machine, summary FROM decisions WHERE outcome = 'act'").all()) {
      const drive = d.machine === "haul" && /(\d+) min drive/.exec(d.summary);
      const h = drive ? Math.round(((2 * Number(drive[1]) + 20) / 60) * 100) / 100 : ({ kite: 1.5, mule: 1, lark: 3 }[d.machine] ?? 0);
      set.run(h, d.id);
    }
  }

  const insDecision = db.prepare(
    "INSERT INTO decisions (at, farm, machine, kind, outcome, summary, cost_usd, op_hours, trigger) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const insPurchase = db.prepare(`INSERT INTO purchases
    (decision_id, at, farm, machine, intent, params, attempt, routed, miner_id, miner_name, status, cost_usd, ms,
     signal_hash, receipt_hash, epoch_id, rail, verdict, checks, result)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  return {
    db,
    addDecision(d) {
      const r = insDecision.run(d.at, d.farm, d.machine, d.kind, d.outcome, d.summary, d.cost_usd ?? 0, d.op_hours ?? 0, d.trigger ?? null);
      return Number(r.lastInsertRowid);
    },
    addPurchase(p) {
      const r = insPurchase.run(
        p.decision_id ?? null, p.at, p.farm, p.machine, p.intent, JSON.stringify(p.params), p.attempt, p.routed,
        p.miner_id ?? null, p.miner_name ?? null, p.status ?? null, p.cost_usd ?? 0, p.ms ?? null,
        p.signal_hash ?? null, p.receipt_hash ?? null, p.epoch_id ?? null, p.rail ?? null,
        p.verdict, JSON.stringify(p.checks), p.result == null ? null : JSON.stringify(p.result),
      );
      return Number(r.lastInsertRowid);
    },
    linkPurchases(decisionId, ids) {
      const st = db.prepare("UPDATE purchases SET decision_id = ? WHERE id = ?");
      for (const id of ids) st.run(decisionId, id);
    },
    spentSince(iso, machine) {
      return machine
        ? db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM purchases WHERE at >= ? AND machine = ?").get(iso, machine).s
        : db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM purchases WHERE at >= ?").get(iso).s;
    },
    // Our own track record per miner: how often its answers passed the guard.
    minerRecord(intent) {
      return db.prepare(`SELECT miner_id, miner_name,
          SUM(verdict='accepted') AS accepted, SUM(verdict!='accepted') AS rejected
        FROM purchases WHERE intent = ? AND miner_id IS NOT NULL GROUP BY miner_id`).all(intent);
    },
    recent(limit = 40, farm) {
      const ds = farm
        ? db.prepare("SELECT * FROM decisions WHERE farm = ? ORDER BY id DESC LIMIT ?").all(farm, limit)
        : db.prepare("SELECT * FROM decisions ORDER BY id DESC LIMIT ?").all(limit);
      const ps = db.prepare("SELECT * FROM purchases WHERE decision_id = ? ORDER BY id");
      return ds.map((d) => ({
        ...d,
        purchases: ps.all(d.id).map((p) => ({ ...p, params: JSON.parse(p.params), checks: JSON.parse(p.checks), result: p.result ? JSON.parse(p.result) : null })),
      }));
    },
    lastDecision(farm, machine) {
      return db.prepare("SELECT * FROM decisions WHERE farm = ? AND machine = ? ORDER BY id DESC LIMIT 1").get(farm, machine);
    },
    totals() {
      const p = db.prepare(`SELECT COUNT(*) AS purchases, SUM(status=200) AS answered, COALESCE(SUM(cost_usd),0) AS spent,
          SUM(verdict='accepted') AS accepted, SUM(verdict='rejected') AS rejected, SUM(verdict='failed') AS failed,
          SUM(attempt>1) AS rebuys FROM purchases`).get();
      const d = db.prepare(`SELECT COUNT(*) AS decisions, SUM(outcome='act') AS acted, SUM(outcome='hold') AS held,
          SUM(outcome='unverified') AS unverified FROM decisions`).get();
      return { ...p, ...d };
    },
    // The latest answers the guard refused, with the failing checks.
    refusals(limit = 8) {
      return db.prepare(`SELECT id, at, farm, machine, intent, miner_id, miner_name, attempt, checks, signal_hash
        FROM purchases WHERE verdict = 'rejected' ORDER BY id DESC LIMIT ?`).all(limit)
        .map((r) => ({ ...r, checks: JSON.parse(r.checks) }));
    },
    // Every miner we have bought from, per intent, with how its answers fared.
    minerBoard() {
      return db.prepare(`SELECT intent, miner_id, miner_name,
          SUM(verdict='accepted') AS accepted, SUM(verdict='rejected') AS rejected, SUM(verdict='failed') AS failed
        FROM purchases WHERE miner_id IS NOT NULL GROUP BY intent, miner_id ORDER BY intent, accepted DESC, rejected DESC`).all();
    },
    // Raw rows for the cost report (server/src/costs.mjs).
    costRows() {
      return {
        decisions: db.prepare("SELECT id, machine, outcome, cost_usd, op_hours FROM decisions").all(),
        purchases: db.prepare("SELECT decision_id, at, verdict FROM purchases WHERE decision_id IS NOT NULL ORDER BY id").all(),
      };
    },
    // The latest run of each failure test, so the page can show what happened last time.
    failureRuns() {
      return db.prepare(`SELECT d.* FROM decisions d JOIN (SELECT trigger, machine, MAX(id) AS id FROM decisions
        WHERE trigger IN ('break-a-miner','revoke-pay','unplug-sensor') GROUP BY trigger, machine) l ON l.id = d.id ORDER BY d.id DESC`).all();
    },
    // Accepted answers of one kind, oldest first, for the forecast check (server/src/forecast-check.mjs).
    acceptedAnswers(intent, farm) {
      const rows = farm
        ? db.prepare("SELECT farm, at, params, result, signal_hash FROM purchases WHERE intent = ? AND verdict = 'accepted' AND farm = ? ORDER BY id").all(intent, farm)
        : db.prepare("SELECT farm, at, params, result, signal_hash FROM purchases WHERE intent = ? AND verdict = 'accepted' ORDER BY id").all(intent);
      return rows.map((r) => ({ ...r, params: JSON.parse(r.params), result: r.result ? JSON.parse(r.result) : null }));
    },
    getSetting(key) {
      const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      return r ? JSON.parse(r.value) : null;
    },
    setSetting(key, value) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
    },
    junkByIntent() {
      // answers that came back (and were paid for), and how many of those the guard refused
      return db.prepare(`SELECT intent, SUM(status=200) AS bought, SUM(verdict='rejected') AS junk
        FROM purchases GROUP BY intent HAVING bought > 0 ORDER BY junk DESC, intent`).all();
    },
  };
}
