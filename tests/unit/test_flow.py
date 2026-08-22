"""Unit tests for the Prefect-style local flow runner (orchestration.flow)."""

from __future__ import annotations

import json

import pytest

import pitwall.orchestration.flow as flow_mod
from pitwall.orchestration.flow import FlowRunner


def _config(tmp_path, steps: list[dict]) -> dict:
    """Config dict with manifest_dir pointed at tmp_path so tests never touch artifacts/."""
    return {"name": "test-flow", "manifest_dir": str(tmp_path / "flow"), "steps": steps}


def test_dry_run_executes_nothing_but_validates_and_returns_manifest(tmp_path):
    calls: list[str] = []

    def probe(step_cfg: dict) -> None:
        calls.append(str(step_cfg))

    original = dict(flow_mod.STEPS)
    flow_mod.STEPS["probe"] = probe
    try:
        runner = FlowRunner(
            _config(tmp_path, [{"name": "probe"}, {"name": "train"}, {"name": "drift"}])
        )
        manifest = runner.run(dry_run=True)
    finally:
        flow_mod.STEPS.clear()
        flow_mod.STEPS.update(original)

    assert calls == []  # nothing executed
    statuses = {s["name"]: s["status"] for s in manifest["steps"]}
    assert statuses == {"probe": "dry-run", "train": "dry-run", "drift": "dry-run"}
    assert manifest["run_id"]
    assert manifest["started_at"]
    # unknown step must fail validation even in dry-run
    bad = FlowRunner(_config(tmp_path, [{"name": "does-not-exist"}]))
    with pytest.raises(KeyError):
        bad.run(dry_run=True)


def test_failing_task_retries_then_reports_failed_status_with_error(tmp_path, monkeypatch):
    attempts: list[int] = []

    def always_fails(step_cfg: dict) -> None:
        attempts.append(1)
        raise RuntimeError("boom-42")

    monkeypatch.setitem(flow_mod.STEPS, "flaky", always_fails)
    monkeypatch.setitem(flow_mod.STEPS, "after", lambda step_cfg: None)
    runner = FlowRunner(
        _config(
            tmp_path,
            [{"name": "flaky", "retries": 2, "backoff_s": 0.01}, {"name": "after"}],
        )
    )
    manifest = runner.run()

    assert len(attempts) == 3  # 1 initial + 2 retries
    entry = next(s for s in manifest["steps"] if s["name"] == "flaky")
    assert entry["status"] == "failed"
    assert "boom-42" in (entry["error"] or "")
    # chain aborted: the step after the failure never ran and is marked skipped
    after = next(s for s in manifest["steps"] if s["name"] == "after")
    assert after["status"] == "skipped"


def test_successful_chain_of_two_dummy_steps_writes_manifest_json(tmp_path):
    ran: list[str] = []

    def step_a(step_cfg: dict) -> None:
        ran.append("a")

    def step_b(step_cfg: dict) -> None:
        ran.append("b")

    cfg = _config(tmp_path, [{"name": "a"}, {"name": "b"}])
    runner = FlowRunner(cfg)
    runner.STEPS["a"] = step_a  # instance-level injection for testability
    runner.STEPS["b"] = step_b

    manifest = runner.run()

    assert ran == ["a", "b"]
    assert all(s["status"] == "ok" for s in manifest["steps"])
    assert all(s["error"] is None for s in manifest["steps"])
    manifest_path = tmp_path / "flow" / manifest["run_id"] / "manifest.json"
    assert manifest_path.exists()
    on_disk = json.loads(manifest_path.read_text())
    assert [s["name"] for s in on_disk["steps"]] == ["a", "b"]
    assert on_disk["run_id"] == manifest["run_id"]


def test_steps_subset_filtering_only_runs_requested_steps(tmp_path):
    ran: list[str] = []

    def make(name: str):
        def _step(step_cfg: dict) -> None:
            ran.append(name)

        return _step

    cfg = _config(tmp_path, [{"name": "one"}, {"name": "two"}, {"name": "three"}])
    runner = FlowRunner(cfg)
    runner.STEPS["one"] = make("one")
    runner.STEPS["two"] = make("two")
    runner.STEPS["three"] = make("three")

    manifest = runner.run(steps=["three", "one"])

    assert ran == ["one", "three"]  # YAML order preserved, "two" not executed
    assert [s["name"] for s in manifest["steps"]] == ["one", "three"]
