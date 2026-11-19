# HACK.md — Telegraph Hackathon Season II (H2)

- **Event:** Telegraph Hackathon Season II — https://hackathon.telegraphprotocol.com/build
- **Start:** 2026-11-01 (UTC). First commit of this repo: 2026-11-19.
- **Deadline:** 2026-12-01 23:59 UTC, submitted on the H2 site.
- **Track:** 03 Apps & Agents. **Missions:** 11 Autonomous Systems, 06 Resources & Agriculture.
- **Prize:** $3,000 track pool — 8 × $225 delivery awards + $700 / $350 / $150 excellence.

## Judging (quoted from /rules, out of 100, ≥70 to win, technical ≥24/35)
| Criterion | Points |
|---|---|
| Technical quality and mainnet readiness | 35 (min 24) |
| Commercial viability | 25 |
| Genuine independent adoption and retention | 10 |
| Telegraph integration and usage quality | 5 |
| Reproducibility, demo/tutorial, and verifiable proof | 5 |
| Organic growth, education, and developer activation | 20 |

A mission counts only if a reviewer can run the app on new input, check the result, inspect the real Telegraph
request and its evidence, test a failure case, and reproduce it. Apps must make at least one autonomous
machine-to-machine purchase.

## The idea in one sentence
A fleet of farm machines that pays for each answer it needs (wind, storms, power price, drive time) before it moves,
throws out answers about the wrong place or in the wrong units, and buys again instead of acting on junk.

## Similar products and what is new
- Farm management dashboards (Climate FieldView, John Deere Operations Center) show data to a person; they do not
  buy answers per decision or check them.
- Agent-wallet demos pay for API calls but trust whatever comes back.
New here: one shared intelligence budget across machines, every decision tied to a paid receipt, and a guard that
measurably rejects wrong-place / wrong-unit answers (we saw them live on the network) and re-buys from the next miner.

## Why Telegraph is the core
Each decision is a Telegraph purchase routed to ranked miners; the guard uses Telegraph's per-intent miner ranking to
re-buy; receipts and signal hashes are the audit trail. Without Telegraph there is nothing to buy or verify.

## Honest scope
The machines are simulated (no real drones). The intelligence, payments, receipts and refusals are real Telegraph
testnet traffic, paid from escrow on Ethereum Sepolia.
