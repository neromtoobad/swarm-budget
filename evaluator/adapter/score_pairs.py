"""Score held-out pairs with a trained run and break the result down by the kind of worse answer.

  cd ref/telegraph-wasm-baseline
  .venv/bin/python ../../evaluator/adapter/score_pairs.py runs/WEATHER_FORECAST \
      ../../evaluator/adapter/heldout.jsonl ../../evaluator/adapter/results/heldout-full.json

A pair is won when the better answer gets the strictly higher score: the rule the node uses.
"""
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, os.getcwd())
import torch  # noqa: E402
from peft import PeftModel  # noqa: E402
from transformers import AutoModelForSequenceClassification, AutoTokenizer  # noqa: E402
from float_runtime.train_adapter import DEFAULT_BASE, render  # noqa: E402

run, data, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
rows = [json.loads(l) for l in data.read_text().splitlines() if l.strip()]
meta_path = data.with_suffix("").with_suffix(".meta.jsonl") if data.name.endswith(".jsonl") else None
meta = [json.loads(l) for l in meta_path.read_text().splitlines() if l.strip()] if meta_path and meta_path.exists() else [{} for _ in rows]

device = torch.device("mps" if torch.backends.mps.is_available() and os.environ.get("SCORER_DEVICE", "mps") == "mps" else "cpu")
tok = AutoTokenizer.from_pretrained(DEFAULT_BASE)
base = AutoModelForSequenceClassification.from_pretrained(DEFAULT_BASE, num_labels=1, torch_dtype=torch.float32, attn_implementation="eager")
base.config.pad_token_id = tok.pad_token_id
model = PeftModel.from_pretrained(base, str(run / "adapter")).to(device).eval()


def score(texts):
    outs = []
    with torch.no_grad():
        for i in range(0, len(texts), 8):
            enc = tok(texts[i:i + 8], truncation=True, max_length=512, padding=True, return_tensors="pt").to(device)
            outs += model(**enc).logits.squeeze(-1).float().cpu().tolist()
    return outs


good = score([render(r["prompt"], r["chosen"]) for r in rows])
bad = score([render(r["prompt"], r["rejected"]) for r in rows])
by = defaultdict(lambda: [0, 0])
detail = []
for r, m, g, b in zip(rows, meta, good, bad):
    kind = m.get("kind", "all")
    won = g > b
    for k in (kind, "all"):
        by[k][0] += int(won)
        by[k][1] += 1
    detail.append({"line": m.get("line"), "kind": kind, "from": m.get("from"), "won": won, "better": round(g, 4), "worse": round(b, 4)})
longer = sum(1 for r in rows if len(r["chosen"]) > len(r["rejected"])) / len(rows)
summary = {k: {"pairs": n, "won": w, "win_rate": round(w / n, 4)} for k, (w, n) in sorted(by.items())}
report = {"run": str(run), "data": str(data), "pairs": len(rows), "longer_answer_baseline": round(max(longer, 1 - longer), 4), "by_kind": summary, "rows": detail}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=1))
for k, v in summary.items():
    print(f"{k:16s} {v['won']:4d}/{v['pairs']:<4d} {v['win_rate']:.3f}")
