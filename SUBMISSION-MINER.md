# Pinpoint Weather — Telegraph Hackathon Season II submission (Miners / Providers)

What the submission form asks for (rules, section 08), in order. Lines marked **[you]** are yours to fill. This is a separate entry from the Swarm Budget app ([SUBMISSION.md](SUBMISSION.md)) and from the evaluation packs ([SUBMISSION-EVALUATOR.md](SUBMISSION-EVALUATOR.md)), by the same team.

## 1. Project details

| Field | Answer |
|---|---|
| Team / contact | **[you]** same as the Swarm Budget entry |
| Track | Miners / Providers |
| Project name | Pinpoint Weather |
| Miner–Intent pairs | Miner `3672120` (`pinpoint-weather`, registration `6195`) on `STORM_ALERT_GENERAL`, `WEATHER_FORECAST_GENERAL`, `WEATHER_FORECAST_VERIFY_GENERAL`, `WEATHER_CHECK_TEMPERATURE` |
| Missions these intents serve | 06 Resources & Agriculture and 11 Autonomous Systems (the missions Swarm Budget completes). `WEATHER_FORECAST_VERIFY_GENERAL` is also in the starting map of 05 Conflict Intelligence, 08 Commodities and 12 Mining & Power |
| Working link | https://pinpoint.nerom.site (no wallet or sign-in needed) |
| Repository | https://github.com/neromtoobad/swarm-budget/tree/main/miner |
| Network | Telegraph testnet, Ethereum Sepolia. Registration tx [0xe9f906b9…](https://sepolia.etherscan.io/tx/0xe9f906b95a4fa4b8406e1bc2f6553c293b75351aba11b1fba7342cdf9d6648d6) |
| GitHub user that starred the bounties repo | neromtoobad |

## 2. Short demo

**[you]** 2–5 minute video link. What it shows: the Kerman, Iran answer the fleet was sold; the same question to Pinpoint; `Paris, Texas`, `Paris, Kansas` and `Springfield` on the live page; the benchmark table; one paid purchase through the node with its signal record.

## 3. Short public summary

> Pinpoint Weather is a Telegraph miner for storm risk, forecasts, the temperature now and past-day records. Every answer says exactly which place it is for, with region, country and coordinates. A region in the request is never dropped: "Paris, Texas" can only be Paris, Texas, and if there is no such town the request is refused instead of answered for a namesake.
>
> It exists because our own app, Swarm Budget, paid for a storm alert for Kerman, California and got one for Kerman, Iran. We then asked eight live storm miners about 48 real towns that share a name with a bigger place. The two ranked first and second answered for the wrong town 42 and 43 times. Pinpoint and one other miner got all 48 right, refused all 8 made-up places and handled all 5 coordinate requests.
>
> It runs on Telegraph testnet. Its only purchases so far are our own integration tests, and it has no finalized rank yet. The benchmark, its frozen cases and every raw reply are in the repository, so anyone can rerun it or add cases.

Growth links are the same as the Swarm Budget entry, plus: **[you]** the X post that introduces the miner (planned in X-POSTS.md).

## 4. How to run it

Prerequisite: Node 20 or newer. No keys.

```bash
git clone https://github.com/neromtoobad/swarm-budget && cd swarm-budget/miner && npm test
```

Sample request and expected result:

```bash
curl "https://pinpoint.nerom.site/storm-alert?location=Paris,%20Texas&window_hours=24"
```

Returns `"location": "Paris, Texas, United States (33.6609, -95.5555)"` with `risk_score`, `risk_level`, `peak_gust_kmh`, `precipitation_mm` and `window`.

A failure case:

```bash
curl -i "https://pinpoint.nerom.site/storm-alert?location=Paris,%20Kansas"
```

Returns `404 place_not_found`. Nothing is billed for an error reply.

Every claim, checked against the live miner and the node:

```bash
node tools/check-tracks.mjs
```

Costs: the floor price, $0.01 a request. Known limits are listed in [miner/README.md](miner/README.md#limits).

## 5. Evidence

| What | Where |
|---|---|
| Registration and status | `curl -s https://devnode.telegraphprotocol.com/api/miners/6195` (active) |
| Routable on four intents, requests mapped in code | `curl -s https://devnode.telegraphprotocol.com/engine/v1/intents/STORM_ALERT_GENERAL/miners` |
| Place handling vs seven other live miners | [miner/bench/results/place-trap-2026-11-25.json](miner/bench/results/place-trap-2026-11-25.json) |
| Past-day accuracy vs NOAA stations (100 city-days: high within 1.42 °C on average) | [miner/bench/results/record-accuracy-2026-11-25.json](miner/bench/results/record-accuracy-2026-11-25.json) |
| Latency (server-side p95 under 1 second on every endpoint) | [miner/bench/results/latency-2026-11-25.json](miner/bench/results/latency-2026-11-25.json) |
| Six purchases through the node, each with a signal link | [miner/evidence/paid-test-2026-11-25T1343.json](miner/evidence/paid-test-2026-11-25T1343.json) |
| 26 tests | `cd miner && npm test` |

**Consumption by H2 mission apps.** The consuming app so far is Swarm Budget (Missions 11 and 06), which is ours. Those six purchases went through the node's direct-miner path as an integration test. We do not claim ranked-route use, independent app groups, repeat demand or earnings.

**What it enables.** A mission app that acts on weather for a named small town (a farm, a depot, a site) can now buy an answer that states its place and refuses when it can't. The mission-specific test is `node miner/bench/place-trap.mjs`.

## 6. Showcase permission

**[you]** Your choice. Suggested: the page, the benchmark table and the README may be shared publicly.

## 7. Prior work and reuse

Written during the event (first commit 25 November 2026). It imports nothing from earlier projects. Data comes from Open-Meteo, the US National Weather Service, NASA POWER, MET Norway, GeoNames and OpenStreetMap, each named in every answer. Built with Claude Code.
