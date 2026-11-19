# Telegraph Hackathon Season II (H2) — research notes (Nov 7, 2026)

Site: https://hackathon.telegraphprotocol.com/build · Rules: /rules · Docs: https://anjoman.ai/docs
Bounties repo (MUST be starred by the submitting GitHub account): https://github.com/telegraphprotocol/bounties (cloned in ref/)

## Dates (UTC)
- Nov 1 open · **Nov 14 First Integration Milestone** (show a working paid request; progress check, not a cutoff)
- Nov 20 community showcase · final week: Anjoman hands-on session
- **Dec 1 23:59 UTC final deadline** (submit on the H2 site) · Dec 2–8 judging · Dec 9+ results, 72h appeal

## Prizes ($10k total, $7k main)
- Apps & Agents $3,000: 8 delivery awards × $225 + excellence $700 / $350 / $150
- Miners $2,000 and Evaluators $2,000: each 4 × $300 delivery + $500 / $300 excellence
- Delivery awards favour: distinct completed missions, missions served by only ONE entrant, shared capabilities
- One delivery + one excellence per track max; tracks can be combined if each entry is distinct

## Judging (need ≥70/100 and ≥24/35 technical)
Technical & mainnet readiness 35 · Commercial 25 · Organic growth/education 20 (content 5, ease of adoption 5,
distribution 5, community 5) · Independent adoption 10 · Integration quality 5 · Reproducibility 5.
A mission counts only if a reviewer can run it on NEW input, check the result, inspect the real request + receipt,
test a failure case, and reproduce it. Apps must make ≥1 autonomous machine-to-machine purchase (testnet OK).
Submission: 2–5 min demo video, how-to-run, evidence (receipts/signal hashes), public summary, 5 commercial answers
(who for, what it improves, what it does today, why adopt, how to try).

## Tech
- Testnet = Ethereum Sepolia (11155111). Node: https://devnode.telegraphprotocol.com (engine /engine, daemon /daemon)
- Pay: x402 "exact" (EIP-3009, facilitator https://facilitator.x402.rs pays gas) or escrow on the Diamond
  0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b. Test USDC 0xcc19…Ae17 is open-mint (mint needs Sepolia ETH gas).
- Price: $0.01/request floor × demand multiplier. Failed paid calls are credited to escrow.
- `POST /engine/v1/ask` with `{intent, params}` (typed) or `{query}` (auto-routed). Node 20+, `@x402/fetch @x402/evm viem`,
  MUST pass `spendControls.allowedAssets` for the test USDC. Receipt in `X-TELEGRAPH-RECEIPT`; keep `signal_hash`.
- Free discovery: `/engine/v1/intents` (136 live, all have 10–53 miners), `/api/miners?intent=`, `/engine/v1/intents/{i}/miners`,
  `/engine/v1/signal/{hash}`, daemon feed `/daemon/api/questions?source=user` (public; questions are public!).
- Also: MCP server (Telegraph-MCP), WebSocket, ERC-8183 on-chain jobs ($1/job on testnet).
- Burner: `.env` here (EVM_ADDRESS 0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E) — needs ~0.01 Sepolia ETH, then mint USDC.

## What the live feed shows (3,000 paid user requests, Nov 5–7)
Crowded by other builders: CODE_REVIEW (623), REGULATORY_FILING_MONITOR (455, 79% errors), SANCTIONS (345),
CORPORATE_REGISTRY (197), SMART_CONTRACT_AUDIT (165), TOKEN_HOLDER_COUNT (137), GRID_POWER/HASHPRICE (~200),
WASH_TRADING, LIQUIDITY_DEPTH → i.e. Exchange, Legal/KYB, Model Economy, Mining & Power are being built.
Quiet: Consumer Automation, Commodities, Resources & Agriculture, Autonomous Systems, Personal Agent, Conflict Intel.

Answer quality is the real problem — "success" often means junk:
- GOOD: SANCTIONS (OFAC/EU/UK candidates with BLOCK verdicts), SMART_CONTRACT_AUDIT (GoPlus), TRAVEL_DISRUPTION (FAA NAS NOTAMs)
- JUNK marked success: VESSEL "Ever Given" → random ships; PACKAGE_STATUS → ship AIS; STORM_ALERT Houston → India cyclone;
  WEATHER_FORECAST_VERIFY Berlin → empty Canadian query; SHIP_RATE_ETA → invented "3500"; VIDEO_VERIFICATION → "can't view".
- Bounty issues #177/#181 report the same (wrong game, empty answers).
→ An app that checks every bought answer actually answers the question, re-buys from another miner when it doesn't,
  and refuses to act on junk, is both honest and differentiating ("test a failure case" is in the rubric).

Evaluator board is crowded (~40 issues in review/claimed). Miners track: few obvious slots, needs a real data source.
