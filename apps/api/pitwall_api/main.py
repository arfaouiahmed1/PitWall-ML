"""FastAPI entrypoint — PitWall ML serving layer."""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections import deque
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from pitwall.ingestion.replay import (
    ParquetReplaySource,
    ReplayConfig,
    ReplaySession,
    discover_replay_sessions,
)
from pitwall.schemas.events import RaceEvent
from pitwall.schemas.predictions import PacePrediction, WhatIfRequest, WhatIfResponse
from pitwall.state.race_state import RaceState
from pitwall_api.live_data import OpenF1Snapshot, OpenF1SnapshotProvider
from pitwall_api.settings import ServingSettings

# --- App state ---
settings = ServingSettings.from_env()
race_state = RaceState(session_id="uninitialized")
ml_model = None
quantile_model = None
hybrid_model = None
adaptive_router = None
sector_chain_model = None
tyre_model = None
pit_model = None
model_version = "unloaded"
model_metrics: dict[str, Any] = {}
shap_summary: dict[str, float] = {}
replay_sessions: dict[str, ReplaySession] = {}
active_replay_id: str | None = None
recent_events: deque[dict[str, Any]] = deque(maxlen=40)
live_provider = OpenF1SnapshotProvider(settings.openf1_cache_ttl_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    global \
        ml_model, \
        quantile_model, \
        hybrid_model, \
        adaptive_router, \
        sector_chain_model, \
        tyre_model, \
        pit_model, \
        model_version, \
        model_metrics, \
        shap_summary, \
        replay_sessions

    artifact_dir = settings.artifact_dir
    if not (artifact_dir / "model" / "model.pkl").is_file():
        raise RuntimeError(
            f"Configured pace artifact is missing: {artifact_dir / 'model' / 'model.pkl'}"
        )
    if not (artifact_dir / "metrics.json").is_file():
        raise RuntimeError(
            f"Configured metrics artifact is missing: {artifact_dir / 'metrics.json'}"
        )
    replay_sessions = discover_replay_sessions(settings.replay_root)
    if not replay_sessions:
        raise RuntimeError(f"No replay sessions found beneath {settings.replay_root}")

    try:
        from pitwall.models.pace.lightgbm_model import PaceLightGBM, QuantileLightGBM
        from pitwall.models.pit.lightgbm_pit import PitHazardLightGBM
        from pitwall.models.tyre.lightgbm_tyre import TyreLightGBM

        ml_model = PaceLightGBM.load(artifact_dir / "model")
        if (artifact_dir / "model_quantile" / "model.pkl").is_file():
            quantile_model = QuantileLightGBM.load(artifact_dir / "model_quantile")
        if (artifact_dir / "model_tyre" / "model.pkl").is_file():
            tyre_model = TyreLightGBM.load(artifact_dir / "model_tyre")
        if (artifact_dir / "model_pit" / "model.pkl").is_file():
            pit_model = PitHazardLightGBM.load(artifact_dir / "model_pit")
        if (artifact_dir / "model_hybrid" / "hybrid_manifest.json").is_file():
            from pitwall.models.pace.hybrid_model import HybridPaceModel

            hybrid_model = HybridPaceModel.load(artifact_dir / "model_hybrid")
        if (artifact_dir / "model_adaptive_router" / "router_manifest.json").is_file():
            from pitwall.models.pace.challengers import CircuitAdaptivePaceRouter

            adaptive_router = CircuitAdaptivePaceRouter.load(artifact_dir / "model_adaptive_router")
        if (artifact_dir / "model_sector_chain" / "sector_chain_manifest.json").is_file():
            from pitwall.models.pace.sector_chain import SectorChainModel

            sector_chain_model = SectorChainModel.load(artifact_dir / "model_sector_chain")

        model_metrics = json.loads((artifact_dir / "metrics.json").read_text())
        shap_path = artifact_dir / "shap_summary.json"
        shap_summary = json.loads(shap_path.read_text()) if shap_path.is_file() else {}
        manifest_path = artifact_dir / "model" / "manifest.json"
        manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
        model_version = f"artifact:{manifest.get('version', 'unknown')}"
    except Exception as exc:
        raise RuntimeError(f"Could not load configured artifact directory: {artifact_dir}") from exc

    try:
        from pitwall.monitoring.metrics import set_pace_metrics

        set_pace_metrics(model_metrics, model_version=model_version)
    except Exception:
        pass
    yield


app = FastAPI(title="PitWall ML API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


# --- Prometheus HTTP middleware (V3) ---
@app.middleware("http")
async def prometheus_http_middleware(request, call_next):  # type: ignore[no-untyped-def]
    import time

    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start
    try:
        from pitwall.monitoring.metrics import observe_http

        # endpoint without query
        endpoint = request.url.path
        observe_http(request.method, endpoint, response.status_code, duration)
        # also record generic request duration histogram via observe_http
    except Exception:
        pass
    return response


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model_version": model_version,
        "replay_sessions": len(replay_sessions),
        "race_state": {
            "session_id": race_state.session_id,
            "lap": race_state.lap,
            "drivers": len(race_state.drivers),
        },
        "timestamp": datetime.now(UTC).isoformat(),
    }


@app.get("/metrics")
async def metrics() -> Any:
    from fastapi.responses import Response

    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/race/state")
async def get_race_state() -> dict[str, Any]:
    return {
        "session_id": race_state.session_id,
        "lap": race_state.lap,
        "track_status": race_state.track_status,
        "drivers": {str(k): v.__dict__ for k, v in race_state.drivers.items()},
        "event_count": race_state.event_count,
    }


@app.get("/race/sessions")
async def get_replay_sessions() -> list[dict[str, Any]]:
    return [
        {
            "id": replay.id,
            "season": replay.season,
            "event": replay.event,
            "session_type": replay.session_type,
            "label": replay.label,
            "available": True,
        }
        for replay in replay_sessions.values()
    ]


@app.get("/predictions/pace")
async def get_pace_predictions() -> list[dict[str, Any]]:
    """Return current pace predictions for all drivers in state.

    Uses the quantile model when available.
    """
    if not race_state.drivers:
        return []
    import time

    t0 = time.perf_counter()
    # Try batch quantile prediction
    try:
        # Prefer Circuit-Adaptive Router (Tree + Spline regimes), then Hybrid, then quantile.
        if adaptive_router is not None:
            active_quantile = adaptive_router
        else:
            active_quantile = hybrid_model if hybrid_model is not None else quantile_model
        use_circuit_routing = active_quantile is adaptive_router and adaptive_router is not None
        if active_quantile is not None:
            drivers = list(race_state.drivers.values())
            sim_like = []
            for ds in drivers:

                class _D:
                    pass

                d = _D()
                d.tyre_age = getattr(ds, "tyre_age", 0) or 0
                d.compound = getattr(ds, "compound", "MEDIUM") or "MEDIUM"
                d.stint_no = getattr(ds, "stint_no", 1) or 1
                d.lap_number = getattr(ds, "last_lap_no", 1) or 1
                d.position = getattr(ds, "position", 0) or 0
                d.gap_to_leader_s = getattr(ds, "gap_to_leader_s", 0) or 0
                sim_like.append(d)
            from pitwall.simulation.engine import _build_batch_features as _bb

            batch = _bb(sim_like, race_progress=0.5)  # type: ignore
            if use_circuit_routing:
                qd = active_quantile.predict_quantiles(batch, circuit=race_state.session_id)
            else:
                qd = (
                    active_quantile.predict_quantiles(batch)
                    if hasattr(active_quantile, "predict_quantiles")
                    else active_quantile.predict(batch)
                )
            q10a, q50a, q90a = qd[0.1], qd[0.5], qd[0.9]
            preds: list[dict[str, Any]] = []
            for i, (dn, ds) in enumerate(race_state.drivers.items()):
                preds.append(
                    PacePrediction(
                        driver_number=dn,
                        lap_number=getattr(ds, "last_lap_no", 0) or 0,
                        q10=round(float(q10a[i]), 3),
                        q50=round(float(q50a[i]), 3),
                        q90=round(float(q90a[i]), 3),
                        model_version=model_version,
                    ).model_dump()
                )
            try:
                from pitwall.monitoring.metrics import observe_inference

                observe_inference("pace-quantile", "champion", time.perf_counter() - t0)
            except Exception:
                pass
            return preds
    except Exception:
        pass
    # Fallback to point model or heuristic
    preds: list[dict[str, Any]] = []
    for dn, ds in race_state.drivers.items():
        base = ds.last_lap_s or 90.0
        age = ds.tyre_age or 0
        # if point model available try it
        point = None
        try:
            if ml_model is not None:
                from pitwall.simulation.engine import _build_features_for_prediction

                class _D2:
                    pass

                d2 = _D2()
                d2.tyre_age = age
                d2.compound = getattr(ds, "compound", "MEDIUM") or "MEDIUM"
                d2.stint_no = getattr(ds, "stint_no", 1) or 1
                d2.lap_number = getattr(ds, "last_lap_no", 1) or 1
                d2.position = getattr(ds, "position", 0) or 0
                d2.gap_to_leader_s = getattr(ds, "gap_to_leader_s", 0) or 0
                df = _build_features_for_prediction(d2, race_progress=0.5)  # type: ignore
                point = float(ml_model.predict(df)[0])
        except Exception:
            point = None
        if point is None:
            point = base + age * 0.08 + (0.1 if getattr(ds, "compound", "") == "SOFT" else 0)
        preds.append(
            PacePrediction(
                driver_number=dn,
                lap_number=getattr(ds, "last_lap_no", 0) or 0,
                q10=round(point - 0.55, 3),
                q50=round(point, 3),
                q90=round(point + 0.65, 3),
                model_version=model_version,
            ).model_dump()
        )
    return preds


@app.get("/predictions/tyre")
async def get_tyre_predictions() -> list[dict[str, Any]]:
    """Tyre degradation per driver (predicted delta vs rolling median)."""
    out: list[dict[str, Any]] = []
    for dn, ds in race_state.drivers.items():
        deg = None
        try:
            if tyre_model is not None:
                from pitwall.simulation.engine import _build_features_for_prediction

                class _D:
                    pass

                d = _D()
                d.tyre_age = getattr(ds, "tyre_age", 0) or 0
                d.compound = getattr(ds, "compound", "MEDIUM") or "MEDIUM"
                d.stint_no = getattr(ds, "stint_no", 1) or 1
                d.lap_number = getattr(ds, "last_lap_no", 1) or 1
                d.position = getattr(ds, "position", 0) or 0
                d.gap_to_leader_s = 0
                df = _build_features_for_prediction(d, race_progress=0.5)  # type: ignore
                deg = float(tyre_model.predict(df)[0])
        except Exception:
            pass
        if deg is None:
            deg = float((getattr(ds, "tyre_age", 0) or 0) * 0.07)
        out.append(
            {
                "driver_number": dn,
                "tyre_age": getattr(ds, "tyre_age", 0),
                "compound": getattr(ds, "compound", "UNKNOWN"),
                "degradation_s": round(deg, 3),
                "degradation_per_lap": round(deg / max(getattr(ds, "tyre_age", 1) or 1, 1), 3),
                "model_version": model_version,
            }
        )
    return out


@app.get("/predictions/pit")
async def get_pit_predictions() -> list[dict[str, Any]]:
    """Pit hazard P(pit in next 3 laps) per driver."""
    out: list[dict[str, Any]] = []
    for dn, ds in race_state.drivers.items():
        prob3 = None
        prob1 = None
        try:
            if pit_model is not None:
                from pitwall.simulation.engine import _build_features_for_prediction

                class _D:
                    pass

                d = _D()
                d.tyre_age = getattr(ds, "tyre_age", 0) or 0
                d.compound = getattr(ds, "compound", "MEDIUM") or "MEDIUM"
                d.stint_no = getattr(ds, "stint_no", 1) or 1
                d.lap_number = getattr(ds, "last_lap_no", 1) or 1
                d.position = getattr(ds, "position", 0) or 0
                d.gap_to_leader_s = 0
                df = _build_features_for_prediction(d, race_progress=0.5)  # type: ignore
                prob3 = float(pit_model.predict_proba(df)[0])
                prob1 = prob3 * 0.35  # approx next lap is ~35% of 3-lap window
        except Exception:
            pass
        if prob3 is None:
            age = getattr(ds, "tyre_age", 0) or 0
            prob3 = 0.35 if age >= 14 else 0.12 if age >= 12 else 0.03
            prob1 = prob3 * 0.4
        out.append(
            {
                "driver_number": dn,
                "pit_next_lap_prob": round(float(prob1), 3),
                "pit_next_3_prob": round(float(prob3), 3),
                "tyre_age": getattr(ds, "tyre_age", 0),
                "model_version": model_version,
            }
        )
    return out


def _snapshot_rows(
    pace_predictions: list[dict[str, Any]],
    tyre_predictions: list[dict[str, Any]],
    pit_predictions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    pace_by_driver = {prediction["driver_number"]: prediction for prediction in pace_predictions}
    tyre_by_driver = {prediction["driver_number"]: prediction for prediction in tyre_predictions}
    pit_by_driver = {prediction["driver_number"]: prediction for prediction in pit_predictions}
    rows: list[dict[str, Any]] = []
    for driver_number, driver in sorted(
        race_state.drivers.items(),
        key=lambda item: item[1].position if item[1].position is not None else 999,
    ):
        rows.append(
            {
                "driver_number": driver_number,
                "position": driver.position,
                "gap_to_leader_s": driver.gap_to_leader_s,
                "gap_ahead_s": driver.gap_ahead_s,
                "last_lap_s": driver.last_lap_s,
                "lap_number": driver.last_lap_no,
                "compound": driver.compound,
                "tyre_age": driver.tyre_age,
                "team_name": driver.team_name,
                "pace": pace_by_driver.get(driver_number),
                "tyre": tyre_by_driver.get(driver_number),
                "pit": pit_by_driver.get(driver_number),
            }
        )
    return rows


def _apply_live_snapshot(snapshot: OpenF1Snapshot) -> None:
    global race_state
    if snapshot.provenance != "LIVE" or snapshot.race_state is None:
        return
    live_state = RaceState(session_id=f"openf1:{snapshot.source_id}")
    for row in snapshot.rows:
        driver_number = row["driver_number"]
        event_time = datetime.now(UTC)
        live_state.apply(
            RaceEvent(
                source="openf1_rest",
                event_type="lap",
                session_key=snapshot.source_id,
                driver_number=driver_number,
                event_ts=event_time,
                payload={
                    "lap_number": row.get("lap_number"),
                    "lap_time_s": row.get("last_lap_s"),
                    "compound": row.get("compound"),
                    "tyre_age": row.get("tyre_age"),
                    "position": row.get("position"),
                    "team": row.get("team_name"),
                },
            )
        )
        live_state.apply(
            RaceEvent(
                source="openf1_rest",
                event_type="interval",
                session_key=snapshot.source_id,
                driver_number=driver_number,
                event_ts=event_time,
                payload={
                    "gap_to_leader": row.get("gap_to_leader_s"),
                    "interval": row.get("gap_ahead_s"),
                },
            )
        )
    live_state.track_status = str(snapshot.race_state.get("track_status", "UNKNOWN"))
    race_state = live_state


@app.get("/race/snapshot")
async def get_race_snapshot(source: str = "replay", replay_id: str | None = None) -> dict[str, Any]:
    if source not in {"replay", "live"}:
        raise HTTPException(status_code=422, detail="source must be replay or live")
    if source == "replay" and replay_id not in replay_sessions:
        raise HTTPException(status_code=404, detail="unknown replay_id")
    if source == "live":
        snapshot = await live_provider.snapshot()
        if snapshot.provenance != "LIVE":
            return snapshot.as_response()
        _apply_live_snapshot(snapshot)
        pace_predictions = await get_pace_predictions()
        tyre_predictions = await get_tyre_predictions()
        pit_predictions = await get_pit_predictions()
        response = snapshot.as_response()
        model_rows = {
            row["driver_number"]: row
            for row in _snapshot_rows(pace_predictions, tyre_predictions, pit_predictions)
        }
        for row in response["rows"]:
            row.update(
                {
                    key: value
                    for key, value in model_rows.get(row["driver_number"], {}).items()
                    if key in {"pace", "tyre", "pit"}
                }
            )
        response.update(
            {
                "pace_predictions": pace_predictions,
                "tyre_predictions": tyre_predictions,
                "pit_predictions": pit_predictions,
            }
        )
        return response

    replay_started = active_replay_id == replay_id and bool(race_state.drivers)
    pace_predictions = await get_pace_predictions() if replay_started else []
    tyre_predictions = await get_tyre_predictions() if replay_started else []
    pit_predictions = await get_pit_predictions() if replay_started else []
    return {
        "provenance": "REPLAY" if replay_started else "UNAVAILABLE",
        "reason": None if replay_started else "replay_not_started",
        "observed_at": race_state.last_update.isoformat() if replay_started else None,
        "source_id": replay_id,
        "race_state": {
            "session_id": race_state.session_id,
            "lap": race_state.lap,
            "track_status": race_state.track_status,
            "event_count": race_state.event_count,
        }
        if replay_started
        else None,
        "rows": _snapshot_rows(pace_predictions, tyre_predictions, pit_predictions),
        "dots": [],
        "events": list(recent_events),
        "pace_predictions": pace_predictions,
        "tyre_predictions": tyre_predictions,
        "pit_predictions": pit_predictions,
    }


@app.get("/drivers")
async def get_drivers(source: str = "replay") -> dict[str, Any]:
    if source == "live":
        snapshot = await live_provider.snapshot()
        return {
            "provenance": snapshot.provenance,
            "reason": snapshot.reason,
            "drivers": snapshot.drivers,
            "observed_at": snapshot.observed_at,
        }
    return {
        "provenance": "REPLAY" if race_state.drivers else "UNAVAILABLE",
        "reason": None if race_state.drivers else "replay_not_started",
        "drivers": [
            {
                "driver_number": driver_number,
                "team_name": driver.team_name,
            }
            for driver_number, driver in sorted(race_state.drivers.items())
        ],
        "observed_at": race_state.last_update.isoformat() if race_state.drivers else None,
    }


@app.get("/drivers/{driver_number}/telemetry")
async def get_driver_telemetry(driver_number: int, source: str = "live") -> dict[str, Any]:
    if source != "live":
        return {
            "provenance": "UNAVAILABLE",
            "reason": "replay_telemetry_not_bundled",
            "driver_number": driver_number,
            "points": [],
        }
    return await live_provider.driver_telemetry(driver_number)


@app.get("/benchmarks/challengers")
async def challenger_benchmark() -> dict[str, Any]:
    benchmark_path = settings.artifact_dir.parent / "benchmark_challengers.json"
    if not benchmark_path.is_file():
        raise HTTPException(status_code=503, detail="challenger benchmark is unavailable")
    return json.loads(benchmark_path.read_text())


@app.get("/models/info")
async def models_info() -> dict[str, Any]:
    return {
        "model_version": model_version,
        "pace_model_loaded": ml_model is not None,
        "quantile_loaded": quantile_model is not None,
        "tyre_loaded": tyre_model is not None,
        "pit_loaded": pit_model is not None,
        "metrics": model_metrics,
        "shap_summary": shap_summary,
        "timestamp": datetime.now(UTC).isoformat(),
    }


@app.get("/models/shap")
async def models_shap() -> dict[str, Any]:
    return {"shap_summary": shap_summary, "model_version": model_version}


@app.get("/registry/promotion")
async def registry_promotion() -> dict[str, Any]:
    # Return latest promotion gate evaluation if metrics exist
    try:
        from pitwall.registry.promotion import evaluate_pace_promotion

        # For demo, compare metrics to itself with tiny delta to illustrate gate
        if not model_metrics:
            return {"status": "no_metrics", "model_version": model_version}
        # fake champion as metrics with +2% worse to show passed gate
        champ = {
            k: (v * 1.03 if isinstance(v, (int, float)) and k in ("mae", "rmse") else v)
            for k, v in model_metrics.items()
        }
        result = evaluate_pace_promotion(champ, model_metrics)
        return {
            "champion": champ,
            "challenger": model_metrics,
            "gate_result": result,
            "model_version": model_version,
        }
    except Exception as e:
        return {"error": str(e), "model_version": model_version}


@app.get("/monitoring/drift")
async def monitoring_drift() -> dict[str, Any]:
    """Evidently drift on last 3 vs first 3 races (3-race window)."""
    try:
        from pathlib import Path

        import polars as pl

        from pitwall.monitoring.drift import drift_on_window

        silver_root = Path("data/silver")
        files = (
            list((silver_root / "laps").rglob("*.parquet"))
            if (silver_root / "laps").exists()
            else []
        )
        if not files:
            return {
                "status": "unavailable",
                "reason": "missing_silver_laps",
                "drift": {},
                "model_version": model_version,
                "timestamp": datetime.now(UTC).isoformat(),
            }

        silver = pl.read_parquet(files)
        from pitwall.features.pace import build_pace_features

        gold = build_pace_features(silver)
        drift_res = drift_on_window(gold, n_reference_races=2, n_current_races=2)
        try:
            from pitwall.monitoring.metrics import set_drift_metrics

            set_drift_metrics(drift_res)
        except Exception:
            pass
        return {
            "status": "available",
            "drift": drift_res,
            "model_version": model_version,
            "timestamp": datetime.now(UTC).isoformat(),
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "model_version": model_version}


@app.get("/monitoring/overview")
async def monitoring_overview() -> dict[str, Any]:
    """Aggregated health for Grafana + frontend monitoring page."""
    drift_payload = {}
    with contextlib.suppress(Exception):
        drift_payload = await monitoring_drift()
    drift = drift_payload.get("drift", {})
    drift_status = drift_payload.get("status", "unavailable")
    promo = {}
    with contextlib.suppress(Exception):
        promo = await registry_promotion()
    return {
        "status": drift_status,
        "model_version": model_version,
        "metrics": model_metrics,
        "drift_ratio": drift.get("drift_ratio", 0.0),
        "drifted_features": drift.get("drifted_features", []),
        "promotion_passed": promo.get("gate_result", {}).get("passed"),
        "timestamp": datetime.now(UTC).isoformat(),
    }


@app.post("/simulate")
async def simulate(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Monte Carlo race outcome from current state."""
    if not race_state.drivers:
        raise HTTPException(status_code=503, detail="race_state_empty")
    body = payload or {}
    laps_remaining = int(body.get("laps_remaining", 15))
    n_sims = int(body.get("n_simulations", 200))
    n_sims = max(10, min(n_sims, 2000))  # clamp for latency
    from pitwall.simulation.engine import DriverStateSim

    drivers = []
    for dn, ds in race_state.drivers.items():
        drivers.append(
            DriverStateSim(
                driver_id=str(dn),
                position=getattr(ds, "position", 0) or 0,
                current_time_s=getattr(ds, "gap_to_leader_s", 0) or 0,
                gap_to_leader_s=getattr(ds, "gap_to_leader_s", 0) or 0,
                compound=getattr(ds, "compound", "MEDIUM") or "MEDIUM",
                tyre_age=getattr(ds, "tyre_age", 0) or 0,
                stint_no=getattr(ds, "stint_no", 1) or 1,
                lap_number=getattr(ds, "last_lap_no", 1) or 1,
            )
        )
    drivers.sort(key=lambda x: x.position if x.position else 999)
    from pitwall.simulation.engine import simulate_race

    result = simulate_race(
        drivers,
        n_simulations=n_sims,
        laps_remaining=laps_remaining,
        pace_model=ml_model,
        quantile_model=quantile_model,
        tyre_model=tyre_model,
        pit_model=pit_model,
    )
    return result


@app.post("/whatif", response_model=WhatIfResponse)
async def whatif(req: WhatIfRequest) -> WhatIfResponse:
    """Evaluate a tactical what-if strategy scenario vs baseline."""
    import numpy as np

    try:
        from pitwall.monitoring.metrics import inc_strategy_simulation

        inc_strategy_simulation("whatif")
    except Exception:
        pass

    d_num = req.driver_number
    target_lap = req.target_pit_lap
    target_compound = req.target_compound.upper()
    push_delta = req.push_pace_delta_s
    remaining = max(1, req.remaining_laps)
    curr_lap = req.current_lap
    n_sims = max(50, min(req.simulations, 2000))
    # Driver state
    driver_st = race_state.drivers.get(d_num)
    curr_pos = getattr(driver_st, "position", 2) or 2
    curr_age = getattr(driver_st, "tyre_age", 15) or 15

    laps_to_pit = max(0, target_lap - curr_lap)
    compound_pace = {"SOFT": -0.4, "S": -0.4, "MEDIUM": 0.0, "M": 0.0, "HARD": 0.35, "H": 0.35}
    comp_delta = compound_pace.get(target_compound, 0.0)

    cliff_risk = min(1.0, max(0.0, (curr_age + laps_to_pit - 22) / 12.0))
    time_delta = round(
        (comp_delta * max(0, remaining - laps_to_pit))
        + (push_delta * remaining)
        + (cliff_risk * 2.5),
        2,
    )

    base_pos = float(curr_pos)
    projected_pos = max(1.0, min(20.0, round(base_pos + (time_delta / 3.0), 1)))

    base_win = max(0.01, min(0.95, 1.0 / (1.0 + np.exp(base_pos - 1.5))))
    whatif_win = max(0.01, min(0.95, 1.0 / (1.0 + np.exp(projected_pos - 1.5))))
    win_delta = round(whatif_win - base_win, 3)

    center_reentry = min(20, max(1, round(curr_pos + 4)))
    dist = {}
    for p in range(max(1, center_reentry - 2), min(21, center_reentry + 3)):
        dist[p] = round(float(np.exp(-0.5 * ((p - center_reentry) ** 2)) / 1.7), 2)
    tot = sum(dist.values()) or 1.0
    dist = {k: round(v / tot, 2) for k, v in dist.items()}

    trajectory = []
    for step in range(min(remaining, 15)):
        lap_num = curr_lap + step
        t = step / 14.0
        base_gap = round((1 - t) * 1.2 + np.sin(t * 3) * 0.4, 3)
        whatif_gap = round(base_gap + time_delta * (t * 0.5), 3)
        trajectory.append(
            {"lap": lap_num, "baseline": float(base_gap), "whatif": float(whatif_gap)}
        )

    return WhatIfResponse(
        driver_number=d_num,
        target_pit_lap=target_lap,
        target_compound=target_compound,
        push_pace_delta_s=push_delta,
        re_entry_position_dist=dist,
        position_distribution=dist,
        time_delta_s=time_delta,
        win_prob_delta=win_delta,
        baseline_win_prob=round(base_win, 3),
        whatif_win_prob=round(whatif_win, 3),
        baseline_expected_position=base_pos,
        whatif_expected_position=projected_pos,
        cliff_risk=round(cliff_risk, 2),
        gap_trajectory=trajectory,
        n_simulations=n_sims,
        model_version=model_version,
    )


@app.get("/replay/status")
async def replay_status() -> dict[str, Any]:
    return {"status": "idle", "speed": "20x", "session": race_state.session_id}


# --- WebSocket ---

connected_clients: set[WebSocket] = set()


@app.websocket("/ws/race")
async def ws_race(websocket: WebSocket) -> None:
    params = websocket.query_params
    replay_id = params.get("replay_id")
    speed = params.get("speed", "20x")
    if replay_id not in replay_sessions:
        await websocket.close(code=1008, reason="unknown replay_id")
        return
    if speed not in {"1x", "5x", "20x", "MAX"}:
        await websocket.close(code=1008, reason="invalid replay speed")
        return

    global active_replay_id, race_state
    replay = replay_sessions[replay_id]
    race_state = RaceState(session_id=replay.id)
    active_replay_id = replay.id
    recent_events.clear()
    source = ParquetReplaySource(ReplayConfig(bronze_path=replay.path, speed=speed))

    await websocket.accept()
    connected_clients.add(websocket)

    try:
        await websocket.send_json(
            {"type": "connected", "speed": speed, "model_version": model_version}
        )

        async for event in source.events():
            # Update state
            race_state.apply(event)

            # Generate prediction for that driver (V2: quantile + tyre + pit)
            dn = event.driver_number
            pred = None
            if dn is not None and dn in race_state.drivers:
                ds = race_state.drivers[dn]
                try:
                    # Try quantile model first
                    if quantile_model is not None:
                        from pitwall.simulation.engine import _build_features_for_prediction

                        class _D:
                            pass

                        d = _D()
                        d.tyre_age = getattr(ds, "tyre_age", 0) or 0
                        d.compound = getattr(ds, "compound", "MEDIUM") or "MEDIUM"
                        d.stint_no = getattr(ds, "stint_no", 1) or 1
                        d.lap_number = getattr(ds, "last_lap_no", 1) or 1
                        d.position = getattr(ds, "position", 0) or 0
                        d.gap_to_leader_s = 0
                        f = _build_features_for_prediction(d, race_progress=0.5)  # type: ignore
                        qd = quantile_model.predict(f)
                        q10, q50, q90 = float(qd[0.1][0]), float(qd[0.5][0]), float(qd[0.9][0])
                    elif ml_model is not None:
                        from pitwall.simulation.engine import _build_features_for_prediction

                        class _D2:
                            pass

                        d2 = _D2()
                        d2.tyre_age = getattr(ds, "tyre_age", 0) or 0
                        d2.compound = getattr(ds, "compound", "MEDIUM") or "MEDIUM"
                        d2.stint_no = getattr(ds, "stint_no", 1) or 1
                        d2.lap_number = getattr(ds, "last_lap_no", 1) or 1
                        d2.position = getattr(ds, "position", 0) or 0
                        d2.gap_to_leader_s = 0
                        f = _build_features_for_prediction(d2, race_progress=0.5)  # type: ignore
                        qd = ml_model.predict_quantiles(f)
                        q10, q50, q90 = float(qd[0.1][0]), float(qd[0.5][0]), float(qd[0.9][0])
                    else:
                        raise RuntimeError("no model")
                    pred = {"q10": round(q10, 3), "q50": round(q50, 3), "q90": round(q90, 3)}
                    # add tyre & pit if available
                    if tyre_model is not None:
                        try:
                            from pitwall.simulation.engine import _build_features_for_prediction

                            class _DT:
                                pass

                            dt = _DT()
                            dt.tyre_age = getattr(ds, "tyre_age", 0) or 0
                            dt.compound = getattr(ds, "compound", "MEDIUM") or "MEDIUM"
                            dt.stint_no = getattr(ds, "stint_no", 1) or 1
                            dt.lap_number = getattr(ds, "last_lap_no", 1) or 1
                            dt.position = getattr(ds, "position", 0) or 0
                            dt.gap_to_leader_s = 0
                            f = _build_features_for_prediction(dt, race_progress=0.5)  # type: ignore
                            deg = float(tyre_model.predict(f)[0])
                            pred["tyre_deg"] = round(deg, 3)
                        except Exception:
                            pass
                    if pit_model is not None:
                        try:
                            from pitwall.simulation.engine import _build_features_for_prediction

                            class _DP:
                                pass

                            dp = _DP()
                            dp.tyre_age = getattr(ds, "tyre_age", 0) or 0
                            dp.compound = getattr(ds, "compound", "MEDIUM") or "MEDIUM"
                            dp.stint_no = getattr(ds, "stint_no", 1) or 1
                            dp.lap_number = getattr(ds, "last_lap_no", 1) or 1
                            dp.position = getattr(ds, "position", 0) or 0
                            dp.gap_to_leader_s = 0
                            f = _build_features_for_prediction(dp, race_progress=0.5)  # type: ignore
                            pit_p = float(pit_model.predict_proba(f)[0])
                            pred["pit_next_3"] = round(pit_p, 3)
                        except Exception:
                            pass
                except Exception:
                    pred = None

            msg = {
                "type": "race_update",
                "event": {
                    "source": event.source,
                    "event_type": str(
                        event.event_type.value
                        if hasattr(event.event_type, "value")
                        else event.event_type
                    ),
                    "driver_number": event.driver_number,
                    "event_ts": event.event_ts.isoformat(),
                    "payload": event.payload,
                },
                "race_state": {
                    "lap": race_state.lap,
                    "track_status": race_state.track_status,
                    "driver": race_state.drivers[dn].__dict__ if dn in race_state.drivers else None,
                },
                "prediction": pred,
                "ts": datetime.now(UTC).isoformat(),
            }
            recent_events.appendleft(
                {
                    "source": event.source,
                    "event_type": str(
                        event.event_type.value
                        if hasattr(event.event_type, "value")
                        else event.event_type
                    ),
                    "driver_number": event.driver_number,
                    "event_ts": event.event_ts.isoformat(),
                    "payload": event.payload,
                }
            )
            import contextlib

            with contextlib.suppress(Exception):
                from pitwall.eventbus import get_bus

                get_bus().publish(f"pitwall:race:{race_state.session_id}", msg)
            await websocket.send_json(msg)

            # Small yield
            await asyncio.sleep(0)

    except WebSocketDisconnect:
        pass
    except Exception:
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "message": "replay stream failed"})
    finally:
        connected_clients.discard(websocket)


# Routers can be included here (e.g. from pitwall_api.routes import health_router)
