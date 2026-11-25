// Send a pack to the Telegraph evaluation pool, signed, and read back what the node did with it.
//
//   node --env-file=../.env upload.mjs STORM_ALERT_GENERAL --dry-run    show what would be sent
//   node --env-file=../.env upload.mjs STORM_ALERT_GENERAL              upload packs/STORM_ALERT_GENERAL.jsonl
//   node --env-file=../.env upload.mjs STORM_ALERT_GENERAL --status     only read the pool and our rows
//
// The upload is one POST of the exact file bytes. The signature (EIP-191) covers the intent, the sha256
// of those bytes, a fresh nonce and the chain id, as the docs describe. Nothing is paid; there is no bond.
import { privateKeyToAccount } from "viem/accounts";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const NODE = process.env.TELEGRAPH_NODE || "https://devnode.telegraphprotocol.com";
const CHAIN_ID = 11155111;
const [intent, ...flags] = process.argv.slice(2);
if (!intent) throw new Error("usage: upload.mjs <INTENT> [--dry-run|--status]");
const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const here = (p) => new URL(p, import.meta.url);

const status = async () => {
  const pool = await fetch(`${NODE}/api/evalpool/status?intent_id=${intent}`).then((r) => r.json());
  const mine = await fetch(`${NODE}/api/evalpool/submissions/mine?submitter=${account.address}&intent_id=${intent}`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  return { pool: { by_state: pool.by_state, submitters: pool.submitters, eligible_submitters: pool.eligible_submitters, snapshot_rows: pool.snapshot?.rows }, mine };
};

if (flags.includes("--status")) {
  console.log(JSON.stringify(await status(), null, 1).slice(0, 3000));
  process.exit(0);
}

const body = readFileSync(here(`./packs/${intent}.jsonl`));
const rows = body.toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
for (const [i, r] of rows.entries()) {
  if (r.prompt.length < 16 || r.prompt.length > 16000) throw new Error(`row ${i + 1}: prompt length ${r.prompt.length}`);
  for (const k of ["chosen", "rejected"]) if (r[k].length < 8 || r[k].length > 32000) throw new Error(`row ${i + 1}: ${k} length ${r[k].length}`);
  if (r.chosen === r.rejected) throw new Error(`row ${i + 1}: identical answers`);
}
const bodySha = createHash("sha256").update(body).digest("hex");
const nonce = randomBytes(16).toString("hex");
const message = ["Telegraph eval-pool submission v1", `intent_id: ${intent}`, `body_sha256: ${bodySha}`, `nonce: ${nonce}`, `chain_id: ${CHAIN_ID}`].join("\n");
console.log(`${intent}: ${rows.length} rows, ${body.length} bytes, sha256 ${bodySha}\nsubmitter ${account.address}`);
const before = await status();
console.log("pool before:", JSON.stringify(before.pool));
if (flags.includes("--dry-run")) process.exit(0);

const signature = await account.signMessage({ message });
const res = await fetch(`${NODE}/api/evalpool/submissions?intent_id=${intent}&submitter=${account.address}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-ndjson", "X-Evalpool-Signature": signature, "X-Evalpool-Nonce": nonce },
  body,
});
const reply = await res.json().catch(async () => ({ raw: await res.text() }));
console.log(`node replied ${res.status}:`, JSON.stringify(reply).slice(0, 1500));
const after = await status();
console.log("pool after:", JSON.stringify(after.pool));
writeFileSync(here(`./results/upload-${intent}-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ intent, uploaded_at: new Date().toISOString(), submitter: account.address, rows: rows.length, body_sha256: bodySha, http_status: res.status, node_reply: reply, pool_before: before.pool, pool_after: after.pool, readback: `${NODE}/api/evalpool/submissions/mine?submitter=${account.address}&intent_id=${intent}` }, null, 1));
