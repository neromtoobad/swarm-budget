# checked-ask

Pay for an answer on [Telegraph](https://github.com/telegraphprotocol) from escrow, check it before you act on it, and buy again from another miner when it's wrong. Use it as a library or as an MCP server for AI agents.

This is the guard and re-buy loop from [Swarm Budget](../../README.md), taken out so other apps can use them. The farm fleet runs on this package: `server/src/buyer.mjs` and `server/src/telegraph.mjs` import from it.

**Testnet only.** It pays with test USDC deposited in the Telegraph escrow on Ethereum Sepolia. Nothing here has been tested with real money.

## Why check a paid answer

A miner can answer the question you asked confidently and still be wrong about what you meant. On 2026-11-19, a Telegraph miner answered a storm alert for "Kerman, California" with weather for Kerman, Iran, twice (saved in [`evidence/junk-STORM_ALERT-kerman-iran.json`](../../evidence/junk-STORM_ALERT-kerman-iran.json)). The next day a second miner made the same mistake. Every one of those answers was well-formed and paid for. A machine acting on them would have used gusts from the wrong country.

`checked-ask` refuses an answer like that, then buys from the next compatible miner. That miner is ranked by how often its answers have passed, so a miner refused twice with nothing accepted is skipped.

## What it checks

| Intent | Checks |
|---|---|
| `STORM_ALERT_GENERAL`, `WEATHER_FORECAST_GENERAL` | place (by distance from coordinates, or by name plus region or country), gust or rain chance present and in range, risk level present |
| `WEATHER_FORECAST_VERIFY_GENERAL` | place, the date asked, recorded values present |
| `GRID_POWER_PRICE_GENERAL` | the node or zone asked, USD, the hour asked, a plausible $/MWh |
| `ROUTE_ETA_GENERAL` | a drive time whose speed is physically possible for the distance |
| `SATELLITE_IMAGERY_ANALYSIS_GENERAL` | place, a real reading (not "the vision model was unavailable"), a capture date |
| `WEATHER_CHECK_TEMPERATURE` | a plausible temperature |
| `TASK_EXECUTION_QUALITY_GENERAL` | a verdict, whose reason describes what was actually done (it can't say a held machine acted) and doesn't contradict the verdict |

Any other intent is still bought and returned, with a note that it has no specific checks. A failed request or an empty answer is always refused.

## Use it from an AI agent (MCP)

```json
{
  "mcpServers": {
    "checked-ask": {
      "command": "npx",
      "args": ["-y", "github:neromtoobad/swarm-budget"],
      "env": { "EVM_PRIVATE_KEY": "0x<testnet key with USDC in escrow>" }
    }
  }
}
```

Or from a clone: `npm run mcp` (reads `.env`).

| Tool | Costs | Does |
|---|---|---|
| `ask_checked` | about $0.01 per purchase | buy, check, re-buy; returns the accepted answer (or null) and every attempt's checks, cost and signal link |
| `check_answer` | free | runs the checks on a reply you already have |
| `find_miners` | free | the node's compatible miners for an intent |
| `get_intent` | free | an intent's live schema, so params match exactly |
| `escrow_balance` | free | deposited, charged, unbilled and available, plus this session's spend |

The spending limits are enforced in code before every payment, not left to the model:

| Env | Default |
|---|---|
| `CHECKED_ASK_MAX_USD_PER_PAYMENT` | 0.02. The client will not sign for more than this |
| `CHECKED_ASK_MAX_USD_PER_CALL` | 0.06, across the first purchase and its re-buys |
| `CHECKED_ASK_MAX_USD_SESSION` | 0.30 |

Without `EVM_PRIVATE_KEY`, the free tools work and `ask_checked` buys nothing and says why.

A real run on 2026-11-21 is in [`evidence/checked-ask-mcp-live-2026-11-21.txt`](../../evidence/checked-ask-mcp-live-2026-11-21.txt). It made two purchases for the Kerman farm, one by name and one by coordinates, both accepted, with signal links.

## Use it as a library

```js
import { createEscrowClient, createCheckedAsk } from "./packages/checked-ask/index.mjs";

const client = createEscrowClient({ privateKey: process.env.EVM_PRIVATE_KEY }); // devnode by default
const checkedAsk = createCheckedAsk({
  client,
  maxRebuys: 2,
  canSpend: (ctx, spentThisCall) => (spentThisCall < 0.05 ? { ok: true } : { ok: false, why: "limit" }),
});

const { accepted, attempts, spent_usd } = await checkedAsk({
  intent: "STORM_ALERT_GENERAL",
  params: { location: "36.7236,-120.0599", window_hours: 6 },
  place: { name: "Kerman", region: "California", country: "United States", lat: 36.7236, lon: -120.0599 },
  prefer: ["storm", "weather"], // re-buys try miners whose name fits first
});
if (accepted) act(accepted.result); // only ever act on an accepted answer
```

Hooks on `createCheckedAsk`:
- `canSpend(ctx, spentUsd)` runs before every purchase. Return `{ ok: false, why }` to stop. The fleet uses it for its per-machine budget and the owner's revoke switch.
- `onAsk(info, ctx)` runs as each purchase starts, and `onAttempt(record, ctx)` after each one. Every record has the miner, status, cost, time, signal hash, receipt hash, verdict and checks.
- `record` holds each miner's pass/fail history, used to rank re-buys. It defaults to memory; the fleet passes its SQLite ledger.

`judge(reply, ctx)` and `placeMatches(echo, place)` are exported on their own if you only want the checks.

## Funding a testnet wallet

From the repo root: `npm run fund -- --deposit 2` mints test USDC and deposits it into escrow. See the [tutorial](../../docs/TUTORIAL.md) for the payment flow step by step.

## Tests

`node --test test/checked-ask.test.mjs` (part of `npm test`). It covers:
- the Kerman, Iran refusal and the re-buy;
- re-buy preference by miner name;
- the spending gate;
- skipping a miner refused twice;
- node errors;
- the MCP handshake;
- the free check;
- the no-wallet case;
- the per-call limit.

Every test runs offline on answers saved from the testnet.

## License
MIT. See [LICENSE](LICENSE).

## Not built yet
- Published to npm. Today you install it from GitHub, as above.
- The x402 "exact" rail. The package pays from escrow only; the fleet's own client adds exact.
