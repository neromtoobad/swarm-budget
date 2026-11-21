// Telegraph escrow client: free discovery, the 402 challenge, and paid asks signed from an escrow balance.
// One dependency (viem). No facilitator and no per-call chain transaction: the node checks an EIP-191
// signature against the escrow deposit and bills at epoch close.
import { privateKeyToAccount } from "viem/accounts";

const b64json = (s) => (s ? JSON.parse(Buffer.from(s, "base64").toString("utf8")) : null);
const parse = (text) => {
  try { return JSON.parse(text); } catch { return text; }
};

export const DEFAULT_NODE = "https://devnode.telegraphprotocol.com";

export function createEscrowClient({
  node = process.env.TELEGRAPH_NODE || DEFAULT_NODE,
  privateKey = process.env.EVM_PRIVATE_KEY,
  maxPerPaymentUusdc = "50000", // never sign for more than $0.05 per answer
  challengeTimeoutMs = 30_000, // a miner that never answers must not hang the caller
  answerTimeoutMs = Number(process.env.ASK_TIMEOUT_MS || 90_000),
} = {}) {
  const account = privateKey ? privateKeyToAccount(privateKey) : null;
  const askPath = (minerId) => (minerId ? `/engine/v1/ask/${minerId}` : "/engine/v1/ask");
  const get = async (path) => {
    const r = await fetch(node + path);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  };

  return {
    node,
    address: account?.address ?? null,

    // ---- free discovery ----
    intents: () => get("/engine/v1/intents"),
    intent: (id) => get(`/engine/v1/intents/${id}`),
    intentMiners: (id) => get(`/engine/v1/intents/${id}/miners`),
    miners: (intent) => get(`/api/miners${intent ? `?intent=${encodeURIComponent(intent)}` : ""}`),
    signal: (hash) => get(`/engine/v1/signal/${hash}`),
    ledger: () => {
      if (!account) throw new Error("no private key: set EVM_PRIVATE_KEY");
      return get(`/v1/ledger/account/${account.address.toLowerCase()}`);
    },

    // Unpaid call: the decoded 402 challenge (price, payTo, asset), spending nothing.
    async challenge(body, { minerId } = {}) {
      const r = await fetch(node + askPath(minerId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(challengeTimeoutMs),
      });
      return { status: r.status, challenge: b64json(r.headers.get("payment-required")), body: parse(await r.text()) };
    },

    // Paid call. body = {intent, params}. Returns {ok, status, ms, body, receipt, rail}.
    async askEscrow(body, { minerId } = {}) {
      if (!account) throw new Error("no private key: set EVM_PRIVATE_KEY");
      const url = node + askPath(minerId);
      const headers = { "Content-Type": "application/json" };
      const started = Date.now();
      const first = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(challengeTimeoutMs) });
      if (first.status !== 402) {
        // e.g. 503 no_compatible_miner: the node refuses before charging, so nothing is spent
        return { ok: first.ok, status: first.status, ms: Date.now() - started, body: await first.json().catch(() => null), receipt: null };
      }
      const challenge = await first.json();
      const escrow = challenge.accepts?.find((a) => a.scheme === "escrow");
      if (!escrow) throw new Error("node does not offer escrow");
      const template = escrow.extra.message; // the exact text to sign, with {from} {nonce} {validAfter} {validBefore}
      const value = template.match(/Amount:\s*(\d+)\s*uUSDC/)[1];
      if (BigInt(value) > BigInt(maxPerPaymentUusdc)) throw new Error(`price ${value} uUSDC over cap ${maxPerPaymentUusdc}`);
      const now = Math.floor(Date.now() / 1000);
      const authorization = {
        from: account.address.toLowerCase(), // the node lowercases before checking the signature
        to: escrow.payTo,
        value,
        validAfter: String(now - 5),
        validBefore: String(now + 100), // window must stay under 2 minutes
        nonce: crypto.randomUUID(),
      };
      const message = template
        .replace("{from}", authorization.from)
        .replace("{nonce}", authorization.nonce)
        .replace("{validAfter}", authorization.validAfter)
        .replace("{validBefore}", authorization.validBefore);
      const signature = await account.signMessage({ message });
      const payment = Buffer.from(
        JSON.stringify({ x402Version: 2, scheme: "escrow", network: escrow.network, payload: { signature, authorization } }),
      ).toString("base64");
      const r = await fetch(url, {
        method: "POST",
        headers: { ...headers, "X-PAYMENT": payment },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(answerTimeoutMs),
      });
      return {
        ok: r.ok,
        status: r.status,
        ms: Date.now() - started,
        body: parse(await r.text()),
        receipt: b64json(r.headers.get("x-payment-response")),
        rail: "escrow",
      };
    },
  };
}
