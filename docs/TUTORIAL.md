# Pay for an answer on Telegraph from Node, check it, and buy again when it's wrong

A machine that buys data needs three things: a way to pay per answer, a way to tell a right answer from a confident wrong one, and somewhere else to buy when the answer is wrong. Telegraph gives you the first and the third, and it leaves a public record of every purchase. This tutorial builds all three in one Node file of about 120 lines, with one dependency (`viem`), against the Telegraph testnet node.

The file is [`examples/pay-and-check.mjs`](../examples/pay-and-check.mjs). It comes from [Swarm Budget](https://github.com/neromtoobad/swarm-budget), a fleet of simulated farm machines that pay for their own data. Every output below is from real runs on Nov 20, 2026, with links to the node's own records.

**The problem it solves.** We asked for a storm alert for "Kerman, California", a farm town in the Central Valley. Two different weather miners answered for **Kerman, Iran**. Both answers were well formed, confident and paid for. A spray drone acting on either one would have used wind readings from the wrong continent.

## How Telegraph fits in

| Piece | What it is | Used here |
|---|---|---|
| Intent | A typed question, such as `STORM_ALERT_GENERAL` with `{location, window_hours}` | The thing we buy |
| Miner | A provider that answers intents for a price | Who we buy from |
| `POST /engine/v1/ask` | Telegraph routes the question to its top-ranked miner | First try |
| `POST /engine/v1/ask/{minerId}` | Ask one named miner | Re-buys |
| `GET /engine/v1/intents/{intent}/miners` | The miners that serve an intent (free) | Where to re-buy |
| HTTP 402 + `X-PAYMENT` | The ask returns a payment challenge. You sign it and ask again | Paying |
| Escrow rail | Deposit test USDC once. Each answer is a signed message, not a chain transaction, and it's billed at the next ledger block | No gas per answer |
| `GET /engine/v1/signal/{hash}` | The node's public record of an answer, naming the buyer | Proof |
| `GET /v1/ledger/account/{address}` | Your escrow balance and spend | Accounting |

## Setup (5 minutes)

You need Node 24, git, and a fresh **testnet-only** wallet with about 0.01 Sepolia ETH for gas, from any Sepolia faucet.

```bash
git clone https://github.com/neromtoobad/swarm-budget && cd swarm-budget
npm install
cp .env.example .env                 # set EVM_PRIVATE_KEY (and EVM_ADDRESS) to the testnet wallet
npm run fund -- --deposit 2          # mints 10 test USDC, approves the escrow contract, deposits 2 USDC
```

`npm run fund` ([`scripts/fund.mjs`](../scripts/fund.mjs)) simulates each transaction before sending it, and prints your escrow balance as the node sees it. Add `--dry-run` to only simulate. 2 USDC buys about 200 answers at $0.01 each.

## Step 1: ask, and get a price instead of an answer

An ask without payment is free. It returns `402 Payment Required` with the ways you can pay:

```bash
curl -s -X POST https://devnode.telegraphprotocol.com/engine/v1/ask \
  -H 'content-type: application/json' \
  -d '{"intent":"STORM_ALERT_GENERAL","params":{"location":"36.7236,-120.0599","window_hours":6}}'
```

The `accepts` list offers `exact` on Base Sepolia and Solana devnet, and `escrow` on Ethereum Sepolia. The escrow option carries the exact text to sign:

```json
{
  "scheme": "escrow",
  "network": "eip155:11155111",
  "payTo": "0x72a70e949362670bf8bcead24efc5b8f950aa08b",
  "price": "$0.01",
  "extra": {
    "signWith": "personal_sign (EIP-191)",
    "message": "Telegraph Escrow Payment\n\nWallet: {from}\nPay To: 0x72a7…a08b\nNetwork: eip155:11155111\nAmount: 10000 uUSDC\nResource: /v1/ask\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}"
  }
}
```

## Step 2: sign the escrow authorization

Fill in the four blanks and sign the message with EIP-191 (`personal_sign`). No gas is needed, and nothing goes on chain.

```js
const escrow = challenge.accepts.find((a) => a.scheme === "escrow");
const template = escrow.extra.message;
const value = template.match(/Amount:\s*(\d+)\s*uUSDC/)[1];
if (BigInt(value) > MAX_PRICE_UUSDC) throw new Error(`price ${value} uUSDC is over our cap`);

const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: account.address.toLowerCase(), // the node lowercases the address before checking the signature
  to: escrow.payTo,
  value,
  validAfter: String(now - 5),
  validBefore: String(now + 100),       // keep the window under 2 minutes
  nonce: crypto.randomUUID(),
};
const message = template
  .replace("{from}", authorization.from).replace("{nonce}", authorization.nonce)
  .replace("{validAfter}", authorization.validAfter).replace("{validBefore}", authorization.validBefore);
const signature = await account.signMessage({ message });
```

Three details that cost us time:
- `from` must be lowercase, or the signature won't match.
- The validity window must stay under 2 minutes.
- Read the price from the message and cap it yourself. Never sign whatever amount comes back.

## Step 3: ask again with `X-PAYMENT`, and keep the receipt

The payment header is base64 JSON:

```js
const payment = Buffer.from(JSON.stringify({
  x402Version: 2, scheme: "escrow", network: escrow.network, payload: { signature, authorization },
})).toString("base64");
const paid = await fetch(`${NODE}/engine/v1/ask`, { method: "POST", headers: { "Content-Type": "application/json", "X-PAYMENT": payment }, body });
const answer = await paid.json();                                    // miner_id, miner_name, result, signal_hash, …
const receipt = JSON.parse(Buffer.from(paid.headers.get("x-payment-response"), "base64").toString());  // receipt_hash, epoch_id
```

`answer.signal_hash` is your proof: open `https://devnode.telegraphprotocol.com/engine/v1/signal/<signal_hash>` and the node's record shows your wallet as the buyer, the intent, and the answer.

## Step 4: check the answer before anything acts on it

A paid answer isn't a right answer. Compare what came back with what you asked:

```js
function check(answer) {
  const place = String(answer.result?.location ?? "");
  if (!place) return { ok: false, why: "the answer does not say which place it is about" };
  // (coordinate echoes are measured by distance; see the file)
  const lower = place.toLowerCase();
  if (!lower.includes("kerman")) return { ok: false, why: `answer is about "${place}", not Kerman` };
  if (place.includes(",") && !mustMention.some((w) => lower.includes(w)))
    return { ok: false, why: `answer is about "${place}": same town name, different place` };
  return { ok: true, why: `answer is about "${place}"` };
}
```

This is the smallest useful check. Swarm Budget's guard ([`packages/checked-ask/guard.mjs`](../packages/checked-ask/guard.mjs)) also checks the market and node for power prices, the currency, the hour, plausible ranges, and whether a satellite answer contains a reading at all.

## Step 5: buy again from another miner

When the check fails, list the intent's miners and ask the next one by id. **Compatible doesn't mean suitable.** The node lists NOAA space-weather feeds as compatible with `STORM_ALERT_GENERAL`. Their answers name no place, and the check refuses them. So rank the candidates first:

```js
const suits = /storm|weather|nws|signals/i;
const miners = (await fetch(`${NODE}/engine/v1/intents/${request.intent}/miners`).then((r) => r.json())).miners
  .filter((m) => m.compatible)
  .sort((a, b) => suits.test(b.name) - suits.test(a.name));
// …after a refusal: buy(request, miners.find((m) => !tried.has(String(m.id))).id)
```

Treat a miner that errors or times out the same way as a wrong answer: skip it and move on. Swarm Budget ranks re-buys by each miner's own pass rate, and drops a miner that has been refused twice without one accepted answer ([`packages/checked-ask/checked-ask.mjs`](../packages/checked-ask/checked-ask.mjs)).

Run it by name, sending the first purchase to miner 9002:

```bash
node --env-file=.env examples/pay-and-check.mjs --miner 9002
```

```text
attempt 1: TxLens (miner 9002), paid $0.01
  answer : {"location":"Kerman, Kerman, Iran","risk_score":0.16,"risk_level":"LOW","peak_gust_kmh":15.2,"precipitation_mm":0,…}
  check  : REFUSED, answer is about "Kerman, Kerman, Iran": same town name, different place
  buying again from Amanat Weather Risk (miner 20260821)

attempt 2: Amanat Weather Risk (miner 20260821), paid $0.01
  answer : {"location":"Kerman, Kerman, Iran","risk_score":0.2,"risk_level":"LOW","peak_gust_kmh":18,…}
  check  : REFUSED, answer is about "Kerman, Kerman, Iran": same town name, different place
  buying again from NWS Alerts by Area (miner 37002)

attempt 3: miner 37002 gave no answer: … 503: {"error":"no_compatible_miner", …}
  out of attempts: act on nothing
```

Two miners made the same mistake. Both refusals are public records: [TxLens](https://devnode.telegraphprotocol.com/engine/v1/signal/0x9371d56dbc428edc3f81edad05ca41dbca664f57d4547ac3a70a1956b87ca2ab), [Amanat](https://devnode.telegraphprotocol.com/engine/v1/signal/0x34e5e47554dee6dedda9237e0d2c6c3b210250dd45634d3731592083aad03093). The script spent 2 cents and acted on nothing, which is the right outcome. A 503 comes back before the 402, so it is never charged.

## Step 6: ask in a form that can't be misread

The lasting fix is in the question. Send the farm's coordinates instead of its name:

```bash
node --env-file=.env examples/pay-and-check.mjs --miner 9002 --by-coordinates
```

```text
attempt 1: miner 9002 gave no answer: … 503: {"error":"no_compatible_miner", …}
  buying again from NWS Alerts by Point (miner 37001)

attempt 2: NWS Alerts by Point (miner 37001), paid $0.01
  answer : {"location":null,"risk_score":null,"risk_level":"MODERATE",…}
  check  : REFUSED, the answer does not say which place it is about
  buying again from SkyWire Storm Alert (miner 7306)

attempt 3: SkyWire Storm Alert (miner 7306), paid $0.01
  answer : {"location":"36.7236, -120.0599","risk_score":0.4,"risk_level":"MODERATE","peak_gust_kmh":7.4,"precipitation_mm":0,…}
  check  : ACCEPTED, answer is about 36.7236, -120.0599, 0 km from the farm
```

TxLens can't take coordinates, so it declined without charging. NWS answered without naming a place, so it was refused. SkyWire answered for the exact farm ([record](https://devnode.telegraphprotocol.com/engine/v1/signal/0x09069a8a4b8d91430c18d39d96dd355e113d40d6d99ca85b8d4b3277ec1091f1)). Swarm Budget sends coordinates for every weather intent, and still checks the echo by distance.

Without `--miner`, Telegraph's routing picked PREFLIGHT Infrastructure Signals, which answered "Kerman, California, United States", and the check accepted it on the first try.

## Step 7: see what you spent

```js
const ledger = await fetch(`${NODE}/v1/ledger/account/${account.address.toLowerCase()}`).then((r) => r.json());
// deposited, charged (billed in closed ledger blocks), unbilled (signed, not yet billed), available
```

```text
escrow: deposited 5 USDC, charged 0.62, unbilled 0.11, available 4.27
```

Answers move from `unbilled` to `charged` when the next ledger block closes. A refused answer still costs money: you paid for it, you just didn't act on it. That's why the check belongs right after the purchase, and why a machine needs a budget.

## From one script to a fleet

Swarm Budget wraps these same steps for five machines (code in [`server/src/`](../server/src/)):

| Here | In Swarm Budget |
|---|---|
| `buy()` | [`escrow.mjs`](../packages/checked-ask/escrow.mjs) `askEscrow()`, with time-outs and a price cap |
| `check()` | [`guard.mjs`](../packages/checked-ask/guard.mjs): place by distance or by name plus region and country, plus market, currency, hour, ranges and imagery |
| the re-buy loop | [`checked-ask.mjs`](../packages/checked-ask/checked-ask.mjs): miners ranked by our own pass rate, every attempt stored with its receipt |
| a price cap | [`budget.mjs`](../server/src/budget.mjs): one daily pool split into a share per machine, plus the owner's switch, checked before every purchase |
| "act on nothing" | [`fleet.mjs`](../server/src/fleet.mjs): a machine acts only on accepted answers; otherwise it holds and says why |

You can watch it run at https://swarmbudget.nerom.site (no wallet needed), or check every claim against the live app and the node:

```bash
node tools/check-live.mjs https://swarmbudget.nerom.site
```

*Built for Telegraph Hackathon Season II (a prize competition). Missions: [11 Autonomous Systems](https://github.com/telegraphprotocol/bounties/issues/199), [06 Resources & Agriculture](https://github.com/telegraphprotocol/bounties/issues/194).*
