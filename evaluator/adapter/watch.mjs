// Follow a scorer registration until the node decides it, keeping a record of every change.
//
//   node adapter/watch.mjs <registrationId> [minutes]
//
// Appends one line per change to adapter/results/registration-<id>.jsonl and prints it. Stops when the
// registration leaves `pending`, or after the given number of minutes (default 240).
import { appendFileSync, mkdirSync } from "node:fs";

const NODE = process.env.TELEGRAPH_NODE || "https://devnode.telegraphprotocol.com";
const id = process.argv[2];
const minutes = Number(process.argv[3] ?? 240);
if (!id) throw new Error("usage: watch.mjs <registrationId> [minutes]");
const here = (p) => new URL(p, import.meta.url);
mkdirSync(here("./results/"), { recursive: true });
const file = here(`./results/registration-${id}.jsonl`);
const get = (u) => fetch(u, { signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch((e) => ({ error: String(e.message ?? e) }));

let last = "";
const until = Date.now() + minutes * 60e3;
while (Date.now() < until) {
  const reg = await get(`${NODE}/api/wasm/${id}`);
  const r = reg.wasm ?? reg.entry ?? reg;
  const pool = await get(`${NODE}/api/evalpool/status?intent_id=WEATHER_FORECAST_GENERAL`);
  const epoch = await get(`${NODE}/api/epoch`);
  const view = {
    status: r.activation_status ?? r.error ?? null,
    stage: r.stage ?? null,
    eval_score: r.eval_score ?? null,
    rejection_reason: r.rejection_reason ?? null,
    eval: r.eval ?? null,
    pool: { submitters: pool.submitters, eligible_submitters: pool.eligible_submitters, by_state: pool.by_state, snapshot_published_at: pool.snapshot?.published_at },
    epoch: epoch.current_epoch,
  };
  const key = JSON.stringify(view);
  if (key !== last) {
    last = key;
    const line = { at: new Date().toISOString(), ...view };
    appendFileSync(file, JSON.stringify(line) + "\n");
    console.log(JSON.stringify(line));
  }
  if (view.status && !["pending", "miner registration not found", "not found"].includes(view.status) && !String(view.status).includes("not found")) break;
  await new Promise((res) => setTimeout(res, 60000));
}
