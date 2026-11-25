# Place-trap evaluation packs — Telegraph Hackathon Season II submission (Evaluators)

What the submission form asks for (rules, section 08), in order. Lines marked **[you]** are yours to fill. This is a separate entry from the Swarm Budget app ([SUBMISSION.md](SUBMISSION.md)) and from the Pinpoint Weather miner ([SUBMISSION-MINER.md](SUBMISSION-MINER.md)), by the same team.

## 1. Project details

| Field | Answer |
|---|---|
| Team / contact | **[you]** same as the Swarm Budget entry |
| Track | Evaluators (evaluation material; no adapter registered) |
| Project name | Place-trap evaluation packs |
| Intents and material version | `STORM_ALERT_GENERAL` (220 rows), `WEATHER_FORECAST_GENERAL` (220), `WEATHER_FORECAST_VERIFY_GENERAL` (130). Version 1, uploaded 25 November 2026; each file's sha256 is in [evaluator/results/](evaluator/results/) |
| Missions these intents serve | 06 Resources & Agriculture and 11 Autonomous Systems. `WEATHER_FORECAST_VERIFY_GENERAL` is also in the starting map of 05, 08 and 12 |
| Reviewer-access link | [Our rows in the pool](https://devnode.telegraphprotocol.com/api/evalpool/submissions/mine?submitter=0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E&intent_id=STORM_ALERT_GENERAL) (states and row identities; the node never shows row content). The content is public in the repository |
| Repository | https://github.com/neromtoobad/swarm-budget/tree/main/evaluator |
| Network | Telegraph testnet evaluation pool (devnode). Upload address `0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E` |
| GitHub user that starred the bounties repo | neromtoobad |

## 2. Short demo

**[you]** 2–5 minute video link. What it shows: the Kerman, Iran answer and why a format check passes it; one row of each kind; `node check/compare.mjs` printing the three-judge table; the upload reply and the pool read-back on the node.

## 3. Short public summary

> 570 question, better-answer, worse-answer rows for three weather intents on Telegraph, all admitted by the node. Each worse answer is well formed and plausible, and wrong in a way a buyer cares about: it is for a bigger town with the same name, it covers the wrong hours or day, its grade contradicts its own numbers, a number is missing or impossible, or it is about another hazard.
>
> Both answers in every row are real public data for real places. Five rows are answers our own app paid for on testnet, kept as the node returned them.
>
> A check that only asks "are the fields there and in range?" wins 64% of the pairs, and exactly half of the wrong-place, wrong-time and contradiction pairs, which are seven rows in ten. Explicit published rules decide all of them.
>
> `WEATHER_FORECAST_GENERAL` had material from four contributors; an Evaluator adapter can only compete once there are five. This upload is the fifth. We registered no adapter and claim no canonical status or ranking change.

## 4. How to run it

Prerequisite: Node 20 or newer. No keys.

```bash
git clone https://github.com/neromtoobad/swarm-budget && cd swarm-budget/evaluator && node build/pairs.mjs --offline
```

Expected: three packs rebuilt from the frozen inputs, with the same sha256 as the files that were uploaded.

```bash
node check/compare.mjs
```

Expected: one table per pack, three judges per row kind.

A failure case to try, the real Kerman answer through the rule checker (prints score 0.667 and the two failed checks):

```bash
node -e 'import("./check/rules.mjs").then(async (m) => console.log(await m.checkStorm("Is there a storm risk in Kerman, California in the next 6 hours?", JSON.stringify({location:"Kerman, Kerman, Iran",risk_score:0.16,risk_level:"LOW",peak_gust_kmh:21,precipitation_mm:0,window:"2026-11-19T18:30"}))))'
```

Every claim, checked against the node:

```bash
cd .. && node tools/check-tracks.mjs
```

Costs: none. Uploading material has no fee or bond.

## 5. Evidence

| What | Where |
|---|---|
| The node's reply to each upload (220/220, 220/220, 130/130 accepted; 0 rejected; 0 duplicates) | [evaluator/results/upload-*.json](evaluator/results/) |
| Live read-back of our rows (all `admitted`, all `attested`) | `https://devnode.telegraphprotocol.com/api/evalpool/submissions/mine?submitter=0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E&intent_id=<INTENT>` |
| Baseline comparison: longer answer, well-formed only, rule checker, by row kind, all rows and held-out places | [evaluator/results/compare-2026-11-25.json](evaluator/results/compare-2026-11-25.json) |
| The adapter kit's data gate: PASS on all three packs | [evaluator/results/kit-data-gate.txt](evaluator/results/kit-data-gate.txt) |
| Quality discrimination on live miners (48 of 48, 44 of 48 and 5 of 48 right) | [miner/bench/results/place-trap-2026-11-25.json](miner/bench/results/place-trap-2026-11-25.json) |
| The five real paid answers and their signal records | [evaluator/data/real-refusals.json](evaluator/data/real-refusals.json) |

**Baseline.** `STORM_ALERT` and `WEATHER_FORECAST` have no adapter of their own; the node scores them with its generic fallback, which we cannot run. Our comparison is against two baselines we can run: the longer answer, and a well-formedness check. We make no claim about how the generic fallback scores these rows.

**What it enables.** For Missions 06 and 11: an app that acts on weather for a named place needs miners ranked on getting the place right. These rows put that question into both halves of the pool. The mission-specific test is `node evaluator/check/compare.mjs`.

**Disclosure.** The same wallet runs the Pinpoint Weather miner on these three intents and the Swarm Budget app. The rows reward naming the right place, which that miner does. The miner has no special handling for these questions. No row content needs to be kept confidential: the packs are public.

## 6. Showcase permission

**[you]** Your choice. Suggested: the README, the tables and the packs may be shared publicly.

## 7. Prior work and reuse

Written during the event (first commit 25 November 2026). The rule checker is the Swarm Budget guard (also written during the event) reworked for answer text. Data: Open-Meteo forecast and archive, GeoNames, USGS and NOAA SWPC feeds. The adapter kit's data gate comes from telegraphprotocol/telegraph-wasm-baseline. Built with Claude Code.
