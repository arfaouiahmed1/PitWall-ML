"""Unit tests for the promotion CLI (champion/challenger swap)."""

import json
from datetime import datetime
from pathlib import Path

import pytest

from pitwall.registry.promote_cli import main
from pitwall.registry.promotion import evaluate_pace_promotion

CFG_YAML = """\
pace:
  primary_metric: mae_seconds
  min_relative_improvement: 0.02
  max_group_regression: 0.10
  latency:
    p95_ms_max: 100
  interval:
    nominal_coverage: 0.80
    coverage_tolerance: 0.05
  required_checks: []
"""

CHAMPION_METRICS = {"mae": 0.50, "coverage_80": 0.80}
PASS_CANDIDATE_METRICS = {"mae": 0.45, "coverage_80_calibrated": 0.82}
FAIL_CANDIDATE_METRICS = {"mae": 0.495, "coverage_80_calibrated": 0.82}


def _make_bundle(root: Path, metrics: dict) -> Path:
    bundle = root / "candidate"
    (bundle / "model").mkdir(parents=True)
    (bundle / "model" / "model.txt").write_text("dummy-model")
    (bundle / "model_quantile").mkdir()
    (bundle / "model_quantile" / "calibrator.json").write_text("{}")
    (bundle / "metrics.json").write_text(json.dumps(metrics))
    (bundle / "splits.json").write_text("{}")
    (bundle / "config.json").write_text("{}")
    return bundle


def _make_champion(root: Path) -> Path:
    champion = root / "champion"
    champion.mkdir()
    (champion / "metrics.json").write_text(json.dumps(CHAMPION_METRICS))
    (champion / "sentinel.txt").write_text("old")
    return champion


def _make_silver(root: Path, n: int) -> Path:
    silver = root / "data" / "silver" / "laps"
    silver.mkdir(parents=True)
    for i in range(n):
        (silver / f"laps_{i}.parquet").write_text("parquet")
    return silver


def _run(root: Path, candidate: Path, champion: Path, *extra: str) -> int:
    cfg = root / "promotion.yaml"
    if not cfg.exists():
        cfg.write_text(CFG_YAML)
    return main(
        [
            "--candidate",
            str(candidate),
            "--champion-dir",
            str(champion),
            "--config",
            str(cfg),
            "--registry-dir",
            str(root / "registry"),
            "--silver-dir",
            str(root / "data" / "silver" / "laps"),
            *extra,
        ]
    )


def _decisions(root: Path) -> list[dict]:
    lines = (root / "registry" / "decisions.jsonl").read_text().splitlines()
    return [json.loads(line) for line in lines]


def test_gate_pass_promotes_and_writes_state_and_decision(tmp_path: Path) -> None:
    # Given: a challenger that beats the champion on MAE with calibrated coverage
    candidate = _make_bundle(tmp_path, PASS_CANDIDATE_METRICS)
    champion = _make_champion(tmp_path)
    _make_silver(tmp_path, n=3)

    # When: the CLI runs without flags
    rc = _run(tmp_path, candidate, champion)

    # Then: exit 0, bundle swapped into champion, state + one decision recorded
    assert rc == 0
    assert (champion / "model" / "model.txt").read_text() == "dummy-model"
    assert (champion / "model_quantile" / "calibrator.json").exists()
    assert json.loads((champion / "metrics.json").read_text()) == PASS_CANDIDATE_METRICS
    assert not (champion / ".staging").exists()

    state = json.loads((champion / "train_state.json").read_text())
    assert state["n_silver_files"] == 3
    assert state["source"] == str(candidate)
    datetime.fromisoformat(state["promoted_at"])

    (decision,) = _decisions(tmp_path)
    assert decision["passed"] is True
    assert decision["forced"] is False
    assert decision["promoted"] is True
    assert decision["reasons"] == []
    assert decision["candidate"] == str(candidate)


def test_gate_fail_blocks_but_logs_decision(tmp_path: Path) -> None:
    # Given: a challenger that fails the MAE improvement gate
    candidate = _make_bundle(tmp_path, FAIL_CANDIDATE_METRICS)
    champion = _make_champion(tmp_path)

    # When: the CLI runs without --force
    rc = _run(tmp_path, candidate, champion)

    # Then: exit 1, champion untouched, decision logged as blocked
    assert rc == 1
    assert json.loads((champion / "metrics.json").read_text()) == CHAMPION_METRICS
    assert (champion / "sentinel.txt").read_text() == "old"
    assert not (champion / "model").exists()
    assert not (champion / "train_state.json").exists()

    (decision,) = _decisions(tmp_path)
    assert decision["passed"] is False
    assert decision["forced"] is False
    assert decision["promoted"] is False
    assert any("MAE" in reason for reason in decision["reasons"])


def test_dry_run_writes_nothing(tmp_path: Path) -> None:
    # Given: a passing challenger evaluated in dry-run mode
    candidate = _make_bundle(tmp_path, PASS_CANDIDATE_METRICS)
    champion = _make_champion(tmp_path)

    # When: the CLI runs with --dry-run
    rc = _run(tmp_path, candidate, champion, "--dry-run")

    # Then: exit 0 reports the pass but no filesystem effect anywhere
    assert rc == 0
    assert json.loads((champion / "metrics.json").read_text()) == CHAMPION_METRICS
    assert not (champion / "model").exists()
    assert not (champion / "train_state.json").exists()
    assert not (champion / ".staging").exists()
    assert not (tmp_path / "registry" / "decisions.jsonl").exists()


def test_force_overrides_failed_gate(tmp_path: Path) -> None:
    # Given: a failing challenger promoted under --force
    candidate = _make_bundle(tmp_path, FAIL_CANDIDATE_METRICS)
    champion = _make_champion(tmp_path)

    # When: the CLI runs with --force
    rc = _run(tmp_path, candidate, champion, "--force")

    # Then: exit 0, champion replaced, decision records forced=true
    assert rc == 0
    assert json.loads((champion / "metrics.json").read_text()) == FAIL_CANDIDATE_METRICS
    assert (champion / "model" / "model.txt").exists()

    (decision,) = _decisions(tmp_path)
    assert decision["passed"] is False
    assert decision["forced"] is True
    assert decision["promoted"] is True


def test_missing_inputs_exit_2_but_logs_decision(tmp_path: Path) -> None:
    # Given: no champion metrics on disk
    candidate = _make_bundle(tmp_path, PASS_CANDIDATE_METRICS)
    champion = tmp_path / "champion"
    champion.mkdir()

    # When: the CLI runs
    rc = _run(tmp_path, candidate, champion)

    # Then: exit 2, champion untouched, decision logged as not evaluated
    assert rc == 2
    assert not (champion / "train_state.json").exists()
    assert not (champion / "model").exists()

    (decision,) = _decisions(tmp_path)
    assert decision["passed"] is False
    assert decision["promoted"] is False
    assert any("missing input" in reason for reason in decision["reasons"])


def test_pace_gate_prefers_calibrated_coverage() -> None:
    # Given: raw coverage out of tolerance but calibrated coverage inside it
    champ = {"mae": 0.50, "coverage_80": 0.80}
    chall = {"mae": 0.45, "coverage_80": 0.50, "coverage_80_calibrated": 0.82}

    # When: the pace gate evaluates the challenger
    res = evaluate_pace_promotion(champ, chall, cfg={})

    # Then: the calibrated value decides the coverage gate
    assert res["passed"] is True
    assert res["details"]["coverage"]["source"] == "coverage_80_calibrated"


@pytest.mark.parametrize(
    ("metrics", "expected_pass"),
    [
        ({"mae": 0.45, "coverage_80": 0.82}, True),
        ({"mae": 0.45, "coverage_80_calibrated": 0.50}, False),
    ],
)
def test_coverage_fallback_and_calibration_reject(metrics: dict, expected_pass: bool) -> None:
    res = evaluate_pace_promotion({"mae": 0.50}, metrics, cfg={})
    assert res["passed"] is expected_pass
