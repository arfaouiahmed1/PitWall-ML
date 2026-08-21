"""Promotion gate evaluator — champion vs challenger (V2)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml


def load_promotion_cfg(path: str | Path = "configs/promotion.yaml") -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def evaluate_pace_promotion(
    champion: dict[str, Any],
    challenger: dict[str, Any],
    cfg: dict[str, Any] | None = None,
    cfg_path: str | Path = "configs/promotion.yaml",
) -> dict[str, Any]:
    """Check pace promotion gates.

    Gates:
      - primary_metric (mae) relative improvement >= min_relative_improvement
      - no subgroup regression > max_group_regression (if challenger provides per-group)
      - p95 latency < p95_ms_max (if provided)
      - coverage within nominal ± tolerance
    Returns: {passed: bool, reasons: list, details: dict}
    """
    if cfg is None:
        cfg = load_promotion_cfg(cfg_path)
    pace_cfg = cfg.get("pace", {})
    min_imp = float(pace_cfg.get("min_relative_improvement", 0.02))
    max_reg = float(pace_cfg.get("max_group_regression", 0.10))
    p95_max = float(pace_cfg.get("latency", {}).get("p95_ms_max", 100))
    nominal = float(pace_cfg.get("interval", {}).get("nominal_coverage", 0.8))
    tol = float(pace_cfg.get("interval", {}).get("coverage_tolerance", 0.05))

    reasons: list[str] = []
    details: dict[str, Any] = {}

    # primary metric mae
    champ_mae = float(champion.get("mae", champion.get("mae_seconds", 1e9)))
    chall_mae = float(challenger.get("mae", challenger.get("mae_seconds", 1e9)))
    if champ_mae <= 0:
        champ_mae = 1e-6
    rel_imp = (champ_mae - chall_mae) / champ_mae
    details["mae"] = {"champion": champ_mae, "challenger": chall_mae, "rel_improvement": rel_imp}
    if rel_imp < min_imp:
        reasons.append(f"MAE improvement {rel_imp:.2%} < required {min_imp:.2%}")

    # coverage gate
    chall_cov = challenger.get("coverage_80")
    if chall_cov is not None:
        cov_low = nominal - tol
        cov_high = nominal + tol
        details["coverage"] = {"challenger": chall_cov, "nominal": nominal, "tol": tol}
        if not (cov_low <= float(chall_cov) <= cov_high):
            reasons.append(f"Coverage {chall_cov:.3f} outside [{cov_low:.3f}, {cov_high:.3f}]")

    # p95 latency gate (if challenger reports it)
    p95 = challenger.get("p95_ms") or challenger.get("p95_latency_ms")
    if p95 is not None:
        details["p95_ms"] = float(p95)
        if float(p95) > p95_max:
            reasons.append(f"p95 {p95:.1f}ms > {p95_max}ms")

    # subgroup regression (optional): challenger may contain per_compound or per_circuit dicts
    # For V2, check per-group MAE if provided as dicts
    for group_key in ["per_compound", "per_circuit", "per_driver", "by_compound"]:
        champ_groups = champion.get(group_key)
        chall_groups = challenger.get(group_key)
        if isinstance(champ_groups, dict) and isinstance(chall_groups, dict):
            for g, champ_v in champ_groups.items():
                chall_v = chall_groups.get(g)
                if chall_v is None:
                    continue
                # for mae lower is better; regression if challenger worse by > max_reg
                if (
                    isinstance(champ_v, (int, float))
                    and isinstance(chall_v, (int, float))
                    and champ_v > 0
                ):
                    reg = (chall_v - champ_v) / champ_v
                    if reg > max_reg:
                        reasons.append(
                            f"Group {group_key}:{g} regression {reg:.2%} > {max_reg:.2%}"
                        )
                    details[f"{group_key}:{g}"] = {
                        "champion": champ_v,
                        "challenger": chall_v,
                        "reg": reg,
                    }

    # required checks presence (stub: ensure challenger reports them passed)
    required = pace_cfg.get("required_checks", [])
    for chk in required:
        # challenger may have `checks` dict with boolean
        checks = challenger.get("checks", {})
        if isinstance(checks, dict) and chk in checks and not checks[chk]:
            reasons.append(f"Required check failed: {chk}")

    passed = len(reasons) == 0
    return {"passed": passed, "reasons": reasons, "details": details}


def evaluate_tyre_promotion(
    champion: dict[str, Any], challenger: dict[str, Any], cfg: dict | None = None
) -> dict[str, Any]:
    if cfg is None:
        cfg = load_promotion_cfg()
    tyre_cfg = cfg.get("tyre", {})
    min_imp = float(tyre_cfg.get("min_relative_improvement", 0.02))
    champ = float(champion.get("tyre_mae", champion.get("mae", 1e9)))
    chall = float(challenger.get("tyre_mae", challenger.get("mae", 1e9)))
    rel_imp = (champ - chall) / champ if champ else 0
    passed = rel_imp >= min_imp
    return {
        "passed": passed,
        "reasons": [] if passed else [f"tyre MAE improvement {rel_imp:.2%} < {min_imp:.2%}"],
        "details": {"champion": champ, "challenger": chall, "rel_improvement": rel_imp},
    }


def evaluate_pit_promotion(
    champion: dict[str, Any], challenger: dict[str, Any], cfg: dict | None = None
) -> dict[str, Any]:
    if cfg is None:
        cfg = load_promotion_cfg()
    pit_cfg = cfg.get("pit_hazard", {})
    min_imp = float(pit_cfg.get("min_relative_improvement", 0.02))
    # lower brier/logloss is better; use logloss as proxy
    champ = float(champion.get("pit_logloss", champion.get("brier_score", 1e9)))
    chall = float(challenger.get("pit_logloss", challenger.get("brier_score", 1e9)))
    rel_imp = (champ - chall) / champ if champ else 0
    passed = rel_imp >= min_imp
    # also check AUC improvement (higher better)
    chall_auc = challenger.get("pit_auc")
    champ_auc = champion.get("pit_auc")
    reasons: list[str] = []
    if not passed:
        reasons.append(f"pit logloss improvement {rel_imp:.2%} < {min_imp:.2%}")
    if chall_auc is not None and champ_auc is not None and chall_auc < champ_auc:
        # allow small drop? For now require not worse
        if chall_auc + 0.02 < champ_auc:
            reasons.append(f"pit AUC regression {chall_auc:.3f} < {champ_auc:.3f}")
            passed = False
    return {
        "passed": passed,
        "reasons": reasons,
        "details": {"champion": champ, "challenger": chall, "rel_improvement": rel_imp},
    }


def check_promotion_from_files(
    champion_path: str | Path,
    challenger_path: str | Path,
    cfg_path: str | Path = "configs/promotion.yaml",
) -> dict[str, Any]:
    with open(champion_path) as f:
        champ = json.load(f)
    with open(challenger_path) as f:
        chall = json.load(f)
    # Try pace first
    result = evaluate_pace_promotion(champ, chall, cfg_path=cfg_path)
    # Also include tyre/pit if present
    if "tyre_mae" in champ or "tyre_mae" in chall:
        tyre_res = evaluate_tyre_promotion(champ, chall)
        # combine
        result["tyre"] = tyre_res
        if not tyre_res["passed"]:
            result["passed"] = False
            result["reasons"].extend([f"tyre: {r}" for r in tyre_res["reasons"]])
    if "pit_auc" in champ or "pit_auc" in chall:
        pit_res = evaluate_pit_promotion(champ, chall)
        result["pit"] = pit_res
        if not pit_res["passed"]:
            # pit not blocking for pace promotion? Keep separate but report
            result.setdefault("warnings", []).extend([f"pit: {r}" for r in pit_res["reasons"]])
    return result
