"""Prefect-style local flow runner — sequential steps, retry/backoff, run manifests.

Zero new dependencies: stdlib subprocess/uuid/argparse + pyyaml + polars (already present).
"""

from __future__ import annotations

import functools
import json
import shlex
import subprocess
import sys
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import polars as pl

StepFn = Callable[[dict[str, Any]], None]

SUBPROCESS_TIMEOUT_S = 600
DEFAULT_TRAIN_CMD = (
    "python -m pipelines.train --config configs/development.yaml --output-dir artifacts/candidate"
)
GOLD_PARQUET = Path("data/gold/pace_training/training.parquet")
DRIFT_REPORT = Path("artifacts/drift/report.json")


def task(_fn: Callable[..., Any] | None = None, *, retries: int = 0, backoff_s: float = 2.0):
    """Decorate a callable so it retries up to ``retries`` times on exception.

    Sleeps ``backoff_s`` between attempts and records the attempt count on the
    wrapper as ``attempts_used`` after each call.
    """

    def decorate(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            total = retries + 1
            for attempt in range(1, total + 1):
                try:
                    result = fn(*args, **kwargs)
                except Exception:
                    wrapper.attempts_used = attempt
                    if attempt < total:
                        time.sleep(backoff_s)
                    else:
                        raise
                else:
                    wrapper.attempts_used = attempt
                    return result

        wrapper.retries = retries
        wrapper.backoff_s = backoff_s
        wrapper.attempts_used = 0
        return wrapper

    return decorate(_fn) if _fn is not None else decorate


def flow(name: str):
    """Mark a callable as a named flow (minimal marker; FlowRunner is the engine)."""

    def decorate(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            return fn(*args, **kwargs)

        wrapper.flow_name = name
        wrapper.is_flow = True
        return wrapper

    return decorate


def _shell(cmd: str) -> None:
    """Run a command string with a hard timeout; swap leading ``python`` for the venv."""
    argv = shlex.split(cmd)
    if argv and argv[0] in ("python", "python3"):
        argv[0] = sys.executable
    subprocess.run(argv, timeout=SUBPROCESS_TIMEOUT_S, check=True)


def _step_features(step_cfg: dict[str, Any]) -> None:
    subprocess.run(
        [sys.executable, "-m", "pipelines.features"],
        timeout=SUBPROCESS_TIMEOUT_S,
        check=True,
    )


def _step_train(step_cfg: dict[str, Any]) -> None:
    _shell(str(step_cfg.get("cmd", DEFAULT_TRAIN_CMD)))


def _synthetic_gold() -> pl.DataFrame:
    """Synthetic silver→gold identical to pipelines/train.py fallback (6 sessions)."""
    import numpy as np

    from pitwall.features.pace import build_pace_features

    np.random.seed(42)
    rows: list[dict[str, Any]] = []
    for s in range(6):
        for d in [1, 16, 44, 63]:
            pit_lap = 15
            for lap in range(1, 31):
                is_second_stint = lap >= pit_lap
                tyre_age = (lap - pit_lap) if is_second_stint else (lap - 1)
                compound = "HARD" if is_second_stint else "MEDIUM"
                stint_no = 2 if is_second_stint else 1
                base = float(np.random.normal(90, 0.5))
                deg = 0.07 * tyre_age + 0.004 * (tyre_age**2)
                if compound == "SOFT":
                    deg *= 1.3
                elif compound == "HARD":
                    deg *= 0.75
                lt = base + deg + float(np.random.normal(0, 0.25))
                rows.append(
                    {
                        "session_id": f"2024_R{s}",
                        "driver_number": d,
                        "lap_number": lap,
                        "lap_time_s": lt,
                        "compound": compound,
                        "tyre_age": tyre_age,
                        "stint_no": stint_no,
                        "position": 1,
                        "is_valid_training_lap": True,
                        "track_temp_c": 37.0 + float(np.random.normal(0, 1.0)),
                    }
                )
    return build_pace_features(pl.DataFrame(rows))


def _load_gold() -> pl.DataFrame:
    if GOLD_PARQUET.exists():
        return pl.read_parquet(GOLD_PARQUET)
    return _synthetic_gold()


def _step_drift(step_cfg: dict[str, Any]) -> None:
    from pitwall.monitoring.drift import drift_on_window

    report = drift_on_window(_load_gold())
    DRIFT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    DRIFT_REPORT.write_text(json.dumps(report, indent=2, default=str))


STEPS: dict[str, StepFn] = {
    "features": _step_features,
    "train": _step_train,
    "drift": _step_drift,
}


class FlowRunner:
    """Sequential step executor driven by a configs/flow.yaml-style dict."""

    def __init__(self, config: dict[str, Any]) -> None:
        self.name = str(config.get("name", "flow"))
        self.steps_cfg: list[dict[str, Any]] = [dict(s) for s in config.get("steps", [])]
        self.manifest_dir = Path(config.get("manifest_dir", "artifacts/flow"))
        # snapshot of the module registry — instance-injectable for tests
        self.STEPS: dict[str, StepFn] = dict(STEPS)

    def run(self, steps: list[str] | None = None, dry_run: bool = False) -> dict[str, Any]:
        """Run selected steps sequentially; write and return the run manifest."""
        requested = set(steps) if steps is not None else None
        selected = [e for e in self.steps_cfg if requested is None or e.get("name") in requested]
        names = [str(e.get("name")) for e in selected]
        if requested is not None:
            missing = sorted(requested - set(names))
            if missing:
                raise KeyError(f"steps not in config: {missing}")
        unknown = [n for n in names if n not in self.STEPS]
        if unknown:
            raise KeyError(f"unknown step(s) {unknown}; known: {sorted(self.STEPS)}")

        manifest: dict[str, Any] = {
            "run_id": uuid.uuid4().hex[:12],
            "started_at": datetime.now(UTC).isoformat(),
            "flow": self.name,
            "dry_run": dry_run,
            "steps": [],
        }

        aborted = False
        for entry in selected:
            name = str(entry["name"])
            record = {"name": name, "status": "ok", "duration_s": 0.0, "error": None}
            if dry_run:
                record["status"] = "dry-run"
            elif aborted:
                record["status"] = "skipped"
            else:
                retries = int(entry.get("retries", 0))
                backoff = float(entry.get("backoff_s", 2.0))
                step_fn = task(self.STEPS[name], retries=retries, backoff_s=backoff)
                start = time.perf_counter()
                try:
                    step_fn({k: v for k, v in entry.items() if k != "name"})
                except Exception as exc:  # any failure must be recorded, never crash the chain
                    record["status"] = "failed"
                    record["error"] = f"{type(exc).__name__}: {exc}"
                    if not entry.get("allow_fail", False):
                        aborted = True
                finally:
                    record["duration_s"] = round(time.perf_counter() - start, 3)
            manifest["steps"].append(record)

        self._write_manifest(manifest)
        return manifest

    def _write_manifest(self, manifest: dict[str, Any]) -> Path:
        out = self.manifest_dir / str(manifest["run_id"]) / "manifest.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return out
