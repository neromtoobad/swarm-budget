// Telegraph client for the fleet: the checked-ask escrow client plus paid asks over x402 "exact".
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createEscrowClient } from "../../packages/checked-ask/escrow.mjs";

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
  // Discovery and escrow payments come from the checked-ask package; this file adds the x402 "exact" rail.
  const escrow = createEscrowClient({ node, privateKey, maxPerPaymentUusdc });
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
    ...escrow, // intents, intentMiners, signal, ledger, challenge, askEscrow

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
