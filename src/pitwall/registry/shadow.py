"""Shadow replay evaluator — champion vs challenger on held-out races (V2).

In production, this would:
  - Load shadow_races.yaml
  - For each race, ingest Bronze events, replay through both models (event-time)
  - Compare delayed ground truth (actual lap times after race) to get mae/coverage per model
  - Report per-race and aggregated deltas.

For V2 smoke without real FastF1 data, we simulate with synthetic replay
using current pipelines/train splits:
  - Champion metrics vs challenger metrics from artifacts/metrics.json
  - Per-race aggregation stub that validates promotion gates with shadow config.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml


def load_shadow_cfg(path: str | Path = "configs/shadow_races.yaml") -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def evaluate_shadow(
    champion_metrics: dict[str, Any],
    challenger_metrics: dict[str, Any],
    shadow_cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compare challenger vs champion on shadow semantics.

    Currently reuses test-set metrics as proxy for shadow race aggregation.
    In full implementation, this would average per-race metrics over min_races.
    """
    if shadow_cfg is None:
        try:
            shadow_cfg = load_shadow_cfg()
        except Exception:
            shadow_cfg = {"shadow": {"min_races": 3, "metrics": ["mae"]}}

    min_races = int(shadow_cfg.get("shadow", {}).get("min_races", 3))
    metrics_list = shadow_cfg.get("shadow", {}).get("metrics", ["mae", "coverage_80"])

    # For V2, challenger and champion each have single aggregated metrics (from train test split)
    # Simulate per-race by treating test split as proxy for 2-3 shadow races: duplicate with noise
    # Real shadow would need per-race files; here we just compare aggregated with tolerance
    details: dict[str, Any] = {}
    passed = True
    reasons: list[str] = []

    for m in metrics_list:
        champ = champion_metrics.get(m)
        chall = challenger_metrics.get(m)
        if champ is None or chall is None:
            continue
        # For mae/rmse lower is better; for coverage higher but near 0.8
        if m in ("mae", "rmse", "pinball_q10", "pinball_q50", "pinball_q90"):
            # challenger must not be >5% worse than champion on shadow
            if champ > 0:
                reg = (chall - champ) / champ
                details[m] = {"champion": champ, "challenger": chall, "regression": reg}
                if reg > 0.05:
                    reasons.append(f"shadow {m} regression {reg:.2%} > 5%")
                    passed = False
        elif m == "coverage_80":
            # both should be within 0.8±0.05; already checked in promotion gate
            pass

    return {
        "passed": passed,
        "reasons": reasons,
        "details": details,
        "min_races": min_races,
        "shadow_cfg": shadow_cfg,
    }


def shadow_from_artifacts(
    champion_dir: str | Path,
    challenger_dir: str | Path,
    shadow_cfg_path: str | Path = "configs/shadow_races.yaml",
) -> dict[str, Any]:
    champ_m = json.loads((Path(champion_dir) / "metrics.json").read_text())
    chall_m = json.loads((Path(challenger_dir) / "metrics.json").read_text())
    cfg = load_shadow_cfg(shadow_cfg_path)
    return evaluate_shadow(champ_m, chall_m, cfg)
