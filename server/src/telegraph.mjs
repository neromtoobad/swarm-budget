// Telegraph client: discovery (free), 402 challenge decode, and paid asks over x402.
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

export const SEPOLIA = "eip155:11155111";
export const TEST_USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
export const BASE_SEPOLIA = "eip155:84532";
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Circle test USDC

const b64json = (s) => (s ? JSON.parse(Buffer.from(s, "base64").toString("utf8")) : null);

export function createTelegraph({
  node = process.env.TELEGRAPH_NODE || "https://devnode.telegraphprotocol.com",
  privateKey = process.env.EVM_PRIVATE_KEY,
  maxPerPaymentUusdc = "50000", // hard cap per single payment: $0.05
} = {}) {
  const get = async (path) => {
    const r = await fetch(node + path);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  };

  let paidFetch = null;
  const account = privateKey ? privateKeyToAccount(privateKey) : null;
  if (account) {
    // The node offers Ethereum Sepolia, Base Sepolia and Solana devnet; we pay on whichever EVM one we hold.
    // Payments are EIP-3009 signatures settled by the facilitator, so the wallet needs USDC but no gas.
    const network = process.env.PAY_NETWORK || BASE_SEPOLIA;
    const asset = network === BASE_SEPOLIA ? BASE_SEPOLIA_USDC : TEST_USDC;
    paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network, client: new ExactEvmScheme(account) }],
      spendControls: { allowedAssets: [{ network, asset, maxAmountPerPayment: maxPerPaymentUusdc }] },
    });
  }

  const askPath = (minerId) => (minerId ? `/engine/v1/ask/${minerId}` : "/engine/v1/ask");

  return {
    node,
    address: account?.address ?? null,

    // ---- free discovery ----
    intents: () => get("/engine/v1/intents"),
    intent: (id) => get(`/engine/v1/intents/${id}`),
    intentMiners: (id) => get(`/engine/v1/intents/${id}/miners`),
    miners: (intent) => get(`/api/miners${intent ? `?intent=${encodeURIComponent(intent)}` : ""}`),
    signal: (hash) => get(`/engine/v1/signal/${hash}`),

    // Unpaid call: returns the decoded 402 challenge (price, payTo, asset) without spending anything.
    async challenge(body, { minerId } = {}) {
      const r = await fetch(node + askPath(minerId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: r.status, challenge: b64json(r.headers.get("payment-required")), body: json ?? text };
    },

    // Paid call from the escrow balance (deposit once with depositUSDC on the Diamond).
    // No facilitator and no per-call chain tx: the node checks an EIP-191 signature and bills at epoch close.
    async askEscrow(body, { minerId } = {}) {
      if (!account) throw new Error("EVM_PRIVATE_KEY not set");
      const url = node + askPath(minerId);
      const headers = { "Content-Type": "application/json" };
      const started = Date.now();
      const first = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (first.status !== 402) {
        return { ok: first.ok, status: first.status, ms: Date.now() - started, body: await first.json().catch(() => null), receipt: null };
      }
      const challenge = await first.json();
      const escrow = challenge.accepts?.find((a) => a.scheme === "escrow");
      if (!escrow) throw new Error("node does not offer escrow");
      const template = escrow.extra.message;
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
      const r = await fetch(url, { method: "POST", headers: { ...headers, "X-PAYMENT": payment }, body: JSON.stringify(body) });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return {
        ok: r.ok,
        status: r.status,
        ms: Date.now() - started,
        body: json ?? text,
        receipt: b64json(r.headers.get("x-payment-response")),
        rail: "escrow",
      };
    },

    ledger: () => get(`/v1/ledger/account/${account.address.toLowerCase()}`),

    // Paid call over x402 exact. body = {intent, params} | {query} | {method, endpoint, payload} (direct).
    async ask(body, { minerId } = {}) {
      if (!paidFetch) throw new Error("EVM_PRIVATE_KEY not set");
      const started = Date.now();
      const r = await paidFetch(node + askPath(minerId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return {
        ok: r.ok,
        status: r.status,
        ms: Date.now() - started,
        body: json ?? text,
        receipt: b64json(r.headers.get("x-telegraph-receipt")),
        paymentResponse: r.headers.get("payment-response"),
      };
    },
  };
}
