# Swarm Budget — Telegraph Hackathon Season II submission

Everything the H2 submission form asks for (rules, section 08), in the order the form asks for it. Fill in the lines marked **[you]**. Lines marked **[refresh]** are numbers to update on submission day from `node tools/check-live.mjs https://swarmbudget.nerom.site`. Numbers here are from Nov 20, 2026, 09:00 UTC.

---

## 1. Project details

| Field | Answer |
|---|---|
| Team / contact | **[you]** solo entry, your name and contact email as on your H2 registration |
| Track | 03 Apps & Agents |
| Project name | Swarm Budget |
| Missions | 11 Autonomous Systems (route 1 "Budget per machine", [bounty #199](https://github.com/telegraphprotocol/bounties/issues/199)); 06 Resources & Agriculture ([bounty #194](https://github.com/telegraphprotocol/bounties/issues/194)) |
| Intents | `STORM_ALERT_GENERAL`, `WEATHER_FORECAST_GENERAL`, `GRID_POWER_PRICE_GENERAL`, `ROUTE_ETA_GENERAL`, `SATELLITE_IMAGERY_ANALYSIS_GENERAL`, `WEATHER_FORECAST_VERIFY_GENERAL`, `TASK_EXECUTION_QUALITY_GENERAL` |
| Working link | https://swarmbudget.nerom.site (no wallet or sign-in needed) |
| Repository | https://github.com/neromtoobad/swarm-budget |
| GitHub user that starred the bounties repo | neromtoobad |

## 2. Short demo

**[you]** 2–5 minute video link, recorded after the UI is approved. What it shows: the real input (Kite's spray question for Kerman, California), the paid Telegraph answer arriving, the guard refusing a bad one and buying again, the signal record on the public node, and the cost report.

## 3. Short public summary

> Swarm Budget is a controller for farm machines that buy their own data. Five simulated machines work a real farm location in Kerman, California: a spray drone, a charging rover, a reefer truck, a scout drone and an auditor. Before any machine acts, it pays for the answers it needs on Telegraph: wind and storms, rain, the power price, drive time, satellite imagery. A guard checks each answer is about the right place, market, hour and unit. If an answer fails, the machine buys again from another miner, and it never acts on a refused answer. The machines share one daily budget, and each has its own share of it. The farm owner can withdraw spending permission at any moment. The fleet reports what an hour of machine work costs in data, and it scores every forecast it bought against the weather that was recorded.
>
> It serves Mission 11 (Autonomous Systems, "Budget per machine") and Mission 06 (Resources & Agriculture).
>
> What works: every answer is a real paid purchase on the Telegraph testnet node, from escrow. On the live network the guard caught a storm report for Kerman, Iran instead of Kerman, California, an Estonian grid price for a California node, and satellite answers with no real reading.
>
> To try it, open https://swarmbudget.nerom.site and press Run now on any machine, run one of the three failure tests, or type your own farm. To check it, run `node tools/check-live.mjs https://swarmbudget.nerom.site`, which prints PASS or FAIL for each claim against the app and the public node. Code, tests and saved evidence: https://github.com/neromtoobad/swarm-budget.

**Links to original H2 updates** (add each one as it is posted):
- X update 1: **[you]** link
- X update 2: **[you]** link
- X update 3: **[you]** link
- Tutorial: [Pay for an answer on Telegraph from Node, check it, and buy again when it's wrong](https://github.com/neromtoobad/swarm-budget/blob/main/docs/TUTORIAL.md), with a one-file example, [examples/pay-and-check.mjs](https://github.com/neromtoobad/swarm-budget/blob/main/examples/pay-and-check.mjs)
- Bounty progress: [#199 /progress](https://github.com/telegraphprotocol/bounties/issues/199), [#194 /progress](https://github.com/telegraphprotocol/bounties/issues/194)
- Evidence for another builder's network report: [#211](https://github.com/telegraphprotocol/bounties/issues/211). A storm miner resolved "Kerman, California" to Iran.
- Independent developer testing: none to report yet. **[you]** add any outside tester or issue here.

## 4. Commercial questions (Apps & Agents)

### Who is it for?
The buyer is a team running autonomous field machines: spray-drone operators, farm robotics companies, and farm-management software adding autonomy. A second group is anyone running a mixed fleet of machines that buy data, such as delivery robots, EV depots and inspection drones.

They meet the problem on every job, not once a month. A spray drone needs wind, gust and rain answers before each flight, because drift is the main spray-safety and liability risk. A reefer truck needs a drive time before each load. A charging rover needs a power price each time it decides when to charge. In this fleet, each job takes 1 to 3 paid answers, and more when one is refused.

### What does it improve?
Today a machine either calls one fixed data provider and trusts whatever comes back, or a person checks an app and decides. Three things change here, each measured on the live app:

- **Quality.** Of 13 answers bought live, 4 (31%) failed the guard **[refresh]**: a storm report for Kerman, Iran instead of Kerman, California, an Estonian grid price with no node or currency for a California node, and satellite reads that were for Illinois or had no reading at all. Each was replaced by a re-buy from another miner, on average 5.1 s later **[refresh]**. No machine acted on any of them. A single-provider integration would have passed every one of them to the machine.
- **Cost control.** Answers cost about $0.01 each on the testnet node. Data costs $0.060 per hour of machine work and $0.033 per completed job **[refresh]**. Each machine has a hard daily share, so one machine, or one visitor clicking it, cannot use up the others' budget. The owner's switch stops the next purchase, even mid-task. An API key with a monthly plan gives none of these per-machine limits.
- **Accountability.** Every action links to the paid answers it used, through their public signal records and escrow receipts. The fleet also scores its own forecasts: whether the rain call was right, the Brier score, and the miss on the day's high and low, by site and horizon.

It is slower: the median paid answer takes 5.2 s (1.6 s to 28.8 s) **[refresh]**, against well under a second for a direct API call. That suits decisions taken minutes before a job, not control loops.

### What does it do today?
All of this is live at https://swarmbudget.nerom.site on the Telegraph testnet node (devnode.telegraphprotocol.com), paid from escrow on Ethereum Sepolia:
- 13 paid answers, $0.13 spent, 4 refused, 4 re-buys, 4 completed jobs from 8 decisions **[refresh]**. Each answer has a public signal record that names our wallet as the buyer, for example [0x6a60…e877](https://devnode.telegraphprotocol.com/engine/v1/signal/0x6a6085b78198574f443ce279ea86be2e4c725a02a4a8fdabd11b1a9e3360e877). The escrow account is on the node's [ledger](https://devnode.telegraphprotocol.com/v1/ledger/account/0x8482e592d6b28d3f5b713cc4576d6ce216b2a78e).
- Autonomous purchases: the server runs one machine every 6 hours on its own, with no visitor involved (`server/src/server.mjs:52-69`, `server/src/autopilot.mjs`). The schedule is read from the saved decisions, so a redeploy neither resets the clock nor sends the turn back to the first machine. First automatic run: Kite on Nov 20 at 10:36 UTC bought a storm alert ([0x348d…5c4b](https://devnode.telegraphprotocol.com/engine/v1/signal/0x348d443fd364d3ba9038f956b3bb5b30d9dee4354ae598dd16a9479b39e65c4b), with our wallet as the buyer on the node) and a rain forecast, both accepted, and sprayed: "gusts 14.4 km/h, 5% rain chance". The page marks such decisions "on its own schedule", and `/api/state` shows their trigger as `auto`. **[refresh]** the count of automatic decisions.
- Mission tests from the page:
  - Bad miner: refused, then bought again.
  - Revoke pay: nothing is bought after the withdrawal, and the drone stays on the pad.
  - Unplug sensor: Haul holds and spends $0.00.
  - Uncertain perception happens in normal runs: Lark refuses a satellite read with no reading, and a cloud-covered read counts as inconclusive.
- The forecast check: 1 forecast scored so far (a 6-hour forecast said 14% rain and Kerman recorded 14.2 mm, a wrong call with Brier 0.74). One 24-hour forecast is waiting for its day to end **[refresh]**.
- Latency: median 5.2 s per paid answer **[refresh]**.
- 42 tests (`npm test`). `tools/check-live.mjs` passes 13/13 against the live app and node.

### Why would someone adopt it?
The data side of autonomy costs one budget, not one contract per provider. The machine pays per answer, from whichever miner passes the checks. The checks are what make paying per answer safe. A wrong-country storm report gets refused before it reaches a sprayer, instead of being found later in an incident review. For spraying, where drift is regulated, the record of what the machine knew, what it paid and why it held is useful to the operator and to an insurer.

It could be priced as a per-machine subscription for the guard, budget and audit layer, with the data passed through at network cost.

What remains before production:
- an adapter to real machines (ROS 2 or MAVLink) in place of the simulated fleet;
- mainnet payments, and a payer key per customer instead of one server key;
- real time zones (local time is worked out from longitude today);
- forecast scores over weeks and many sites, not a few days at one;
- miner coverage for intents that are missing today, such as hedging and port or shipping;
- the x402 "exact" rail, once the public facilitator settles reliably.

### How can someone try it, and who maintains it?
- **No setup:** open https://swarmbudget.nerom.site. Press Run now on a machine, try Bad miner, Revoke pay or Unplug sensor, or type a farm in "Try your own farm". Visitors spend the fleet's testnet budget, rate-limited per IP, and never sign anything.
- **Check it:** `node tools/check-live.mjs https://swarmbudget.nerom.site`.
- **Run your own:** see section 5.

Maintained by neromtoobad (solo) at https://github.com/neromtoobad/swarm-budget. Issues and pull requests are welcome there.

## 5. How to run it

**Prerequisites:** Node 24 and git. To make paid requests of your own, you also need a fresh testnet-only wallet with about 0.01 Sepolia ETH for gas, from any Sepolia faucet. You don't need a wallet to run the tests or use the live app.

**Steps:**
```bash
git clone https://github.com/neromtoobad/swarm-budget && cd swarm-budget
npm install
npm test                                  # 42 tests, no key, no network, no spend
cp .env.example .env                      # put your testnet key in EVM_PRIVATE_KEY and its address in EVM_ADDRESS
npm run fund -- --deposit 2               # mints 10 test USDC, then deposits 2 into the Telegraph escrow
npm run dev                               # http://localhost:4380 (TICK_SECONDS=0 in .env stops the automatic loop)
node tools/check-live.mjs                 # in a second terminal: PASS/FAIL for every claim against your app and the node
```

**Configuration** (all in `.env`, explained in `.env.example`):
- `DAILY_BUDGET_USD`: default 3; the live site uses 0.30.
- `TICK_SECONDS`: default 300; the live site uses 21600.
- `MAX_REBUYS`: how many other miners to try after a refusal, default 2.
- `MACHINE_SHARES`: each machine's weight of the daily budget.
- `OWNER_TOKEN`: turns on the owner's stop-spending switch.

**Sample request** (on the live app, or on `localhost:4380`):
```bash
curl -s -X POST https://swarmbudget.nerom.site/api/decide -H 'content-type: application/json' -d '{"machine":"haul"}'
```
**Expected result:** a JSON decision with `outcome` (`act`, `hold` or `unverified`), a plain `summary` (for example "Leaves for Fresno: 25 min drive fits the 45-min cold chain."), `cost_usd`, and `purchases`. Each purchase has its `miner_name`, `verdict`, the guard's `checks`, `signal_hash` and `receipt_hash`. Open `https://devnode.telegraphprotocol.com/engine/v1/signal/<signal_hash>` to see the request on the node, with our wallet as the buyer.

**A failure case to test:**
```bash
curl -s -X POST https://swarmbudget.nerom.site/api/decide -H 'content-type: application/json' -d '{"machine":"mule","test":"bad-miner"}'
```
The first purchase goes to a miner seen answering for Estonia. The guard refuses it (`verdict: "rejected"`), and a re-buy from a CAISO miner follows. The other tests are `"revoke-pay"` on `kite` and `"unplug-sensor"` on `haul` or `kite`.

**Network:**
- Telegraph testnet node https://devnode.telegraphprotocol.com, escrow rail.
- Escrow Diamond `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`, test USDC `0xcc194e1a843B658526D0D5C431f670028582Ae17`, both on Ethereum Sepolia.

**Spending limits and costs:**
- About $0.01 of test USDC per answer.
- The live site: $0.30 a day, split into machine shares: Kite and Mule $0.075, Lark $0.06, Haul and Ledger $0.045.
- Visitors: 8 decisions and 3 farm runs per IP per hour.
- When a share or the day's budget is spent, machines hold and say so. The budget resets at 00:00 UTC.

**Known limitations:**
- The machines, their sensors, and the owner in the Revoke pay test are simulated, and the page says so.
- Hours per job come from a fixed table, except Haul's, which use the bought drive time.
- One server-held testnet key pays for everything.
- The guard checks that an answer is consistent with the question. It cannot prove a reading is true; the forecast check measures that afterwards.
- Answers can take up to about 30 s.

## 6. Evidence

| What | Where |
|---|---|
| Paid requests | Every purchase's public signal record (`/engine/v1/signal/{hash}`), linked from each receipt on the page and stored in SQLite with its escrow receipt hash and epoch |
| Accounting | Escrow ledger for the payer on the node: [0x8482…a78e](https://devnode.telegraphprotocol.com/v1/ledger/account/0x8482e592d6b28d3f5b713cc4576d6ce216b2a78e). The app's own report is under "What an hour of work costs" and in `/api/state` → `costs` |
| Endpoints | `GET /api/state` (everything the page shows), `POST /api/decide`, `POST /api/try`, `GET /api/stream` (live events), `GET /api/ledger` |
| Saved answers | `evidence/` in the repo, including `junk-STORM_ALERT-kerman-iran.json`, `name-vs-coordinates-STORM_ALERT.json`, `rebuy-GRID_POWER_PRICE_GENERAL-714106.json`, `junk-SATELLITE-no-reading.json` |
| Tests | `npm test`: 42 tests in six files (`guard`, `budget`, `failures`, `fleet`, `forecast-check`, `autopilot`). The guard tests use the real saved answers, and the failure, fleet and forecast-check tests run the real buyer and guard |
| Live verification | `tools/check-live.mjs`: 13 checks, including that the fleet bought on its own schedule, that no machine acted on a refused answer, that no machine spent past its share, that revoked and unplugged runs bought nothing, and that the cost and forecast scores match the answers they came from |
| Evaluation method | Forecast check: the rain call (≥ 50% means rain; ≥ 1 mm recorded means a rainy day), the Brier score, and the absolute miss on the day's high and low, grouped by site and horizon (`server/src/forecast-check.mjs`) |
| Rankings | The miner board on the page and `/api/state` → `miners`: each miner's accepted, refused and failed counts per intent. These counts rank re-buys (`server/src/buyer.mjs:20-35`) |
| Claims to code | README "Claims" table: each claim with its `file:line` and the check that proves it. [JUDGES.md](JUDGES.md) maps the rubric |

## 7. Showcase permission

**[you]** This is your choice, and it doesn't affect technical scores. Suggested answer:

> All text, screenshots, recordings and tutorials for Swarm Budget may be shared publicly by Telegraph, crediting neromtoobad and linking the repo. The live app may be featured. Yes to possible buyer introductions.

There is no Anjoman experience yet. If one is listed before Dec 1, add it here.

## 8. Prior work and reuse

- The repo was created at the event; its first commit is on 2026-11-19, after the start on 2026-11-01. No code was reused from earlier projects.
- Libraries: `viem`, `@x402/fetch` and `@x402/evm` (npm), and three.js (from a CDN).
- NASA GIBS imagery: public, for the satellite read.
- Open-Meteo geocoding: only to place a typed farm, never for a decision.
- Built with Claude Code: research, code, tests and docs, as stated in the README.

## Before pressing submit

- [ ] Registered on hackathon.telegraphprotocol.com **[you]**
- [ ] The demo video is recorded and linked here and in the README
- [ ] The three X updates are posted on separate dates and linked above
- [x] The tutorial is published and linked (docs/TUTORIAL.md)
- [ ] Every **[refresh]** line is updated, and `check-live` passes
- [x] At least one automatic (`auto`) decision on the live app, with its signal link in section 4 (Kite, Nov 20 10:36 UTC)
- [ ] `/submit` is posted on #199 and #194
- [ ] The live app and its Railway service stay up through judging
