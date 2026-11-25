# A scorer for weather forecasts

**An Evaluator adapter for the `WEATHER_FORECAST` family: a small trained model that reads a question and a miner's answer and scores the answer. It was trained on answer pairs where the worse answer is well formed and wrong, most often about the wrong town.**

- Package: [WEATHER_FORECAST.safetensors](WEATHER_FORECAST.safetensors), 6.8 MB, keccak256 `0x2f4ed801608343912eb2fcbf4358916753c68f44e2226973be34fc1db6be3354`
- Registered on Telegraph testnet (Ethereum Sepolia) on 25 November 2026: registration `244`, tx [0xc810c7ec…](https://sepolia.etherscan.io/tx/0xc810c7ec97dc7c96b69157aa66dda81f4ffa16bfaa293a99cdc1a77c3e57e524)
- **Status: rejected.** On 25 November 2026 at 18:17 UTC the node tested it on a hidden sample of 30 pairs (seed from epoch 55) and it picked the better answer in 43.3% of them, below the 70% floor. Every status the node reported is in [results/registration-244.jsonl](results/registration-244.jsonl); the live one is `curl -s https://devnode.telegraphprotocol.com/api/wasm/244`.
- **What that sample was drawn from.** The test used pool version `702fe078…`, published 22 November, before our 220 forecast pairs were in it. So all 30 test pairs came from other contributors' material, which we cannot see. The scorer's 96.8% below is on pairs built the way ours are; it did not carry over to other contributors' idea of a better answer. The pool version that includes our pairs (`eec94823…`, 506 rows from five contributors) went live at 17:24 UTC the same day.
- Before this, `WEATHER_FORECAST` had no scorer of its own. The node scored it with its generic fallback.

## What it does

The node shows a scorer one text: the question, then one answer. The scorer returns a number. When miners are ranked, the answer with the higher number wins.

This scorer learned from 1,446 pairs, each a question with a better and a worse answer. In about a third of them the worse answer is a real forecast for a different place: a bigger town with the same name, or an unrelated city. In the rest it covers the wrong hours, is days old, contradicts its own numbers, leaves a number out, holds an impossible value, gives only the temperature right now, is vague, or is a refusal.

## How well it works

Measured on 248 pairs about towns the scorer never saw in training ([heldout-test.jsonl](heldout-test.jsonl)). A pair is won when the better answer gets the strictly higher score, which is the node's rule.

| Kind of worse answer | Pairs | Longer answer wins | Well-formed only | Rule checker | **This scorer** |
|---|---|---|---|---|---|
| All | 248 | 49.2% | 16.9% | 97.2% | **96.8%** |
| Wrong town with the same name | 131 | 48.1% | 0% | 100% | **96.9%** |
| An unrelated city | 26 | 53.8% | 0% | 100% | **100%** |
| Wrong hours | 17 | 41.2% | 0% | 100% | **88.2%** |
| Contradicts its own numbers | 21 | 19.0% | 0% | 100% | **90.5%** |
| A number is missing | 18 | 77.8% | 88.9% | 88.9% | **100%** |
| An impossible value | 12 | 8.3% | 91.7% | 91.7% | **100%** |
| Only the temperature now | 11 | 100% | 81.8% | 100% | **100%** |
| A forecast for days ago | 4 | 0% | 0% | 0% | **100%** |
| Vague, or a refusal | 8 | 100% | 75% | 100% | **100%** |

How to read the columns:
- **Longer answer wins** and **well-formed only** are the two shortcuts a lazy scorer falls into. Well-formed only checks that the fields are there and in range. It scores 0% on wrong-town pairs because both answers are perfectly formed, and a tie is not a win.
- **Rule checker** is [../check/rules.mjs](../check/rules.mjs): explicit rules with a place lookup. It cannot run inside the node, which gives a scorer no network access. It also has no way to know a forecast is days old.
- **This scorer** has no place lookup and no rules. It learned from examples to compare the place and the hours in the answer with the ones in the question.

Numbers: [results/scorer-full-heldout-test.json](results/scorer-full-heldout-test.json), [results/baselines-heldout-test.json](results/baselines-heldout-test.json), [results/train-full-result.json](results/train-full-result.json).

### Does the wrong-town material matter?

Yes. The same model, trained the same way but with every wrong-place pair taken out of its training set ([train-without-place.jsonl](train-without-place.jsonl), 971 pairs), then tested on the same 248 pairs:

| | Trained without wrong-place pairs | This scorer |
|---|---|---|
| Wrong town with the same name (131) | 65.6% | **96.9%** |
| An unrelated city (26) | 69.2% | **100%** |
| All 248 | 75.0% | **96.8%** |

The full table and its limits are in [../README.md](../README.md#does-the-material-change-what-a-scorer-learns). Numbers: [results/scorer-without-place-heldout-test.json](results/scorer-without-place-heldout-test.json), [results/train-without-place-result.json](results/train-without-place-result.json).

## What these numbers do not show

- **They are on our own kind of pairs.** The held-out towns are new to the scorer, but the pairs were built by the same generator as its training set. The node's competition uses a hidden sample drawn evenly from every contributor's material, most of which we have never seen. A scorer can do well here and still miss the node's 70% bar there.
- **The validation half picked the stopping point.** The 289 validation pairs chose which training pass to keep; the 248 test pairs above were used once, at the end.
- **Better answers are forecasts from 25 November 2026.** The scorer may have learned that date. It has not been tested on answers from other days.
- **One run.** No repeats with other random seeds.

## How it was made

Everything runs on a laptop except the last step.

| Step | Command | What it produces |
|---|---|---|
| 1. Training pairs | `node adapter/build-training.mjs` | [train.jsonl](train.jsonl) (1,446), [heldout-val.jsonl](heldout-val.jsonl) (289), [heldout-test.jsonl](heldout-test.jsonl) (248). Towns are split, not rows |
| 2. Train | [train_local.py](train_local.py), a wrapper around the adapter kit's trainer that lets it use an Apple GPU | A LoRA adapter (rank 8) and reward head on ModernBERT-base. 4 passes, about 50 minutes on an M1 Pro |
| 3. Export | the kit's `export_adapter` | The safetensors package |
| 4. Check | the kit's package check, run through [checkjudgment/main.go](checkjudgment/main.go) | The keccak256, and a pass from the node's Stage 1 parser |
| 5. Serve | [executor/Dockerfile](executor/Dockerfile): the kit's reference executor with the network's Foundation Model | The public endpoint a validator calls |
| 6. Register | `node adapter/register.mjs …` | The on-chain registration, after checking the hosted file and the executor |
| 7. Follow | `node adapter/watch.mjs 244` | The status log |

The kit is [telegraphprotocol/telegraph-wasm-baseline](https://github.com/telegraphprotocol/telegraph-wasm-baseline) at commit `1ed063e`. The training set passes the kit's data gate (unique worse answers 99.5%, "longer answer" 55.1%, word-count probe 61.4%).

Three things that were not obvious and cost time:
- **The tokenizer file.** Hugging Face's current `tokenizer.json` for ModernBERT-base is not byte-identical to the one the network pins, so the kit's exporter refuses a run trained on it. The vocabulary is the same; the file differs in padding settings and in how merges are written. Training on the network's own pinned file (from the foundation release) fixes it.
- **The class.** The kit's offline catalog does not list `WEATHER_FORECAST`, so `adapterbuild lora` refuses to guess its class. The live node says judgment. `checkjudgment` tells the kit's checker what the node says and runs the same check.
- **Epochs are three hours on testnet**, not one. A registration is checked after the next rollover.

## Cost

Training cost nothing. The executor needs about 4.2 GB of memory, which is why it is not on the laptop: it ran on Railway (6 GB limit) from 14:22 UTC on 25 November until the registration was decided. At Railway's published rate of $10 per GB of memory per month that is about 6 cents an hour. The bond is 5 test USDC, returned on deregistration.

## Disclosure

The same wallet runs the Pinpoint Weather miner on `WEATHER_FORECAST_GENERAL` and uploaded evaluation material for it. A scorer that rewards naming the right place favours any miner that does so, and ours does. The package, the training pairs and the code are all public here so that can be checked. Nothing in the scorer refers to any miner.
