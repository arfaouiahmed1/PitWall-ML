"""MLflow helpers — tracking + registry with aliases."""

from __future__ import annotations

import os
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
    # check if localhost reachable? For now return default http; log_pace_run will fallback to file on failure
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
    if exp is None:
        exp_id = mlflow.create_experiment(name)
    else:
        exp_id = exp.experiment_id
    mlflow.set_experiment(name)
    return exp_id


def log_pace_run(
    metrics: dict[str, Any],
    params: dict[str, Any],
    artifacts: Path | None = None,
    experiment: str = "pitwall-pace-dev",
) -> str:
    if mlflow is None:
        raise ImportError("mlflow required")
    # Try primary URI, fallback to local file store if http unreachable
    uris_to_try = [get_tracking_uri(), get_fallback_uri()]
    last_err: Exception | None = None
    for uri in uris_to_try:
        try:
            mlflow.set_tracking_uri(uri)
            # ensure experiment exists (will create if needed)
            mlflow.set_experiment(experiment)
            with mlflow.start_run() as run:
                mlflow.log_params(params)
                mlflow.log_metrics(
                    {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))}
                )
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
    try:
        client.set_registered_model_alias(model_name, alias, str(mv.version))
    except Exception:
        pass
    return int(mv.version)


def load_champion(model_name: str = "pitwall-pace", alias: str = "champion"):
    """Load model via alias — e.g. models:/pitwall-pace@champion"""
    if mlflow is None:
        raise ImportError("mlflow required")
    mlflow.set_tracking_uri(get_tracking_uri())
    return mlflow.pyfunc.load_model(f"models:/{model_name}@{alias}")
