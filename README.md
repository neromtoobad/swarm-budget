# Swarm Budget: farm machines that pay for an answer before they move, and refuse the wrong ones

**Live:** not deployed yet, so run it locally (below) · **Video:** not recorded yet · **Built at:** Telegraph Hackathon Season II, Nov 2026 (Track 03 Apps & Agents; missions 11 Autonomous Systems and 06 Resources & Agriculture)

**Proof:** every answer the fleet uses is a paid Telegraph purchase. Its signal record on the public node names our wallet as the buyer, for example
[`/engine/v1/signal/0x2be2…99a8`](https://devnode.telegraphprotocol.com/engine/v1/signal/0x2be2cfc707ea4c40e67676a0b3366e0cf9f30dd8287f04a3d3a98df3597199a8),
paid from escrow by [`0x8482…A78E`](https://devnode.telegraphprotocol.com/v1/ledger/account/0x8482e592d6b28d3f5b713cc4576d6ce216b2a78e).

![The farm and its ledger: Kite holds on 45.7 km/h gusts after the guard refused an answer about Kerman, Iran](docs/screenshot.png)

Five simulated machines work a real farm location in Kerman, California: a spray drone, a charging rover, a delivery truck, a
scout drone and an auditor. They share one daily budget. Before any machine acts, it buys the answers it needs on Telegraph
(wind, storms, rain, power price, drive time, satellite imagery). A guard checks each answer is about the right place, market,
hour and unit. If an answer fails, the machine buys again from a different miner. A machine never acts on a refused answer.

## For judges: verify in 2 minutes
| Do this | You see |
|---|---|
| `npm install && npm test` | 14 tests. Guard tests run on real answers saved in `evidence/`, including the Kerman, Iran one |
| `node tools/check-live.mjs` (against a running app) | PASS/FAIL for each claim below, read from the app and the public Telegraph node |
| Open the app and click **Run now** on Kite | Purchases stream into the ledger. Each has a signal link to the node and an escrow receipt |
| Click **Send to a bad miner** on Mule | First purchase goes to Grid Elering (Estonia) for a California node. The guard refuses it and re-buys from a CAISO miner |
| Type a farm in **Try your own farm** | Four machines decide for a new place on new, live answers |

## What the guard caught on the live network
| Asked | Miner answered | Guard |
|---|---|---|
| Storm alert for Kerman, California | `"Kerman, Kerman, Iran"`, gusts 21 km/h (TxLens, PREFLIGHT) | refused: same town name, different place. By coordinates, the real farm had **45.7 km/h**. See `evidence/name-vs-coordinates-STORM_ALERT.json` |
| CAISO price at `TH_ZP26_GEN-APND` | Grid Elering answer with no node and no currency | refused, then bought again: CAISO NP15 failed (500), ZK CAISO accepted at $57.33/MWh. See `evidence/rebuy-GRID_POWER_PRICE_GENERAL-714106.json` |
| Satellite read of the farm | an answer about Illinois / "no image supplied" | refused: wrong place, or no imagery was analysed. See `evidence/rebuy-SATELLITE_IMAGERY_ANALYSIS_GENERAL-7445.json` |
| Satellite read under cloud | "dense cloud cover… impossible to observe the fields" | counted as **inconclusive**, so irrigation keeps its schedule. See `test/fleet.test.mjs` |

## Claims (every one checkable today)
| Claim | Where in code | Check |
|---|---|---|
| Pays Telegraph per answer with an EIP-191 signed escrow authorization in `X-PAYMENT` | `server/src/telegraph.mjs:65`, `:94`, `:98` | check-live: "every purchase carries a Telegraph signal hash and an escrow receipt" |
| Keeps the escrow receipt (`X-PAYMENT-RESPONSE`) for every purchase | `server/src/telegraph.mjs:107`, `server/src/store.mjs:16` | ledger rows show `receipt …` and `epoch …` |
| Judges every answer before use | `server/src/buyer.mjs:52`, `server/src/guard.mjs:134` | `npm test` |
| Refuses a same-name town in another region or country | `server/src/guard.mjs:49` | test "same town name in another country is refused" |
| Re-buys from the next compatible miner, ranked by our own pass rate per miner | `server/src/buyer.mjs:21-35`, `:69` | check-live: "guard has refused… and a re-buy followed" |
| Never acts on a refused answer | `server/src/fleet.mjs` (`get()` returns only accepted results) | check-live: "no machine acted on a refused answer" |
| One shared daily budget; purchases stop when it is spent | `server/src/server.mjs:25` | check-live: "daily budget is enforced" |
| Weather asks use coordinates, because names resolved to the wrong country | `server/src/fleet.mjs:79-80`, `:144` | `evidence/name-vs-coordinates-STORM_ALERT.json` |
| Satellite read passes real NASA GIBS imagery of the farm to the miner | `server/src/fleet.mjs:128` | ledger row "Satellite read", the question carries `image_url=` |

## Not built yet
- Real hardware. The machines are simulated: positions and motion in the 3D view are animation only.
- x402 "exact" rail in production. The client supports it (`server/src/telegraph.mjs`, `ask()`), but the public facilitator timed out on settle during the event, so the app pays through escrow.
- Live deployment and demo video.

## What's real
| Part | Status | Proof |
|---|---|---|
| Telegraph purchases | real, testnet node, escrow rail | signal links in the ledger; `tools/check-live.mjs` |
| Payment | 5 test USDC deposited to the escrow Diamond `0x72a7…a08b` on Ethereum Sepolia | [ledger account](https://devnode.telegraphprotocol.com/v1/ledger/account/0x8482e592d6b28d3f5b713cc4576d6ce216b2a78e) |
| Guard, re-buy, budget, decisions | real code on every purchase | `server/src/guard.mjs`, `buyer.mjs`, `fleet.mjs` |
| Farm location geocoding | Open-Meteo geocoding, used only to set up a typed farm. It never feeds a decision | `server/src/fleet.mjs:37` |
| Machines, 3D farm | **simulated**: there are no drones. The UI and this README say so | `web/index.html` ("Machines are simulated…") |

## The problem
An autonomous machine that buys data has no way to tell a good answer from a confident one about the wrong place. On the
live network we saw a storm answer for Kerman, Iran instead of Kerman, California, an Estonian grid price for a California
node, and a satellite answer about Illinois. A spray drone acting on the first one would have used the wrong wind data.

## How it works
1. A machine starts a decision (`server/src/fleet.mjs`, `decide()`), on its own loop or from a visitor.
2. For each answer it needs, the buyer asks Telegraph, which routes to its top-ranked miner, and pays from escrow (`server/src/telegraph.mjs`).
3. The guard checks the answer against what was asked: place (by coordinates or by name with region/country), node, currency, hour, plausible ranges, and whether imagery was really analysed (`server/src/guard.mjs`).
4. If it fails, the buyer picks the next compatible miner from `/engine/v1/intents/{intent}/miners`, skipping miners that keep failing, and buys again (`server/src/buyer.mjs`).
5. The machine acts or holds only on accepted answers. Every purchase, verdict, receipt and signal hash goes to SQLite (`server/src/store.mjs`) and streams to the page over SSE (`server/src/server.mjs`).

## Telegraph integration
- **Intents used:** `STORM_ALERT_GENERAL`, `WEATHER_FORECAST_GENERAL`, `GRID_POWER_PRICE_GENERAL`, `ROUTE_ETA_GENERAL`,
  `SATELLITE_IMAGERY_ANALYSIS_GENERAL`, `WEATHER_FORECAST_VERIFY_GENERAL`, `TASK_EXECUTION_QUALITY_GENERAL`.
- **Routed and direct asks:** `POST /engine/v1/ask` for the first try, `POST /engine/v1/ask/{minerId}` for re-buys.
- **Miner discovery:** `/engine/v1/intents/{intent}/miners` (compatible miners) feeds the re-buy ranking.
- **Payments:** escrow scheme: challenge from the 402, EIP-191 signature, receipt from `X-PAYMENT-RESPONSE`, billed at epoch close.
- **Proof:** `/engine/v1/signal/{hash}` for each answer, `/v1/ledger/account/{addr}` for spend.

## Trust model & limitations
- One server-held testnet key pays for everything (`EVM_PRIVATE_KEY`). Visitors never sign anything. Their paid actions are rate-limited (8 decisions and 3 farm runs per IP per hour) and capped by the daily budget.
- The guard checks consistency with the question. It cannot prove a gust reading is true. The auditor machine (Ledger) later checks yesterday's spray call against recorded weather.
- "Send to a bad miner" points the first purchase at miners we saw fail before (`server/src/server.mjs:77`). The refusal itself still comes from the guard on the live answer.

## Run it
```bash
cp .env.example .env            # add a testnet key; fund it with scripts/fund.mjs
npm install
npm test
npm run dev                     # http://localhost:4380  (TICK_SECONDS=0 to stop the automatic loop)
node tools/check-live.mjs       # in another shell
```

## Built at the event
First commit 2026-11-19, after the event start (2026-11-01). Nothing was reused from earlier projects. Libraries:
`@x402/fetch`, `@x402/evm`, `viem`, `three` (CDN). `RESEARCH.md` and `PLAN.md` hold the notes made while choosing the idea.

## AI usage
Built with Claude Code: research on the Telegraph API, code, tests and this README. Each decision and refusal shown in
the app comes from live Telegraph answers at run time. Nothing is canned.
