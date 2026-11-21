# For judges

No wallet or sign-in needed. Everything below runs against the public Telegraph testnet node.

| Do this | You see |
|---|---|
| Open the app and click **Run now** on Kite | Two purchases (storm alert, rain forecast). For each, a card opens over Kite with the answer and the guard checks, then a stamp. Kite sprays or holds and the receipt says why, with numbers |
| Click any `signal 0x…` link in the receipts | The node's own record of that answer. `wallet_address` is the fleet's payer |
| Click **Bad miner** on Mule | The first answer comes from an Estonian grid miner for a California node. It is refused in red, and the next purchase is a re-buy from a CAISO miner |
| Click **Revoke pay** on Kite | Kite buys one answer, then the owner's permission is withdrawn (simulated). No second purchase is made, and Kite stays put: "Stopped mid-task…" |
| Click **Unplug sensor** on Haul | Haul's reefer thermometer is offline (simulated). Haul holds the load and the receipt says "Nothing paid" |
| Scroll to **What an hour of work costs** | Cost per hour of machine work and per finished job, mean recovery time after a refused answer, per machine |
| Scroll to **Did the forecast come true?** | Each forecast the fleet bought, scored against the recorded weather for its day (also bought): rain calls right, Brier score, high/low miss, by site and horizon |
| Type `Salinas, California` in **Try your own farm** | A new location, new live answers, four decisions |
| Open `/api/state` and look at `autopilot`, then at decisions with `"trigger": "auto"` | The next machine the fleet will run on its own and when, and the paid decisions it already made with no visitor involved (the page marks them "on its own schedule") |
| `node tools/check-live.mjs <app-url>` | PASS/FAIL per claim, checked against the node, not just our database |
| `npm test` | Guard tests built on real junk answers saved in `evidence/` |
| `npx -y github:neromtoobad/swarm-budget` as an MCP server in any agent (see [`packages/checked-ask`](packages/checked-ask/README.md)) | Tools `ask_checked`, `check_answer`, `find_miners`, `get_intent`, `escrow_balance`. Without a key, the free tools work and `ask_checked` buys nothing and says why |

## Failure cases to try
- **Wrong place:** `evidence/junk-STORM_ALERT-kerman-iran.json`. Two miners answered for Kerman, Iran. The test "same town name in another country is refused" replays it.
- **Wrong market:** Mule's **Bad miner** button.
- **No imagery analysed:** `evidence/junk-SATELLITE-no-reading.json` ("the vision model was unavailable"), replayed by the test "a satellite answer with no reading is refused". Lark's **Bad miner** button sends to TxLens 9002; at the moment the node returns 503 for that direct ask, which the page shows as "No answer" and nothing is charged.
- **Budget spent:** set `DAILY_BUDGET_USD=0.02` and run Kite twice. The second decision pays for nothing, because the buyer stops before paying (`packages/checked-ask/checked-ask.mjs:75-79`), and the drone stays on the pad.
- **One machine's share spent:** set `DAILY_BUDGET_USD=0.06` and run Kite: its share ($0.015) covers one answer, so the forecast is not bought and Kite says "No purchase was made: Kite's share of today's budget… is spent". Run Haul next and it still buys and decides. Tests: `test/budget.test.mjs`. The budget meter on the page has one segment per machine.
- **Revoked spend authorization:** Kite's **Revoke pay**, or locally set `OWNER_TOKEN=x` and `curl -X POST localhost:4380/api/authority -H "Authorization: Bearer x" -d '{"revoked":true}'`. Every machine then buys nothing and says why. Tests: "revoked spend authorization mid-task…", "owner's standing revocation…".
- **Record not published yet:** when the recorded weather for a forecast's day comes back without values, the guard refuses it, the forecast stays waiting, and Ledger asks for that day again on its next run. Test: "a day whose record is not published yet stays waiting…".
- **Disconnected sensor:** Haul's **Unplug sensor**. Test: "disconnected sensor: Haul holds the load and buys nothing".

## Rubric (Telegraph H2 /rules)
| Criterion | Where we meet it |
|---|---|
| Technical quality and mainnet readiness (35) | Escrow payment client written from the 402 challenge (`packages/checked-ask/escrow.mjs`), guard with tests on real failures, re-buy ranking, budget, spending permission checked before every purchase, SQLite ledger, SSE. Only the node URL and key change for mainnet |
| Mission 11 measures | Cost per operating hour and per completed job, mean recovery time, refusals counted (`server/src/costs.mjs`); the three named tests (uncertain perception, disconnected sensor, revoked spend authorization) are buttons on the page and unit tests. See README "Mission 11 fit" |
| Mission 06 measures | Forecast error by site and horizon: rain calls right, Brier score, temperature miss, each forecast paired with the recorded weather bought for its day (`server/src/forecast-check.mjs`). See README "Mission 06 fit" |
| Commercial viability (25) | The five commercial answers are in [SUBMISSION.md](SUBMISSION.md#4-commercial-questions-apps--agents). Any machine operator buying data per decision needs the same thing: don't act on a confident answer about the wrong place. The guard and re-buy loop are a separate package other apps can use, as a library or an MCP server ([`packages/checked-ask`](packages/checked-ask/README.md)) |
| Telegraph integration and usage quality (5) | 7 intents, routed and direct asks, miner discovery for re-buys, signal and ledger endpoints for proof |
| Reproducibility and verifiable proof (5) | Run steps with a sample request and a failure case in [SUBMISSION.md](SUBMISSION.md#5-how-to-run-it); `npm run fund -- --deposit 2` funds a fresh testnet wallet's escrow; `.env.example`, `npm test`, `tools/check-live.mjs`, `evidence/` |
| Organic growth, education, developer activation (20) | Reusable package: [`checked-ask`](packages/checked-ask/README.md) gives other apps and AI agents (MCP) the same buy, check and re-buy, with spending limits enforced in code; the fleet runs on it. Tutorial: [Pay for an answer on Telegraph from Node, check it, and buy again when it's wrong](docs/TUTORIAL.md). It has a one-file example (`examples/pay-and-check.mjs`), real outputs and signal links. Evidence for another builder's report on [#211](https://github.com/telegraphprotocol/bounties/issues/211). X updates are linked in [SUBMISSION.md](SUBMISSION.md) as they are posted |
