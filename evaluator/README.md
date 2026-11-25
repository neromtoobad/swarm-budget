# Place-trap evaluation packs

**570 question, better-answer, worse-answer rows for three weather intents, built so that a scorer has to notice the mistakes that are paid for and still wrong: the wrong town, the wrong hours, a grade that contradicts its own numbers.**

- Telegraph Hackathon Season II, Evaluators track (evaluation material)
- Uploaded to the Telegraph evaluation pool on 25 November 2026 from `0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E`
- A scorer trained on this kind of material is registered for the `WEATHER_FORECAST` family (registration 244): [adapter/](adapter/README.md)
- Built by the [Swarm Budget](../README.md) team

| Intent | Rows sent | Admitted by the node | Contributors before → after | Read back |
|---|---|---|---|---|
| `STORM_ALERT_GENERAL` | 220 | 220 | 3 → 4 | [our rows](https://devnode.telegraphprotocol.com/api/evalpool/submissions/mine?submitter=0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E&intent_id=STORM_ALERT_GENERAL) |
| `WEATHER_FORECAST_GENERAL` | 220 | 220 | 4 → 5 | [our rows](https://devnode.telegraphprotocol.com/api/evalpool/submissions/mine?submitter=0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E&intent_id=WEATHER_FORECAST_GENERAL) |
| `WEATHER_FORECAST_VERIFY_GENERAL` | 130 | 130 | 7 → 8 | [our rows](https://devnode.telegraphprotocol.com/api/evalpool/submissions/mine?submitter=0x8482E592d6B28d3F5B713CC4576D6Ce216B2A78E&intent_id=WEATHER_FORECAST_VERIFY_GENERAL) |

No row was rejected or marked a duplicate. Every row's provenance class is `attested`. The node's replies are saved in [results/](results/).

## Why these rows

Swarm Budget's machines buy weather on Telegraph. On 19 November 2026 one paid for a storm alert for Kerman, California and received one for Kerman, Iran: [the node's record](https://devnode.telegraphprotocol.com/engine/v1/signal/0xbacdfad8d51bae03ad979085f22b8ec21bbac3e153e0ad66c2d1092cbb073a18). That answer has every field, every value is in range, and it is confident. A check that only asks "is the answer well formed?" passes it.

It is also common. On 25 November we asked eight live storm miners about 48 real towns that share a name with a bigger place. The two ranked first and second for `STORM_ALERT_GENERAL` answered for the wrong town 42 and 43 times out of 48 ([benchmark](../miner/README.md#1-place-handling-against-other-live-storm-miners)).

Two things follow from how the pool works:
- Rows in the **testing half** decide which Evaluator adapter becomes canonical. An adapter that cannot tell Paris, Texas from Paris, France now loses pairs.
- Rows in the **ranking half** are the questions put to every miner each epoch. Those miners are now asked about Paris, Texas.

What it unblocks: neither `STORM_ALERT` nor `WEATHER_FORECAST` has an Evaluator adapter of its own; both are scored by the generic fallback. An adapter can only compete once the pool holds material from five contributors. `WEATHER_FORECAST_GENERAL` had four. This upload is the fifth. (It counts once the node freezes the next snapshot; until then the status endpoint shows 5 submitters, 4 eligible.)

## What is in a row

Both answers are filled with real public data for real places. One thing differs.

| Kind of worse answer | What is wrong with it | Storm | Forecast | Past day |
|---|---|---|---|---|
| `wrong_place` | It is for a bigger town with the same name, somewhere else. Real data for that other town | 97 | 97 | 56 |
| `wrong_window` / `wrong_date` | It covers different hours, or another day, than was asked | 31 | 31 | 28 |
| `contradiction` | The grade or the words disagree with the answer's own numbers | 30 | 30 | 6 |
| `missing` | A number the question asked for is not there | 22 | 22 | 14 |
| `out_of_range` | A value that cannot be true: Kelvin in a Celsius field, a 0–1 score given as 37 | 20 | 20 | 14 |
| `off_topic` | Earthquakes or space weather, sent as a storm answer (real USGS and NOAA feeds; miners registered on this intent serve exactly these) | 20 | | |
| `not_a_forecast` / `not_a_record` | The temperature right now for a question about the hours ahead; a forecast for a question about what was recorded | | 20 | 12 |

Example (`STORM_ALERT_GENERAL`, `wrong_place`, line 25 of the pack):

```text
prompt    Report storm risk score, risk level, peak gust and precipitation for Burlington, Iowa covering the next 5 days.
chosen    {"location":"Burlington, Iowa, United States (40.8075, -91.1129)","risk_score":0.34,"risk_level":"MODERATE","peak_gust_kmh":48.2,"precipitation_mm":10.2,"window":"2026-11-25T13:00Z to 2026-11-30T13:00Z (120 hours)"}
rejected  {"location":"Burlington, Ontario, Canada (43.3862, -79.8371)","risk_score":0.53,"risk_level":"HIGH","peak_gust_kmh":64.4,"precipitation_mm":46,"window":"2026-11-25T13:00Z to 2026-11-30T13:00Z (120 hours)"}
```

Both are real forecasts. The worse one is for a town 973 km away.

Details that matter:
- **Five rows are not generated.** They are answers the fleet paid for on testnet, kept as the node returned them, each with its signal link ([data/real-refusals.json](data/real-refusals.json)). They open the storm and forecast packs.
- **One wrong-place row in five is reversed**: the question asks for the big town by its full name and the worse answer is the small one. Otherwise "the smaller place is always right" would be a shortcut.
- **Both answers of a pair use one wording.** About half use the node's own processed-answer shape (the JSON above); the rest use the ways miners phrase the same fields.
- **Every question is checked for ambiguity before it goes in.** An ordinary place lookup of its wording must land on the town it is about. "Ramnagar, India" was dropped: there are several.
- **Questions are worded 11 to 16 ways per intent**, with optional opening and closing lines. The node's near-duplicate filter kept all of them.
- **Each row carries a source URL**: the Open-Meteo call for the place asked, or the Telegraph signal for the real rows.

## Measured

### The packs pass the adapter kit's own data gate

`python -m float_runtime.train_adapter --check-data` from [telegraph-wasm-baseline](https://github.com/telegraphprotocol/telegraph-wasm-baseline). It refuses data a shortcut can solve. Output saved in [results/kit-data-gate.txt](results/kit-data-gate.txt).

| Pack | Gate | Unique worse answers | "Longer answer wins" | Word-count probe, question hidden |
|---|---|---|---|---|
| Storm | PASS | 100% | 56.1% | 61.5% |
| Forecast | PASS | 100% | 56.6% | 54.2% |
| Past day | PASS | 100% | 63.1% | 61.6% |

50% means no tell; the gate's limits are 65%.

### A format check cannot solve them; explicit rules can

`node check/compare.mjs` scores every pair with three judges. A judge wins a pair when it scores the better answer strictly higher, the rule the node uses; a tie counts as half. Full table in [results/compare-2026-11-25.json](results/compare-2026-11-25.json).

| Judge | Storm (220) | Forecast (220) | Past day (130) |
|---|---|---|---|
| The longer answer is better | 43.9% | 56.6% | 36.9% |
| Well-formed only: fields present and in range | 64.1% | 64.1% | 63.5% |
| Rule checker ([check/rules.mjs](check/rules.mjs)) | 100% | 100% | 100% |

The middle row is the point. A well-formedness check wins every `missing` and `out_of_range` pair and scores exactly 50% (all ties) on `wrong_place`, `wrong_window`, `wrong_date` and `contradiction`: about seven rows in ten. Those are the rows this pack adds.

Read the last row for what it is. The rule checker and the packs were written together, and where they disagreed we fixed whichever was wrong (a rule that graded a day of concentrated rain too gently; questions that were themselves ambiguous). So 100% shows the pairs are decidable by published, explicit rules. It is not a held-out score for a learned scorer. That test is the node's: an Evaluator adapter competing on the hidden half of the pool.

### It separates live miners

The same trap, asked of eight live miners' own endpoints, splits them into three groups: 48 of 48 right, 44 of 48, and 5 of 48 ([table and raw replies](../miner/README.md#1-place-handling-against-other-live-storm-miners)).

## The rule checker

[check/rules.mjs](check/rules.mjs) reads a question and an answer in any of the common shapes (JSON, `key: value` lines, a sentence) and checks six things: place, time, completeness, range, consistency, topic. It is the Swarm Budget guard rewritten to work on answer text, which is what an evaluator sees. It needs no key and no model.

```bash
cd evaluator && node -e 'import("./check/rules.mjs").then(async (m) => console.log(await m.checkStorm("Is there a storm risk in Kerman, California in the next 6 hours?", JSON.stringify({location:"Kerman, Kerman, Iran",risk_score:0.16,risk_level:"LOW",peak_gust_kmh:21,precipitation_mm:0,window:"2026-11-19T18:30"}))))'
```

That prints a score of 0.667 with two failures: the place is 12,558 km from the one asked, and no window is stated.

## Rebuild it

Needs Node 20 or newer. No keys.

```bash
cd evaluator && node build/pairs.mjs --offline
```

That rebuilds the three packs from the frozen inputs in [data/](data/): the namesake list, the five real answers, and a snapshot of every weather call (taken 25 November 2026, 13:00 UTC). The rebuilt files have the same sha256 as the ones uploaded (see `body_sha256` in [results/](results/)). Without `--offline` it fetches anything missing.

```bash
cd evaluator && node check/compare.mjs
```

| File | What it does |
|---|---|
| [build/namesakes.mjs](build/namesakes.mjs) | Finds real towns of 2,000 people or more that share a name with a bigger place at least 300 km away (GeoNames) |
| [build/real.mjs](build/real.mjs) | Turns the fleet's refused-then-rebought answers into rows |
| [build/pairs.mjs](build/pairs.mjs) | Builds the packs. Seeded, so it produces the same rows each time |
| [check/rules.mjs](check/rules.mjs), [check/compare.mjs](check/compare.mjs) | The rule checker and the three-judge comparison |
| [upload.mjs](upload.mjs) | Signs and uploads a pack, then reads the pool back |

## Disclosures and limits

- **The same wallet runs a miner on these three intents** ([Pinpoint Weather](../miner/README.md)) and the Swarm Budget app. The rows reward naming the right place, which that miner does. The miner has no special handling for these questions, and the pack is public here so anyone can check that.
- **One scorer is registered, for forecasts only** ([adapter/](adapter/README.md), registration 244). What the node decided is in [adapter/results/registration-244.jsonl](adapter/results/registration-244.jsonl); we claim only what that log shows. There is no scorer for storm alerts (that pool has four contributors, and the node needs five before it will compete one) and none for past-day records (that family already has a canonical scorer, which we did not challenge). We claim no ranking change and no paid use of the material.
- **Better answers are dated.** A storm or forecast answer was true for the hours after 13:00 UTC on 25 November 2026. What makes it the better answer (right place, right window, complete, consistent) does not go stale; its numbers do. Past-day rows use days between 20 August and 7 November 2026 and stay true.
- **Better answers are model data, not measurements.** They come from Open-Meteo forecasts and its reanalysis archive.
- **Generated wording.** Questions and answer sentences come from templates filled by code. No language model wrote them, but they are not human-written either. Five rows are real traffic.
- **What a scorer can learn from this is limited to what the text shows.** A wrong-place answer that echoes the right name while carrying another town's numbers is invisible to any text judge, and is not in the pack.
- **One team's view of quality.** The thresholds behind `contradiction` (the storm bands) are ours and are published in [../miner/src/risk.mjs](../miner/src/risk.mjs). The false grades sit at least two bands outside what the numbers allow, so a different reasonable banding still agrees.
