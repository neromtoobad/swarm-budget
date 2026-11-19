# Swarm Budget (working name) — Telegraph H2, Track 3 Apps & Agents

A live 3D farm where a mixed fleet (spray drones, a scout drone, an electric rover, a hauling truck) shares one
intelligence budget. Before any machine acts, it pays Telegraph for the answer it needs, checks the answer is about
the right place / unit / time, buys again from the next-ranked miner if not, and only then moves. Every purchase
becomes a receipt coin you can click to verify on the node.

**Missions:** 11 Autonomous Systems (one budget across machines · verify before acting · skill bought mid-task)
+ 06 Resources & Agriculture (per-block days-to-impact from forecast vs verified weather).

**Place:** a real Central Valley farm near Fresno, CA — so CAISO grid prices (zone TH_ZP26_GEN-APND) are real,
and weather/route intents resolve. Viewer can type any other farm location (= "new input" for reviewers).

## Decisions and the intents they buy

| Machine | Decision | Intents bought | Act / refuse rule |
|---|---|---|---|
| Spray drone | spray block now or hold | WEATHER_FORECAST_GENERAL (wind, rain prob), STORM_ALERT_GENERAL | gust > 15 km/h or rain > 40% → hold |
| Rover (EV) | charge now or later | GRID_POWER_PRICE_GENERAL (this hour vs +3h) | charge in the cheapest hour |
| Truck | leave for packhouse now | ROUTE_ETA_GENERAL farm → Fresno packhouse | leave if ETA fits the cold-chain window |
| Scout drone | what's in this field | SATELLITE_IMAGERY_ANALYSIS_GENERAL | sourceless answer → "unverified", never acted on |
| Any | was yesterday's call right | WEATHER_FORECAST_VERIFY_GENERAL + TASK_EXECUTION_QUALITY_GENERAL | scores the fleet's own past decisions |

## The guard (the core, also shipped as a small npm package for growth points)
Per answer, before acting: `field_status` ok · location echoed back within N km of the asked place · unit/currency
matches the schema (EUR for a CAISO node → reject) · timestamp fresh · value in schema range · sourceless LLM prose
flagged unverified. On reject: look up `/engine/v1/intents/{i}/miners`, re-ask `/engine/v1/ask/{minerId}` on the next
one, cap retries, log both receipts. Budget cap per machine + fleet-wide, enforced before signing.

## Build
- `server/` Node 24: fleet loop + x402 client (`@x402/fetch`, `@x402/evm`, `viem`), guard, receipts ledger (SQLite
  on a volume), SSE stream. Decision tick every ~2 min so 10 test USDC lasts days. Test USDC is open-mint.
- `web/` three.js light-theme farm with machines, receipt coins and a side ledger (signal_hash → node lookup link),
  "Try your farm" input, "Break a miner" button that forces a known-bad miner to show the refusal.
- Deploy Railway + `swarm…nerom.site` style subdomain (name TBD).

## Milestones
- **Nov 8–9** first paid request + receipt from the burner (needs Sepolia ETH) → Nov 14 milestone covered
- Nov 10–15 guard + fleet loop with real purchases, ledger
- Nov 16–22 3D world, SSE, try-your-farm, break-a-miner; post progress at the Nov 20 showcase
- Nov 23–28 npm guard package + tutorial post + X thread (growth 20 pts), mainnet-readiness notes
- Nov 29–Dec 1 demo video (2–5 min), README how-to-run, evidence list, submit

## Needs from the user
1. ~0.01 Sepolia ETH → 0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E (faucet needs captcha)
2. Register on the H2 site, Track 3, missions Autonomous Systems (+ Resources & Agriculture)
3. Star github.com/telegraphprotocol/bounties from the submitting GitHub account
