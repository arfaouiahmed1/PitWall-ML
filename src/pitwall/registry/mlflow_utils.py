"""MLflow helpers — tracking + registry with aliases."""

from __future__ import annotations

import contextlib
import os
import subprocess
from pathlib import Path
from typing import Any

try:
    import mlflow  # type: ignore[import-not-found]
    from mlflow.tracking import MlflowClient  # type: ignore[import-not-found]
except ImportError:
    mlflow = None  # type: ignore[assignment]
    MlflowClient = None  # type: ignore[assignment]


def get_tracking_uri() -> str:
    # Prefer env, else http://localhost:5000, but allow file fallback for CI/smoke without server
    uri = os.getenv("MLFLOW_TRACKING_URI")
    if uri:
        return uri
    # check if localhost reachable? For now return default http;
    # log_pace_run will fallback to file on failure
    return os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")


def get_fallback_uri() -> str:
    # local file store under project root ./mlruns (relative to cwd) or ./artifacts/mlruns
    # Use absolute path to avoid cwd drift
    fallback = Path.cwd() / "mlruns"
    return f"file:{fallback}"


def ensure_experiment(name: str) -> str:
    if mlflow is None:
        raise ImportError("mlflow not installed")
    mlflow.set_tracking_uri(get_tracking_uri())
    exp = mlflow.get_experiment_by_name(name)
    exp_id = mlflow.create_experiment(name) if exp is None else exp.experiment_id
    mlflow.set_experiment(name)
    return exp_id


def _get_git_sha() -> str:
    # Try env first (CI), then git subprocess, fallback to "unknown"
    for key in ("GIT_SHA", "GITHUB_SHA", "COMMIT_SHA"):
        val = os.getenv(key)
        if val:
            return str(val)[:40]
    try:
        sha = (
            subprocess.check_output(
                ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL, timeout=2
            )
            .decode()
            .strip()
        )
        if sha:
            return sha[:40]
    except Exception:
        pass
    return "unknown"


def _resolve_tags(
    metrics: dict[str, Any],
    params: dict[str, Any],
    tags: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Build required tags: git_sha, split_type, dataset_version, dataset_rows, holdout_races."""
    resolved: dict[str, str] = {}
    # Start from explicit tags if provided
    if tags:
        for k, v in tags.items():
            resolved[str(k)] = str(v)

    # Helper to pull from params/metrics/extra/env
    def _first(*candidates: Any) -> Any | None:
        for c in candidates:
            if c is not None and c != "" and c != "unknown":
                return c
        return None

    # git_sha
    if "git_sha" not in resolved:
        sha = _first(
            tags.get("git_sha") if tags else None,
            params.get("git_sha"),
            metrics.get("git_sha"),
            (extra or {}).get("git_sha"),
            os.getenv("GIT_SHA"),
            _get_git_sha(),
        )
        resolved["git_sha"] = str(sha) if sha is not None else "unknown"

    # split_type
    if "split_type" not in resolved:
        val = _first(
            tags.get("split_type") if tags else None,
            params.get("split_type"),
            metrics.get("split_type"),
            (extra or {}).get("split_type"),
            "chronological",
        )
        resolved["split_type"] = str(val)

    # dataset_version
    if "dataset_version" not in resolved:
        val = _first(
            tags.get("dataset_version") if tags else None,
            params.get("dataset_version"),
            metrics.get("dataset_version"),
            (extra or {}).get("dataset_version"),
            os.getenv("DATASET_VERSION"),
            "unknown",
        )
        resolved["dataset_version"] = str(val)

    # dataset_rows
    if "dataset_rows" not in resolved:
        val = _first(
            tags.get("dataset_rows") if tags else None,
            params.get("dataset_rows"),
            metrics.get("dataset_rows"),
            (extra or {}).get("dataset_rows"),
            metrics.get("n"),
            params.get("n_rows"),
        )
        resolved["dataset_rows"] = str(val) if val is not None else "0"

    # holdout_races
    if "holdout_races" not in resolved:
        val = _first(
            tags.get("holdout_races") if tags else None,
            params.get("holdout_races"),
            metrics.get("holdout_races"),
            (extra or {}).get("holdout_races"),
            params.get("test_races"),
            metrics.get("test_races"),
        )
        # If still None, try to synthesize from splits info if extra contains it
        if val is None and extra and "holdout_races_list" in extra:
            try:
                val = ",".join(map(str, extra["holdout_races_list"]))  # type: ignore[arg-type]
            except Exception:
                val = str(extra["holdout_races_list"])
        resolved["holdout_races"] = str(val) if val is not None else "unknown"

    # Add any extra stringifiable tags that are not already present but useful
    if extra:
        for k in ("dataset_version", "split_type", "holdout_races", "git_sha"):
            if k not in resolved and k in extra:
                resolved[k] = str(extra[k])

    # Ensure all values are strings and truncated to MLflow limits (500 chars)
    for k, v in list(resolved.items()):
        s = str(v)
        if len(s) > 500:
            s = s[:500]
        resolved[k] = s
    return resolved


def log_pace_run(
    metrics: dict[str, Any],
    params: dict[str, Any],
    artifacts: Path | None = None,
    experiment: str = "pitwall-pace-dev",
    tags: dict[str, Any] | None = None,
    extra_tags: dict[str, Any] | None = None,
) -> str:
    if mlflow is None:
        raise ImportError("mlflow required")
    # Resolve required tags per spec: git_sha, split_type, dataset_version, dataset_rows, holdout_races
    resolved_tags = _resolve_tags(metrics, params, tags=tags, extra=extra_tags)
    # Also log tags that may be present in params like dataset_version etc as tags
    # Merge any remaining params that look like tags
    # Try primary URI, fallback to local file store if http unreachable
    uris_to_try = [get_tracking_uri(), get_fallback_uri()]
    last_err: Exception | None = None
    for uri in uris_to_try:
        try:
            mlflow.set_tracking_uri(uri)
            # ensure experiment exists (will create if needed)
            mlflow.set_experiment(experiment)
            with mlflow.start_run() as run:
                # Log params (sanitize: mlflow params must be strings, limit 500 chars, max 100 params)
                # Flatten nested dicts if needed
                flat_params: dict[str, str] = {}
                for k, v in params.items():
                    try:
                        # Convert to string, handle dicts via json-like
                        if isinstance(v, (dict, list)):
                            import json

                            s = json.dumps(v, default=str)
                        else:
                            s = str(v)
                        if len(s) > 500:
                            s = s[:500]
                        flat_params[str(k)] = s
                    except Exception:
                        flat_params[str(k)] = str(v)[:500]
                # MLflow has limit of 100 params per batch, batch if needed
                if flat_params:
                    # mlflow.log_params handles dict directly, but to avoid limit errors, chunk
                    items = list(flat_params.items())
                    for i in range(0, len(items), 100):
                        chunk = dict(items[i : i + 100])
                        mlflow.log_params(chunk)
                # Log metrics (only numeric)
                numeric_metrics = {
                    k: float(v)
                    for k, v in metrics.items()
                    if isinstance(v, (int, float)) and not isinstance(v, bool)
                }
                # Also allow nested per_compound etc? Flatten if needed
                # For now only top-level numerics
                if numeric_metrics:
                    mlflow.log_metrics(numeric_metrics)
                # Log tags
                try:
                    mlflow.set_tags(resolved_tags)
                except Exception:
                    # Fallback per-tag
                    for tk, tv in resolved_tags.items():
                        try:
                            mlflow.set_tag(tk, tv)
                        except Exception:
                            continue
                if artifacts and artifacts.exists():
                    mlflow.log_artifacts(str(artifacts))
                return run.info.run_id  # type: ignore[no-any-return]
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"MLflow logging failed for all URIs {uris_to_try}: {last_err}")


def register_model(run_id: str, model_name: str, alias: str = "champion") -> int:
    if mlflow is None:
        raise ImportError("mlflow required")
    mlflow.set_tracking_uri(get_tracking_uri())
    client = MlflowClient()
    mv = mlflow.register_model(f"runs:/{run_id}/model", model_name)
    # set alias
    with contextlib.suppress(Exception):
        client.set_registered_model_alias(model_name, alias, str(mv.version))
    return int(mv.version)


def load_champion(model_name: str = "pitwall-pace", alias: str = "champion"):
    """Load model via alias — e.g. models:/pitwall-pace@champion"""
    if mlflow is None:
        raise ImportError("mlflow required")
    mlflow.set_tracking_uri(get_tracking_uri())
    return mlflow.pyfunc.load_model(f"models:/{model_name}@{alias}")
