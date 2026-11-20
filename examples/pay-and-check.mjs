// Tutorial example (docs/TUTORIAL.md): buy one answer on Telegraph from escrow, check it, and buy again if it's wrong.
// One file, one dependency (viem). Run: node --env-file=.env examples/pay-and-check.mjs
// Needs EVM_PRIVATE_KEY for a testnet wallet with test USDC deposited in escrow (npm run fund -- --deposit 2).
import { privateKeyToAccount } from "viem/accounts";

const NODE = process.env.TELEGRAPH_NODE || "https://devnode.telegraphprotocol.com";
const MAX_PRICE_UUSDC = 50_000n; // never sign for more than $0.05 per answer
const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);

// What we want to know, and what a right answer must say about the place.
// By default we ask by name. --by-coordinates asks for the same farm as "lat,lon", which no miner can read as Iran.
const FARM = { name: "Kerman, California", lat: 36.7236, lon: -120.0599 };
const byCoords = process.argv.includes("--by-coordinates");
const request = { intent: "STORM_ALERT_GENERAL", params: { location: byCoords ? `${FARM.lat},${FARM.lon}` : FARM.name, window_hours: 6 } };
const mustMention = ["california", "united states", "usa"]; // "Kerman, Iran" is a real town too
const suits = /storm|weather|nws|signals/i; // "compatible" miners for this intent include space-weather feeds; try these first

// Step 1-3: ask, read the 402 challenge, sign the escrow authorization, ask again with X-PAYMENT.
async function buy(body, minerId) {
  const url = `${NODE}/engine/v1/ask${minerId ? `/${minerId}` : ""}`;
  const post = (headers = {}) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });

  const first = await post();
  if (first.status !== 402) throw new Error(`expected a 402 challenge, got ${first.status}: ${await first.text()}`);
  const challenge = await first.json();
  const escrow = challenge.accepts.find((a) => a.scheme === "escrow");
  const template = escrow.extra.message; // the exact text to sign, with {from} {nonce} {validAfter} {validBefore} to fill in
  const value = template.match(/Amount:\s*(\d+)\s*uUSDC/)[1];
  if (BigInt(value) > MAX_PRICE_UUSDC) throw new Error(`price ${value} uUSDC is over our cap`);

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address.toLowerCase(), // the node lowercases the address before checking the signature
    to: escrow.payTo,
    value,
    validAfter: String(now - 5),
    validBefore: String(now + 100), // keep the window under 2 minutes
    nonce: crypto.randomUUID(),
  };
  const message = template
    .replace("{from}", authorization.from)
    .replace("{nonce}", authorization.nonce)
    .replace("{validAfter}", authorization.validAfter)
    .replace("{validBefore}", authorization.validBefore);
  const signature = await account.signMessage({ message }); // EIP-191 personal_sign: no gas, no chain transaction
  const payment = Buffer.from(JSON.stringify({ x402Version: 2, scheme: "escrow", network: escrow.network, payload: { signature, authorization } })).toString("base64");

  const paid = await post({ "X-PAYMENT": payment });
  const answer = await paid.json();
  const receiptHeader = paid.headers.get("x-payment-response");
  const receipt = receiptHeader ? JSON.parse(Buffer.from(receiptHeader, "base64").toString("utf8")) : null;
  if (!paid.ok) throw new Error(`paid ask failed ${paid.status}: ${JSON.stringify(answer).slice(0, 300)}`);
  return { answer, receipt, price: Number(value) / 1e6 };
}

// Step 4: check the answer against the question before anything acts on it.
function check(answer) {
  const place = String(answer.result?.location ?? "");
  if (!place) return { ok: false, why: "the answer does not say which place it is about" };
  const at = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(place); // an echo in coordinates: measure the distance
  if (at) {
    const rad = (d) => (d * Math.PI) / 180;
    const [lat, lon] = [Number(at[1]), Number(at[2])];
    const h = Math.sin(rad(lat - FARM.lat) / 2) ** 2 + Math.cos(rad(FARM.lat)) * Math.cos(rad(lat)) * Math.sin(rad(lon - FARM.lon) / 2) ** 2;
    const km = Math.round(12742 * Math.asin(Math.sqrt(h)));
    return km <= 50 ? { ok: true, why: `answer is about ${place}, ${km} km from the farm` } : { ok: false, why: `answer is about a place ${km} km from the farm` };
  }
  const lower = place.toLowerCase();
  if (!lower.includes("kerman")) return { ok: false, why: `answer is about "${place}", not Kerman` };
  if (place.includes(",") && !mustMention.some((w) => lower.includes(w))) return { ok: false, why: `answer is about "${place}": same town name, different place` };
  return { ok: true, why: `answer is about "${place}"` };
}

// Step 5: if it fails, buy again from the next compatible miner, named explicitly.
const miners = (await fetch(`${NODE}/engine/v1/intents/${request.intent}/miners`).then((r) => r.json())).miners
  .filter((m) => m.compatible)
  .sort((a, b) => suits.test(b.name) - suits.test(a.name)); // stable sort: the node's order within each group
const MAX_ATTEMPTS = 3;
const nextMiner = (attempt) => {
  if (attempt >= MAX_ATTEMPTS) { console.log("  out of attempts: act on nothing"); return null; }
  const next = miners.find((m) => !tried.has(String(m.id)));
  if (!next) { console.log("  no other compatible miner left: act on nothing"); return null; }
  console.log(`  buying again from ${next.name} (miner ${next.id})`);
  return next.id;
};
const tried = new Set();
// first try: let Telegraph route to its top-ranked miner, or name one with --miner <id> (9002 answered for Iran on Nov 19)
let minerId = process.argv.includes("--miner") ? process.argv[process.argv.indexOf("--miner") + 1] : null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  let bought;
  try {
    bought = await buy(request, minerId);
  } catch (e) {
    // a miner that errors or never answers is skipped like a wrong answer: nothing to act on, try the next one
    console.log(`\nattempt ${attempt}: miner ${minerId ?? "(routed)"} gave no answer: ${e.cause?.code ?? e.message}`);
    if (minerId) tried.add(String(minerId));
  }
  if (!bought) {
    minerId = nextMiner(attempt);
    if (!minerId) break;
    continue;
  }
  const { answer, receipt, price } = bought;
  tried.add(String(answer.miner_id));
  const verdict = check(answer);
  console.log(`\nattempt ${attempt}: ${answer.miner_name} (miner ${answer.miner_id}), paid $${price}`);
  console.log("  answer :", JSON.stringify(answer.result).slice(0, 220));
  console.log("  check  :", verdict.ok ? "ACCEPTED," : "REFUSED,", verdict.why);
  console.log("  receipt:", receipt?.receipt_hash, `epoch ${receipt?.epoch_id}`);
  console.log("  proof  :", `${NODE}/engine/v1/signal/${answer.signal_hash}`);
  if (verdict.ok) break;
  minerId = nextMiner(attempt);
  if (!minerId) break;
}

// Step 6: the escrow ledger shows what this wallet has spent.
const ledger = await fetch(`${NODE}/v1/ledger/account/${account.address.toLowerCase()}`).then((r) => r.json());
console.log(`\nescrow: deposited ${Number(ledger.deposited) / 1e6} USDC, charged ${Number(ledger.charged) / 1e6}, unbilled ${Number(ledger.unbilled) / 1e6}, available ${Number(ledger.available) / 1e6}`);
