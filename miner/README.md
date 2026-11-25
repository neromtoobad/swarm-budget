# Pinpoint Weather

**A Telegraph miner that sells storm risk, forecasts, the temperature now and past-day records, and always says which place its answer is for.**

- Live: https://pinpoint.nerom.site (try it on the page)
- Telegraph Hackathon Season II, Miners / Providers track
- Miner id `3672120`, slug `pinpoint-weather`, registration `6195` on the Telegraph Diamond, Ethereum Sepolia testnet
- Intents: `STORM_ALERT_GENERAL`, `WEATHER_FORECAST_GENERAL`, `WEATHER_FORECAST_VERIFY_GENERAL`, `WEATHER_CHECK_TEMPERATURE`
- Built by the [Swarm Budget](../README.md) team. Same wallet as the Swarm Budget app (`0x8482…A78E`).

## Why it exists

Swarm Budget is a fleet of farm machines in Kerman, California that buys answers on Telegraph before it moves. On 19 November 2026 it paid for a storm alert and got one for **Kerman, Iran**, 12,500 km away. The answer was paid for, well formed and confident. The public record is still on the node: [signal 0xbacdfad8…](https://devnode.telegraphprotocol.com/engine/v1/signal/0xbacdfad8d51bae03ad979085f22b8ec21bbac3e153e0ad66c2d1092cbb073a18).

The app's guard now refuses answers like that. This miner is the other half: supply that does not make the mistake.

## What it does differently

| Rule | Example |
|---|---|
| A region or country in the request is never dropped | `Paris, Texas` is Paris, Texas. If no such town is in that region, the request is refused. It never falls back to a namesake |
| Every answer names the place it is for | `"location": "Kerman, California, United States (36.7236, -120.0599)"`, plus a `place` block with region, country, coordinates and how the name was matched |
| A bare name goes to the largest place with that name, and says so | `Kerman` answers for Kerman, Iran, with `matched_on: "name only (largest place with this name)"` and Kerman, California listed under `also_matches` |
| A name shared by towns of similar size is refused | `Springfield` returns 422 `ambiguous_location` with the candidates |
| A country or a whole region is refused | `Georgia` returns 422 `place_too_broad` |
| A day that has not ended is refused, by that place's own clock | `/verify` for today in Tokyo returns 422 `day_not_finished` |
| Missing data is never zero | If a source has no gust forecast, the field is `null` and `limitations` says why |
| A refusal is an error reply | 4xx or 502, so Telegraph does not bill the buyer |

No language model writes any part of an answer.

## Try it

```bash
curl "https://pinpoint.nerom.site/storm-alert?location=Paris,%20Texas&window_hours=24"
```

```bash
curl "https://pinpoint.nerom.site/forecast?location=36.7236,-120.0599&window_hours=6"
```

```bash
curl "https://pinpoint.nerom.site/verify?location=Lisbon&date=2026-11-20"
```

```bash
curl "https://pinpoint.nerom.site/temperature?location=Karachi"
```

A failure case:

```bash
curl -i "https://pinpoint.nerom.site/storm-alert?location=Paris,%20Kansas"
```

That returns `404 place_not_found`, "No "Paris" was found in Kansas. Nothing was guessed.", with the places that do exist.

`/resolve?location=…` shows which place a name would resolve to without fetching weather. `/health` shows uptime, counts and latency since the last start.

Through Telegraph, like any buyer (needs a funded testnet wallet, about $0.04):

```bash
node --env-file=../.env scripts/paid-test.mjs --trap
```

## Measured, with the raw replies saved

### 1. Place handling against other live storm miners

`node bench/place-trap.mjs` asks each miner about 48 real towns that share a name with a bigger place (Paris, Texas; Cairo, Illinois; Hyderabad, Pakistan), 8 places that do not exist (Tokyo, France) and 5 coordinate pairs. Ground truth is frozen in [bench/place-trap-cases.json](bench/place-trap-cases.json) and comes from OpenStreetMap, not from the GeoNames data this miner resolves with.

Run on 25 November 2026 ([raw replies](bench/results/place-trap-2026-11-25.json)):

| Miner | Rank on the node for storm alerts that day | Namesake towns right | Answered for the wrong place | Made-up places refused | Coordinates right |
|---|---|---|---|---|---|
| **Pinpoint Weather** | new | **48 / 48** | 0 | **8 / 8** | 5 / 5 |
| Tempest Storm Intelligence | 12 | 48 / 48 | 0 | 8 / 8 | 5 / 5 |
| LiveCert | 3 | 48 / 48 | 0 | 1 / 8 | 5 / 5 |
| PREFLIGHT | 6 | 48 / 48 | 0 | 1 / 8 | 5 / 5 |
| SkyWire Sourced Storm Screening | unranked | 44 / 48 | 1 | 6 / 8 | 5 / 5 |
| TxLens | 1 | 5 / 48 | 42 | 2 / 8 | 5 / 5 |
| ChainSight | 2 | 5 / 48 | 43 | 0 / 8 | 5 / 5 |
| Amanat Weather Risk | unranked | 5 / 48 | 43 | 1 / 8 | 5 / 5 |

What this says, and what it does not:
- Two miners got everything right: this one and Tempest Storm Intelligence. On place handling they are level; Tempest serves storm alerts only.
- The two miners ranked first and second for storm alerts answered for the wrong place 42 and 43 times out of 48.
- Each miner was called on its own public endpoint, in the request shape its registered YAML documents. Nothing was paid. It measures the miner's own place handling, not what the node's request builder does before the call.
- We wrote the case list. It is short, public and frozen, so anyone can check a row or add cases.

### 2. Past-day records against weather stations

`node bench/record-accuracy.mjs` compares `/verify` with NOAA GHCN-Daily station records for 40 cities on five fixed days ([raw rows](bench/results/record-accuracy-2026-11-25.json)).

| | Result |
|---|---|
| City-days asked | 200 |
| City-days where a NOAA station had a record | 100 |
| Daily high, mean absolute error | 1.42 °C (81% within 2 °C, 95% within 3 °C) |
| Daily low, mean absolute error | 1.36 °C (77% within 2 °C, 92% within 3 °C) |
| Wet day or dry day (1 mm or more), same call as the station | 75% |
| High error when the answer's two sources agree (90 days) | 1.31 °C |
| High error when they disagree (10 days) | 2.43 °C |

The numbers are a reanalysis estimate for a grid cell, not a station reading, and every answer says so. The last two rows are why each answer carries `sources_agree_on_high`: when it is false, trust the value less. Rain is the weak spot: a grid cell and a rain gauge disagree on one day in four.

### 3. Speed

`node bench/latency.mjs`, 160 requests, no failures ([raw](bench/results/latency-2026-11-25.json)). Server-side time is what the miner itself took, including its calls to the weather sources.

| Endpoint | Server-side p50 | Server-side p95 |
|---|---|---|
| `/storm-alert` | 202 ms | 813 ms |
| `/forecast` | 24 ms | 29 ms |
| `/verify` | 252 ms | 345 ms |
| `/temperature` | 165 ms | 496 ms |

### 4. Bought through the network

Six purchases from this miner through the Telegraph node on 25 November 2026, paid from escrow, each checked by the Swarm Budget guard: [evidence/paid-test-2026-11-25T1343.json](evidence/paid-test-2026-11-25T1343.json). All six were for the right place, including `Paris, Texas` and `Cairo, Illinois`.

This is our own wallet buying from our own miner. It proves the registration works end to end. It is not outside demand and is not claimed as such.

That run also caught a fault in this miner: a Freeze Warning had graded Paris, Texas HIGH with 38 km/h gusts and no rain. Only storm alerts raise the grade now (`isStormAlert` in [src/weather.mjs](src/weather.mjs), with a test).

## How the storm grade is worked out

| What is measured | LOW | MODERATE | HIGH | SEVERE |
|---|---|---|---|---|
| Peak wind gust, km/h | under 40 | 40 to 62 | 62 to 89 | 89 or more |
| Wettest 24 hours, mm | under 10 | 10 to 30 | 30 to 80 | 80 or more |
| Wettest single hour, mm | under 7.6 | 7.6 to 20 | 20 to 50 | 50 or more |
| Snowfall in 24 hours, cm | under 5 | 5 to 15 | 15 to 40 | 40 or more |
| Thunderstorm forecast | | yes | with hail | |
| Official US storm alert | Minor | Moderate | Severe | Extreme |

The grade is the worst of these. `risk_score` moves in a straight line inside each band (0 to 0.25 LOW, up to 1 SEVERE). Every factor is returned under `drivers`, so a buyer can recompute the grade. It is a rule, not a probability and not an official warning. Code: [src/risk.mjs](src/risk.mjs).

## Where the numbers come from

| What | Source | Notes |
|---|---|---|
| Forecasts | Open-Meteo, three models side by side (best match, NOAA GFS, DWD ICON) | `models` shows each one; `model_agreement` is 1 minus the spread of their peak gusts |
| Official alerts | US National Weather Service | United States only. Elsewhere `official_alerts` is `null` and `limitations` says so |
| Past days | Open-Meteo archive (ERA5 and ECMWF IFS) | NASA POWER as a second record, with the difference |
| Temperature now | Open-Meteo current conditions | MET Norway as a second source, with the difference |
| Place names | GeoNames through the Open-Meteo geocoder | OpenStreetMap Nominatim if the town is missing, and only when its result still matches every qualifier |

Every answer lists its sources as URLs.

## Claims and where to check them

| Claim | Check |
|---|---|
| A qualifier is never dropped | `choose()` in [src/places.mjs](src/places.mjs); tests "a region is never dropped" and "a region with no such town is refused" |
| Similar-size namesakes are refused | test "towns of similar size with one name are refused with the candidates" |
| `Trinidad, CO` is Colorado, not Colombia | test "Town, CO means Colorado" |
| The place is read from a whole question | `placeFromQuestion()`; 30 worded questions in [test/places.test.mjs](test/places.test.mjs) |
| Missing gusts never score zero | test "no data is not a calm day" |
| Only storm alerts raise the grade | test "only storm alerts raise a storm grade" |
| The window is exact | `hourly()` in [src/weather.mjs](src/weather.mjs): asks for one extra hour and drops the first, because Open-Meteo stamps rain and gusts on the end of the hour |
| Registered and active | `curl -s https://devnode.telegraphprotocol.com/api/miners/6195`. Registration tx [0xe9f906b9…](https://sepolia.etherscan.io/tx/0xe9f906b95a4fa4b8406e1bc2f6553c293b75351aba11b1fba7342cdf9d6648d6) |
| The node maps requests in code | `curl -s https://devnode.telegraphprotocol.com/engine/v1/intents/STORM_ALERT_GENERAL/miners` shows `"mapping": "code"` for `pinpoint-weather`: the buyer's place string is passed through as written |

`npm test` runs 26 tests offline, on recorded geocoder and forecast data.

## Run it yourself

Needs Node 20 or newer. No keys, no database, no dependencies.

```bash
cd miner && npm test
```

```bash
cd miner && npm start
```

It listens on port 8787 (or `PORT`). Then:

```bash
BASE=http://127.0.0.1:8787 node bench/place-trap.mjs pinpoint
```

To register your own copy: change `id`, `slug` and `base_url` in [pinpoint-weather.yaml](pinpoint-weather.yaml), host the file at a fixed URL, then run [scripts/register.mjs](scripts/register.mjs). It checks before it spends: the hosted file must match the local one, every intent must be canonical on-chain, and the call is simulated first. The bond is 1.30 test USDC for four intents and comes back on deregistration.

## Limits

- **Testnet.** Registered on Ethereum Sepolia. Nothing here has run on a production network.
- **Free-tier sources.** It runs on Open-Meteo's free allowance, which is for non-commercial use and about 10,000 calls a day. The YAML declares about 3,000 uncached answers a day. A commercial deployment needs Open-Meteo's paid plan or its self-hosted version; only the base URL changes.
- **Official alerts are US only.**
- **Grid cells, not stations.** See the accuracy table above.
- **A bare name is a guess.** `Kerman` goes to the largest Kerman. The answer says so and lists the others, but a buyer who means the small one must add the region.
- **In-memory counters.** `/health` resets when the process restarts.
- **Ranking.** The miner was registered on 25 November 2026 and is in its 7-day grace period. It has no finalized rank yet, and none is claimed.
- **Demand.** The only purchases so far are our own integration tests.
