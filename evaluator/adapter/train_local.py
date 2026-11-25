"""Train the scorer with the Telegraph adapter kit on an Apple-silicon Mac.

The kit's trainer picks CUDA or the CPU. On a Mac the GPU is reached through MPS, so this wrapper
swaps in a device picker that uses it, then hands everything else to the kit unchanged: the same
data gate, the same loss, the same evaluation gate, the same files written.

  cd ref/telegraph-wasm-baseline
  PYTORCH_ENABLE_MPS_FALLBACK=1 .venv/bin/python ../../evaluator/adapter/train_local.py \
      --intent WEATHER_FORECAST --data ../../evaluator/adapter/train.jsonl \
      --val-data ../../evaluator/adapter/heldout.jsonl --out runs/WEATHER_FORECAST

Set SCORER_DEVICE=cpu to train on the CPU instead.
"""
import os
import sys

sys.path.insert(0, os.getcwd())
import torch  # noqa: E402
from float_runtime import train_adapter as kit  # noqa: E402


def pick_device():
    want = os.environ.get("SCORER_DEVICE", "mps")
    if want == "mps" and torch.backends.mps.is_available():
        kit.log.info("device: mps (Apple GPU), fp32")
        return torch.device("mps"), torch.float32
    kit.log.warning("training on the CPU in fp32")
    return torch.device("cpu"), torch.float32


kit.pick_device = pick_device
if __name__ == "__main__":
    sys.exit(kit.main())
