# For judges

No wallet or sign-in needed. Everything below runs against the public Telegraph testnet node.

| Do this | You see |
|---|---|
| Open the app and click **Run now** on Kite | Two purchases (storm alert, rain forecast). For each, a card opens over Kite with the answer and the guard checks, then a stamp. Kite sprays or holds and the receipt says why, with numbers |
| Click any `signal 0x…` link in the receipts | The node's own record of that answer. `wallet_address` is the fleet's payer |
| Click **Bad miner** on Mule | The first answer comes from an Estonian grid miner for a California node. It is refused in red, and the next purchase is a re-buy from a CAISO miner |
| Type `Salinas, California` in **Try your own farm** | A new location, new live answers, four decisions |
| `node tools/check-live.mjs <app-url>` | PASS/FAIL per claim, checked against the node, not just our database |
| `npm test` | Guard tests built on real junk answers saved in `evidence/` |

## Failure cases to try
- **Wrong place:** `evidence/junk-STORM_ALERT-kerman-iran.json`. Two miners answered for Kerman, Iran. The test "same town name in another country is refused" replays it.
- **Wrong market:** Mule's **Bad miner** button.
- **No imagery analysed:** `evidence/junk-SATELLITE-no-reading.json` ("the vision model was unavailable"), replayed by the test "a satellite answer with no reading is refused". Lark's **Bad miner** button sends to TxLens 9002; at the moment the node returns 503 for that direct ask, which the page shows as "No answer" and nothing is charged.
- **Budget spent:** set `DAILY_BUDGET_USD=0.02` and run Kite twice. The second decision pays for nothing, because the buyer stops before paying (`server/src/buyer.mjs:48-51`), and the drone stays on the pad.

## Rubric (Telegraph H2 /rules)
| Criterion | Where we meet it |
|---|---|
| Technical quality and mainnet readiness (35) | Escrow payment client written from the 402 challenge (`server/src/telegraph.mjs`), guard with tests on real failures, re-buy ranking, budget, SQLite ledger, SSE. Only the node URL and key change for mainnet |
| Commercial viability (25) | Any machine operator buying data per decision needs the same thing: don't act on a confident answer about the wrong place. The guard and buyer are separate modules (`guard.mjs`, `buyer.mjs`) |
| Telegraph integration and usage quality (5) | 7 intents, routed and direct asks, miner discovery for re-buys, signal and ledger endpoints for proof |
| Reproducibility and verifiable proof (5) | `.env.example`, `npm test`, `tools/check-live.mjs`, `evidence/` |
| Organic growth, education, developer activation (20) | Not done yet (see README "Not built yet") |
