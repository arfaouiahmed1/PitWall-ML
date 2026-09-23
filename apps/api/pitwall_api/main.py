"""FastAPI entrypoint — PitWall ML serving layer."""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field

from pitwall.ingestion.live_recorder import LiveRaceRecorder
from pitwall.ingestion.replay import (
    ParquetReplaySource,
    ReplayConfig,
    ReplaySession,
    discover_replay_sessions,
)
from pitwall.models.pit.opponent_model import OpponentPitModel
from pitwall.models.safety_car.hazard import SafetyCarHazardModel
from pitwall.monitoring.drift_era import DEFAULT_DRIFT_COLS, era_drift_analysis
from pitwall.regulations.circuits import all_circuits, get_circuit_config
from pitwall.schemas.events import RaceEvent
from pitwall.schemas.predictions import (
    PacePrediction,
    UndercutThreat,
    WhatIfRequest,
    WhatIfResponse,
)
from pitwall.state.race_state import RaceState
from pitwall.storage.parquet_writer import ParquetPartitionWriter
from pitwall_api.broadcaster import RaceBroadcaster
from pitwall_api.live_data import OpenF1Snapshot, OpenF1SnapshotProvider
from pitwall_api.settings import ServingSettings


class EraDriftMetric(BaseModel):
    feature: str
    ks_statistic: float
    ks_pvalue: float | None
    wasserstein: float
    psi: float
    js_divergence: float
    drifted: bool
    severity: str
    reference_mean: float
    current_mean: float
    reference_std: float
    current_std: float
    relative_shift_pct: float


class EraDriftResponse(BaseModel):
    status: Literal["available", "no_data", "unavailable"]
    reason: str | None = None
    reference_era: str
    current_era: str
    n_reference_sessions: int
    n_current_sessions: int
    results: list[EraDriftMetric]
    metric_count: int
    overall_drift_ratio: float
    max_severity: str
    broken_features: list[str]
    source_fingerprint: str


class CircuitSegmentResponse(BaseModel):
    name: str
    seg_type: str
    start_pct: float
    end_pct: float
    length_m: float
    key_accel_zone: bool
    overtake_value: float
    downforce_demand: float
    regen_potential: float
    max_speed_kmh: float


class CircuitResponse(BaseModel):
    circuit_key: str
    circuit_short_name: str
    circuit_name: str
    country: str
    total_laps: int
    segments: list[CircuitSegmentResponse]


class CircuitListResponse(BaseModel):
    count: int
    circuits: list[CircuitResponse]


def _build_era_drift_cache() -> dict[str, Any]:
    """Build the era report once from persisted silver laps, or mark it unavailable."""
    silver_root = Path("data/silver/laps")
    files = sorted(silver_root.rglob("*.parquet")) if silver_root.is_dir() else []
    fingerprint = ":".join(
        f"{file.as_posix()}:{file.stat().st_size}:{file.stat().st_mtime_ns}" for file in files
    )
    if not files:
        return {
            "status": "no_data",
            "reason": "missing_silver_laps",
            "source_fingerprint": fingerprint,
            "reference_era": "ground_effect_v2",
            "current_era": "revised_aero_pu_2026",
            "n_reference_sessions": 0,
            "n_current_sessions": 0,
            "results": [],
            "metric_count": 0,
            "overall_drift_ratio": 0.0,
            "max_severity": "none",
            "broken_features": [],
        }

    import polars as pl

    try:
        frames = [pl.read_parquet(file) for file in files]
    except (OSError, pl.exceptions.PolarsError):
        return {
            "status": "unavailable",
            "reason": "unreadable_silver_laps",
            "reference_era": "ground_effect_v2",
            "current_era": "revised_aero_pu_2026",
            "n_reference_sessions": 0,
            "n_current_sessions": 0,
            "results": [],
            "metric_count": 0,
            "overall_drift_ratio": 0.0,
            "max_severity": "none",
            "broken_features": [],
            "source_fingerprint": fingerprint,
        }
    frame = pl.concat(frames, how="diagonal_relaxed")
    if "regulation_era" not in frame.columns:
        return {
            "status": "no_data",
            "reason": "missing_regulation_era_labels",
            "source_fingerprint": fingerprint,
            "reference_era": "ground_effect_v2",
            "current_era": "revised_aero_pu_2026",
            "n_reference_sessions": 0,
            "n_current_sessions": 0,
            "results": [],
            "metric_count": 0,
            "overall_drift_ratio": 0.0,
            "max_severity": "none",
            "broken_features": [],
        }
    report = era_drift_analysis(frame, columns=DEFAULT_DRIFT_COLS).to_dict()
    has_results = bool(report["results"])
    return {
        "status": "available" if has_results else "no_data",
        "reason": None if has_results else "insufficient_era_metrics",
        "source_fingerprint": fingerprint,
        **report,
        "metric_count": len(report["results"]),
    }


def refresh_era_drift_cache() -> EraDriftResponse:
    """Rebuild the process cache from current Parquet sources on demand."""
    global era_drift_report
    era_drift_report = _build_era_drift_cache()
    return EraDriftResponse.model_validate(era_drift_report)


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
opponent_pit_model: OpponentPitModel = OpponentPitModel()
safety_car_model: SafetyCarHazardModel = SafetyCarHazardModel()
era_drift_report: dict[str, Any] = _build_era_drift_cache()
model_version = "unloaded"
model_metrics: dict[str, Any] = {}
shap_summary: dict[str, float] = {}
replay_sessions: dict[str, ReplaySession] = {}
active_replay_id: str | None = None
recent_events: deque[dict[str, Any]] = deque(maxlen=40)
live_provider = OpenF1SnapshotProvider(
    settings.openf1_cache_ttl_seconds,
    stale_after_seconds=settings.openf1_cache_ttl_seconds,
)
live_recorder: LiveRaceRecorder | None = None
live_writer: ParquetPartitionWriter | None = None
live_session_key: int | str | None = None
live_event_count = 0
live_latency_ms: float | None = None
live_lifecycle_lock = asyncio.Lock()
replay_broadcasters: dict[str, ReplayStream] = {}
live_broadcaster: RaceBroadcaster | None = None


class LiveStartRequest(BaseModel):
    """Parameters for starting an OpenF1 live capture session."""

    session_key: int | str = Field(default="latest")


class LiveStartResponse(BaseModel):
    status: Literal["running", "already_running"]
    session_key: int | str


class LiveStopResponse(BaseModel):
    status: Literal["stopped"]
    events_captured: int


class LiveStatusResponse(BaseModel):
    status: Literal["idle", "running"]
    session_key: int | str | None
    event_count: int
    buffered_events: int
    latency_ms: float | None


@dataclass(slots=True)
class ReplayStream:
    """Mutable lifecycle record shared by a replay producer and its subscribers."""

    replay: ReplaySession
    speed: str
    state: RaceState
    broadcaster: RaceBroadcaster
    producer: asyncio.Task[None] | None = None


async def _stop_live_ingestion() -> int:
    """Stop the active recorder and finalize its writer while holding the lifecycle lock."""
    global \
        live_recorder, \
        live_writer, \
        live_session_key, \
        live_event_count, \
        live_latency_ms, \
        live_broadcaster

    recorder = live_recorder
    writer = live_writer
    events_captured = live_event_count
    if recorder is not None:
        await recorder.stop()
    if writer is not None:
        await asyncio.to_thread(writer.finalize_session)

    live_recorder = None
    live_writer = None
    live_session_key = None
    live_event_count = 0
    live_latency_ms = None
    if live_broadcaster is not None:
        live_broadcaster.close()
        live_broadcaster = None
    return events_captured


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
    try:
        yield
    finally:
        for stream in replay_broadcasters.values():
            stream.broadcaster.close()
            if stream.producer is not None:
                stream.producer.cancel()
        if replay_broadcasters:
            await asyncio.gather(
                *(
                    stream.producer
                    for stream in replay_broadcasters.values()
                    if stream.producer is not None
                ),
                return_exceptions=True,
            )
        replay_broadcasters.clear()
        async with live_lifecycle_lock:
            await _stop_live_ingestion()


app = FastAPI(
    title="PitWall ML API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.expose_docs else None,
    redoc_url="/redoc" if settings.expose_docs else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Pitwall-API-Key"],
)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
    )
    return response


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
    # Check relational DB connection
    db_healthy = False
    db_error = None
    try:
        from sqlalchemy import text

        from pitwall.storage.db import get_engine

        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_healthy = True
    except Exception as exc:
        db_error = str(exc)

    # Check model loaded status
    model_loaded = ml_model is not None and model_version != "unloaded"

    # Check live recorder status
    recorder_running = live_recorder is not None and live_recorder.is_running
    last_event_ts = None
    data_age_seconds = None
    stale = None
    if recorder_running and live_recorder is not None:
        last_event_ts = live_recorder.state.last_update.isoformat()
        age = (
            datetime.now(UTC) - live_recorder.state.last_update.astimezone(UTC)
        ).total_seconds()
        data_age_seconds = round(age, 2)
        stale = age > live_recorder.stale_after_seconds

    # Storage status
    buffered_events = live_writer.buffer_size if live_writer is not None else 0
    storage_status = {
        "parquet_writer": "active" if live_writer is not None else "idle",
        "buffered_events": buffered_events,
        "total_events_captured": live_event_count,
    }

    # Update Prometheus system health gauges
    try:
        from pitwall.monitoring.metrics import set_system_health

        set_system_health(
            db_connected=db_healthy,
            model_is_loaded=model_loaded,
            recorder_is_stale=bool(stale),
            parquet_buffer=buffered_events,
        )
    except Exception:
        pass

    # Overall service status: degraded if model unloaded or db unreachable
    overall_status = "degraded" if not model_loaded or not db_healthy else "ok"

    return {
        "status": overall_status,
        "model_version": model_version,
        "model": {
            "loaded": model_loaded,
            "version": model_version,
            "status": "loaded" if model_loaded else "unloaded",
        },
        "database": {
            "status": "connected" if db_healthy else "error",
            "error": db_error,
        },
        "ingestion": {
            "status": "running" if recorder_running else "idle",
            "session_key": live_session_key,
            "last_source_timestamp": last_event_ts,
            "data_age_seconds": data_age_seconds,
            "stale": stale,
        },
        "storage": storage_status,
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
    if not settings.expose_metrics:
        raise HTTPException(status_code=404, detail="Not Found")
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


def _authenticate_live_mutation(request: Request) -> None:
    """Verify X-Pitwall-API-Key on live mutation endpoints using constant-time comparison."""
    if settings.app_env == "production" or settings.live_api_key is not None:
        key = request.headers.get("x-pitwall-api-key")
        if not key:
            raise HTTPException(
                status_code=401,
                detail="Authentication required: missing X-Pitwall-API-Key header",
            )
        if not settings.verify_api_key(key):
            raise HTTPException(
                status_code=403,
                detail="Forbidden: invalid X-Pitwall-API-Key",
            )


@app.post("/live/start", tags=["Live Ingestion"], response_model=LiveStartResponse)
async def start_live_capture(
    request: Request, payload: LiveStartRequest | None = None
) -> LiveStartResponse:
    """Start one OpenF1 recorder and route its events into Bronze Parquet storage."""
    _authenticate_live_mutation(request)
    global \
        race_state, \
        live_recorder, \
        live_writer, \
        live_session_key, \
        live_event_count, \
        live_latency_ms, \
        live_broadcaster

    session_key = (payload or LiveStartRequest()).session_key
    if isinstance(session_key, str):
        session_key = session_key.strip()
        if not session_key:
            raise HTTPException(status_code=422, detail="session_key cannot be empty")

    async with live_lifecycle_lock:
        if live_recorder is not None:
            return LiveStartResponse(
                status="already_running", session_key=live_session_key or session_key
            )

        race_state = RaceState(session_id=str(session_key))
        live_broadcaster = RaceBroadcaster(lambda: _race_snapshot(race_state))
        writer = ParquetPartitionWriter(
            session_id=str(session_key), base_dir=settings.replay_root / "live"
        )

        async def persist_live_event(
            event: RaceEvent, prediction: dict[str, Any] | None = None
        ) -> None:
            global live_event_count, live_latency_ms
            await asyncio.to_thread(writer.write_event, event)
            try:
                from pitwall.storage.db import save_live_event_to_db

                await save_live_event_to_db(event, session_id=str(session_key))
            except Exception:
                pass
            live_event_count += 1
            event_timestamp = (
                event.event_ts.replace(tzinfo=UTC)
                if event.event_ts.tzinfo is None
                else event.event_ts.astimezone(UTC)
            )
            live_latency_ms = max(0.0, (datetime.now(UTC) - event_timestamp).total_seconds() * 1000)
            event_type = str(event.event_type)
            driver = (
                race_state.drivers.get(event.driver_number)
                if event.driver_number is not None
                else None
            )
            if live_broadcaster is not None:
                live_broadcaster.publish(
                    {
                        "type": "race_update",
                        "event": {
                            "source": event.source,
                            "event_type": event_type,
                            "driver_number": event.driver_number,
                            "event_ts": event.event_ts.isoformat(),
                            "source_timestamp": event.event_ts.isoformat(),
                            "observed_at": event.payload.get("observed_at"),
                            "received_at": event.payload.get("received_at"),
                            "source_id": event.source_id,
                            "provenance": event.payload.get("provenance"),
                            "data_age_seconds": event.payload.get("data_age_seconds"),
                            "stale": event.payload.get("stale", False),
                            "payload": event.payload,
                        },
                        "race_state": {
                            "lap": race_state.lap,
                            "track_status": race_state.track_status,
                            "driver": driver.__dict__ if driver is not None else None,
                        },
                        "prediction": prediction,
                        "ts": datetime.now(UTC).isoformat(),
                    }
                )

        recorder = LiveRaceRecorder(
            session_key=session_key,
            state=race_state,
            quantile_model=quantile_model,
            ml_model=ml_model,
            tyre_model=tyre_model,
            pit_model=pit_model,
            on_event=persist_live_event,
        )
        await recorder.start()
        live_recorder = recorder
        live_writer = writer
        live_session_key = session_key
        live_event_count = 0
        live_latency_ms = None
        return LiveStartResponse(status="running", session_key=session_key)


@app.post("/live/stop", tags=["Live Ingestion"], response_model=LiveStopResponse)
async def stop_live_capture(request: Request) -> LiveStopResponse:
    """Stop the active recorder and consolidate its partitions into events.parquet."""
    _authenticate_live_mutation(request)
    async with live_lifecycle_lock:
        return LiveStopResponse(status="stopped", events_captured=await _stop_live_ingestion())


@app.get("/live/status", tags=["Live Ingestion"], response_model=LiveStatusResponse)
async def live_capture_status() -> LiveStatusResponse:
    """Return the active live-capture session and its in-memory persistence state."""
    async with live_lifecycle_lock:
        writer = live_writer
        recorder = live_recorder
        return LiveStatusResponse(
            status="running" if recorder is not None and recorder.is_running else "idle",
            session_key=live_session_key,
            event_count=live_event_count,
            buffered_events=writer.buffer_size if writer is not None else 0,
            latency_ms=live_latency_ms,
        )


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


_ALLOWED_TYRE_COMPOUNDS = {"SOFT", "MEDIUM", "HARD"}


@app.get(
    "/predictions/undercut",
    tags=["Predictions"],
    response_model=UndercutThreat,
    summary="Evaluate opponent undercut and overcut threat",
    description=(
        "Assess whether a trailing rival poses an undercut threat, or a leading rival "
        "is vulnerable to an overcut, using OpponentPitModel. Accepts optional query "
        "parameters or falls back to live race_state."
    ),
)
async def get_undercut_prediction(
    driver_number: int | None = Query(
        default=None, description="Driver number to evaluate threat for"
    ),
    rival_number: int | None = Query(default=None, description="Trailing rival driver number"),
    gap_s: float | None = Query(
        default=None, description="Gap to rival in seconds (positive if driver ahead of rival)"
    ),
    driver_compound: str | None = Query(
        default=None, description="Tyre compound of the driver (SOFT, MEDIUM, HARD)"
    ),
    rival_compound: str | None = Query(
        default=None, description="Tyre compound of the rival (SOFT, MEDIUM, HARD)"
    ),
    driver_tyre_age: int | None = Query(
        default=None, ge=0, description="Tyre age of driver in laps"
    ),
    rival_tyre_age: int | None = Query(default=None, ge=0, description="Tyre age of rival in laps"),
    tyre_age_delta: int | None = Query(
        default=None, description="Difference in tyre age (rival_age - driver_age)"
    ),
) -> UndercutThreat:
    """Evaluate rival undercut/overcut threat between consecutive or specified cars."""
    # Enforce compound validation (SOFT, MEDIUM, HARD)
    if driver_compound is not None:
        normalized_d_comp = driver_compound.strip().upper()
        if normalized_d_comp not in _ALLOWED_TYRE_COMPOUNDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid driver_compound '{driver_compound}'. "
                    f"Allowed compounds: {', '.join(sorted(_ALLOWED_TYRE_COMPOUNDS))}"
                ),
            )
        driver_compound = normalized_d_comp

    if rival_compound is not None:
        normalized_r_comp = rival_compound.strip().upper()
        if normalized_r_comp not in _ALLOWED_TYRE_COMPOUNDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid rival_compound '{rival_compound}'. "
                    f"Allowed compounds: {', '.join(sorted(_ALLOWED_TYRE_COMPOUNDS))}"
                ),
            )
        rival_compound = normalized_r_comp

    if driver_number is not None and driver_number <= 0:
        raise HTTPException(status_code=400, detail="driver_number must be a positive integer")
    if rival_number is not None and rival_number <= 0:
        raise HTTPException(status_code=400, detail="rival_number must be a positive integer")
    if driver_number is not None and rival_number is not None and driver_number == rival_number:
        raise HTTPException(
            status_code=400, detail="driver_number and rival_number cannot be identical"
        )

    model = opponent_pit_model or OpponentPitModel()

    # Case 1: race_state has no active drivers
    if not race_state.drivers:
        has_params = (
            gap_s is not None
            or tyre_age_delta is not None
            or driver_tyre_age is not None
            or rival_tyre_age is not None
            or driver_compound is not None
            or rival_compound is not None
        )
        if not has_params:
            return UndercutThreat(
                driver_number=driver_number,
                rival_number=rival_number,
                gap_s=None,
                is_undercut_threat=False,
                is_overcut_threat=False,
                rival_pit_probability_3l=0.0,
                tyre_age_delta=0,
                estimated_delta_at_pit_exit_s=0.0,
                recommended_action="HOLD",
                reason="no_active_drivers",
                model_version=model_version,
            )

        d_num = driver_number if driver_number is not None else 1
        r_num = rival_number if rival_number is not None else 2
        d_comp = driver_compound or "MEDIUM"
        r_comp = rival_compound or "MEDIUM"
        g_s = gap_s if gap_s is not None else 1.5

        if tyre_age_delta is not None:
            d_age = driver_tyre_age if driver_tyre_age is not None else 10
            r_age = rival_tyre_age if rival_tyre_age is not None else (d_age + tyre_age_delta)
        else:
            d_age = driver_tyre_age if driver_tyre_age is not None else 10
            r_age = rival_tyre_age if rival_tyre_age is not None else 10

        threat = model.evaluate_undercut_threat(
            driver_number=d_num,
            driver_tyre_age=d_age,
            driver_compound=d_comp,
            rival_number=r_num,
            rival_tyre_age=r_age,
            rival_compound=r_comp,
            gap_s=g_s,
        )
        return UndercutThreat(
            driver_number=threat.driver_number,
            rival_number=threat.rival_number,
            gap_s=threat.gap_s,
            is_undercut_threat=threat.is_undercut_threat,
            is_overcut_threat=threat.is_overcut_threat,
            rival_pit_probability_3l=threat.rival_pit_probability_3l,
            tyre_age_delta=threat.tyre_age_delta,
            estimated_delta_at_pit_exit_s=threat.estimated_delta_at_pit_exit_s,
            recommended_action=threat.recommended_action,
            reason=None,
            model_version=model_version,
        )

    # Case 2: race_state has active drivers
    d_state = None
    r_state = None

    if driver_number is not None:
        if driver_number in race_state.drivers:
            d_state = race_state.drivers[driver_number]
        elif gap_s is None:
            raise HTTPException(
                status_code=400,
                detail=f"Driver {driver_number} not found in active race state",
            )

    if rival_number is not None:
        if rival_number in race_state.drivers:
            r_state = race_state.drivers[rival_number]
        elif gap_s is None:
            raise HTTPException(
                status_code=400,
                detail=f"Rival driver {rival_number} not found in active race state",
            )

    sorted_drivers = sorted(
        race_state.drivers.values(),
        key=lambda d: d.position if d.position is not None else 999,
    )

    if d_state is None and driver_number is None and sorted_drivers:
        d_state = sorted_drivers[0]
        driver_number = d_state.driver_number

    if r_state is None and rival_number is None and d_state is not None:
        try:
            curr_idx = sorted_drivers.index(d_state)
            if curr_idx + 1 < len(sorted_drivers):
                r_state = sorted_drivers[curr_idx + 1]
                rival_number = r_state.driver_number
        except ValueError:
            pass

    if r_state is None and gap_s is None and rival_number is None:
        return UndercutThreat(
            driver_number=driver_number,
            rival_number=None,
            gap_s=None,
            is_undercut_threat=False,
            is_overcut_threat=False,
            rival_pit_probability_3l=0.0,
            tyre_age_delta=0,
            estimated_delta_at_pit_exit_s=0.0,
            recommended_action="HOLD",
            reason="no_trailing_rival",
            model_version=model_version,
        )

    # Resolve compounds with fallback
    d_comp = driver_compound
    if d_comp is None:
        raw = getattr(d_state, "compound", "MEDIUM") or "MEDIUM"
        d_comp = raw.upper() if raw.upper() in _ALLOWED_TYRE_COMPOUNDS else "MEDIUM"

    r_comp = rival_compound
    if r_comp is None:
        raw = getattr(r_state, "compound", "MEDIUM") if r_state else "MEDIUM"
        raw = raw or "MEDIUM"
        r_comp = raw.upper() if raw.upper() in _ALLOWED_TYRE_COMPOUNDS else "MEDIUM"

    # Resolve tyre ages with fallback
    d_age = driver_tyre_age
    if d_age is None:
        d_age = getattr(d_state, "tyre_age", 10) if d_state and d_state.tyre_age is not None else 10

    r_age = rival_tyre_age
    if r_age is None:
        if tyre_age_delta is not None:
            r_age = d_age + tyre_age_delta
        else:
            r_age = (
                getattr(r_state, "tyre_age", 10) if r_state and r_state.tyre_age is not None else 10
            )

    # Resolve gap with fallback
    g_s = gap_s
    if g_s is None:
        if r_state and r_state.gap_ahead_s is not None:
            g_s = float(r_state.gap_ahead_s)
        elif (
            r_state
            and r_state.gap_to_leader_s is not None
            and d_state
            and d_state.gap_to_leader_s is not None
        ):
            g_s = max(0.0, float(r_state.gap_to_leader_s - d_state.gap_to_leader_s))
        elif d_state and d_state.gap_behind_s is not None:
            g_s = float(d_state.gap_behind_s)
        else:
            g_s = 1.5

    threat = model.evaluate_undercut_threat(
        driver_number=driver_number or 0,
        driver_tyre_age=d_age,
        driver_compound=d_comp,
        rival_number=rival_number or 0,
        rival_tyre_age=r_age,
        rival_compound=r_comp,
        gap_s=g_s,
    )
    return UndercutThreat(
        driver_number=threat.driver_number,
        rival_number=threat.rival_number,
        gap_s=threat.gap_s,
        is_undercut_threat=threat.is_undercut_threat,
        is_overcut_threat=threat.is_overcut_threat,
        rival_pit_probability_3l=threat.rival_pit_probability_3l,
        tyre_age_delta=threat.tyre_age_delta,
        estimated_delta_at_pit_exit_s=threat.estimated_delta_at_pit_exit_s,
        recommended_action=threat.recommended_action,
        reason=None,
        model_version=model_version,
    )


class SafetyCarPrediction(BaseModel):
    """Safety car / VSC neutralization hazard over upcoming laps."""

    p_sc_next_1: float = Field(
        ge=0.0,
        le=1.0,
        description="Probability of a Safety Car deployment on the next lap",
    )
    p_vsc_next_1: float = Field(
        ge=0.0,
        le=1.0,
        description="Probability of a Virtual Safety Car deployment on the next lap",
    )
    p_neutralization_next_3: float = Field(
        ge=0.0,
        le=1.0,
        description="Probability of any neutralization (SC or VSC) within the next 3 laps",
    )
    circuit_risk_tier: str = Field(
        description="Circuit baseline risk tier (LOW, MEDIUM, HIGH, VERY_HIGH)"
    )
    risk_factors: list[str] = Field(
        default_factory=list,
        description="Active risk factor tags (e.g. LAP_1_START_CHAOS, WET_TRACK_CONDITIONS)",
    )


@app.get(
    "/predictions/safety-car",
    tags=["Predictions"],
    response_model=SafetyCarPrediction,
    summary="Predict safety car and neutralization hazard",
    description=(
        "Estimate Safety Car / Virtual Safety Car hazard for the upcoming laps "
        "using SafetyCarHazardModel. Accepts circuit and race-context query "
        "parameters; unknown circuits fall back to a medium risk prior."
    ),
)
async def get_safety_car_prediction(
    circuit_id: str | None = Query(
        default=None, description="Circuit identifier (e.g. monaco, singapore, jeddah)"
    ),
    current_lap: int = Query(default=1, ge=1, description="Current lap number (1-indexed)"),
    total_laps: int = Query(default=66, ge=1, description="Total scheduled race laps"),
    is_wet: bool = Query(
        default=False, description="True when the track is wet or rain is falling"
    ),
    recent_incident_count: int = Query(
        default=0, ge=0, description="Number of recent yellow-flag incidents"
    ),
) -> SafetyCarPrediction:
    """Predict SC/VSC neutralization hazard for the next laps."""
    if current_lap > total_laps:
        raise HTTPException(
            status_code=400,
            detail=f"current_lap ({current_lap}) cannot exceed total_laps ({total_laps})",
        )

    clean_circuit_id = (circuit_id or "").strip() or None

    model = safety_car_model or SafetyCarHazardModel()
    pred = model.predict_hazard(
        circuit_id=clean_circuit_id,
        lap_number=current_lap,
        total_laps=total_laps,
        is_rain=is_wet,
        recent_yellows=recent_incident_count,
    )
    return SafetyCarPrediction(
        p_sc_next_1=pred.p_sc_next_1,
        p_vsc_next_1=pred.p_vsc_next_1,
        p_neutralization_next_3=pred.p_neutralization_next_3,
        circuit_risk_tier=pred.circuit_risk_tier,
        risk_factors=list(pred.risk_factors),
    )


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
        source_metadata = {
            "source_timestamp": snapshot.observed_at,
            "observed_at": snapshot.observed_at,
            "received_at": snapshot.received_at,
            "source_id": snapshot.source_id,
            "provenance": snapshot.provenance,
            "source_provenance": "OPENF1",
            "data_age_seconds": snapshot.data_age_seconds,
            "stale": snapshot.stale,
        }
        for prediction_rows in (pace_predictions, tyre_predictions, pit_predictions):
            for prediction_row in prediction_rows:
                prediction_row.update(source_metadata)
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
            "source": "openf1",
            "source_provenance": "OPENF1",
            "provenance": snapshot.provenance,
            "reason": snapshot.reason,
            "drivers": snapshot.drivers,
            "observed_at": snapshot.observed_at,
            "received_at": snapshot.received_at,
            "source_id": snapshot.source_id,
            "data_age_seconds": snapshot.data_age_seconds,
            "stale": snapshot.stale,
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


@app.get("/weather/latest", tags=["Weather"])
async def get_latest_weather(session_id: str | None = None) -> dict[str, Any]:
    """Return the most recent persisted weather observation from the database."""
    sid = session_id or (
        str(live_session_key) if live_session_key else str(race_state.session_id)
    )
    try:
        from pitwall.storage.db import get_latest_weather_from_db

        record = await get_latest_weather_from_db(sid)
    except Exception as exc:
        return {
            "status": "unavailable",
            "reason": f"database_error: {exc}",
            "session_id": sid,
            "weather": None,
            "timestamp": datetime.now(UTC).isoformat(),
        }

    if record is None:
        return {
            "status": "unavailable",
            "reason": "no_weather_records_for_session",
            "session_id": sid,
            "weather": None,
            "timestamp": datetime.now(UTC).isoformat(),
        }

    source_ts = record.get("source_timestamp")
    stale = True
    age_seconds = None
    if source_ts:
        try:
            ts_dt = datetime.fromisoformat(source_ts.replace("Z", "+00:00"))
            age_seconds = (datetime.now(UTC) - ts_dt.astimezone(UTC)).total_seconds()
            stale = age_seconds > settings.openf1_cache_ttl_seconds
        except Exception:
            pass

    return {
        "status": "available",
        "session_id": sid,
        "weather": record,
        "source_timestamp": source_ts,
        "observed_at": source_ts,
        "provenance": "OPENF1",
        "data_age_seconds": round(age_seconds, 2) if age_seconds is not None else None,
        "stale": stale,
        "timestamp": datetime.now(UTC).isoformat(),
    }


@app.get("/weather/history", tags=["Weather"])
async def get_weather_history(
    session_id: str | None = None, limit: int = 50
) -> dict[str, Any]:
    """Return historical persisted weather observations for a session."""
    sid = session_id or (
        str(live_session_key) if live_session_key else str(race_state.session_id)
    )
    try:
        from pitwall.storage.db import get_weather_history_from_db

        records = await get_weather_history_from_db(sid, limit=limit)
        return {
            "status": "available",
            "session_id": sid,
            "count": len(records),
            "records": records,
            "timestamp": datetime.now(UTC).isoformat(),
        }
    except Exception as exc:
        return {
            "status": "unavailable",
            "reason": f"database_error: {exc}",
            "session_id": sid,
            "count": 0,
            "records": [],
            "timestamp": datetime.now(UTC).isoformat(),
        }


@app.get("/monitoring/era-drift", tags=["Monitoring"], response_model=EraDriftResponse)
async def monitoring_era_drift() -> EraDriftResponse:
    """Return the module-cached era-drift analysis without request-time computation."""
    return EraDriftResponse.model_validate(era_drift_report)


@app.get("/circuits", tags=["Circuits"], response_model=CircuitListResponse)
async def list_circuits() -> CircuitListResponse:
    """List unique circuit configurations available in the backend registry."""
    circuits_by_key = {circuit.circuit_key: circuit for circuit in all_circuits()}
    circuits = [circuit.to_dict() for circuit in circuits_by_key.values()]
    return CircuitListResponse.model_validate({"count": len(circuits), "circuits": circuits})


@app.get(
    "/circuits/{circuit_id}",
    tags=["Circuits"],
    response_model=CircuitResponse,
    responses={404: {"description": "Circuit is not registered"}},
)
async def circuit_detail(circuit_id: str) -> CircuitResponse:
    """Return the configured track details for a registered circuit or HTTP 404."""
    circuit = get_circuit_config(circuit_id)
    if circuit is None:
        raise HTTPException(status_code=404, detail="unknown_circuit")
    return CircuitResponse.model_validate(circuit.to_dict())


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

    # DB connection check
    db_connected = False
    try:
        from sqlalchemy import text

        from pitwall.storage.db import get_engine

        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_connected = True
    except Exception:
        pass

    # Truthful drift ratio: None when drift metrics are unavailable (no fake zeros)
    drift_ratio = drift.get("drift_ratio") if drift_status == "available" else None

    return {
        "status": drift_status,
        "model_version": model_version,
        "model_loaded": ml_model is not None and model_version != "unloaded",
        "database_connected": db_connected,
        "metrics": model_metrics,
        "drift_status": drift_status,
        "drift_ratio": drift_ratio,
        "drifted_features": (
            drift.get("drifted_features", []) if drift_status == "available" else []
        ),
        "promotion_passed": promo.get("gate_result", {}).get("passed"),
        "live_recorder_status": (
            "running" if live_recorder is not None and live_recorder.is_running else "idle"
        ),
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


def _race_snapshot(state: RaceState) -> dict[str, Any]:
    return {
        "type": "race_snapshot",
        "race_state": {
            "session_id": state.session_id,
            "lap": state.lap,
            "track_status": state.track_status,
            "event_count": state.event_count,
            "drivers": {str(number): driver.__dict__ for number, driver in state.drivers.items()},
        },
    }


async def _produce_replay(stream: ReplayStream) -> None:
    source = ParquetReplaySource(ReplayConfig(bronze_path=stream.replay.path, speed=stream.speed))
    inference = LiveRaceRecorder(
        state=stream.state,
        quantile_model=quantile_model,
        ml_model=ml_model,
        tyre_model=tyre_model,
        pit_model=pit_model,
    )
    try:
        async for event in source.events():
            stream.state.apply(event)
            prediction = inference.generate_inference(event)
            event_type = str(event.event_type)
            driver = (
                stream.state.drivers.get(event.driver_number)
                if event.driver_number is not None
                else None
            )
            stream.broadcaster.publish(
                {
                    "type": "race_update",
                    "event": {
                        "source": event.source,
                        "event_type": event_type,
                        "driver_number": event.driver_number,
                        "event_ts": event.event_ts.isoformat(),
                        "source_timestamp": event.event_ts.isoformat(),
                        "observed_at": event.payload.get("observed_at"),
                        "received_at": event.payload.get("received_at"),
                        "source_id": event.source_id,
                        "provenance": event.payload.get("provenance"),
                        "data_age_seconds": event.payload.get("data_age_seconds"),
                        "stale": event.payload.get("stale", False),
                        "payload": event.payload,
                    },
                    "race_state": {
                        "lap": stream.state.lap,
                        "track_status": stream.state.track_status,
                        "driver": driver.__dict__ if driver is not None else None,
                    },
                    "prediction": prediction,
                    "ts": datetime.now(UTC).isoformat(),
                }
            )
            await asyncio.sleep(0)
    finally:
        stream.broadcaster.close()


@app.websocket("/ws/race")
async def ws_race(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    if not settings.is_origin_allowed(origin):
        await websocket.close(code=1008, reason="origin not allowed")
        return
    params = websocket.query_params
    replay_id = params.get("replay_id")
    source = params.get("source")
    speed = params.get("speed", "20x")
    replay_entry: ReplayStream | None = None
    match source:
        case "live":
            if replay_id is not None or speed != "20x":
                await websocket.close(
                    code=1008, reason="live source does not accept replay parameters"
                )
                return
            broadcaster = live_broadcaster
            if live_recorder is None or broadcaster is None:
                await websocket.close(code=1008, reason="live source is not running")
                return
        case None:
            if replay_id not in replay_sessions:
                await websocket.close(code=1008, reason="unknown replay_id")
                return
            if speed not in {"1x", "5x", "20x", "MAX"}:
                await websocket.close(code=1008, reason="invalid replay speed")
                return
            replay = replay_sessions[replay_id]
            entry = replay_broadcasters.get(replay_id)
            if (
                entry is None
                or entry.producer is None
                or entry.producer.done()
                or entry.broadcaster.is_closed
            ):
                state = RaceState(session_id=replay.id)
                shared = RaceBroadcaster(lambda: _race_snapshot(state))
                entry = ReplayStream(replay, speed, state, shared)
                replay_broadcasters[replay_id] = entry
            if entry.speed != speed:
                await websocket.close(
                    code=1008, reason="replay already running at a different speed"
                )
                return
            broadcaster = entry.broadcaster
            replay_entry = entry
        case _:
            await websocket.close(code=1008, reason="invalid source")
            return

    subscriber = broadcaster.subscribe()
    if replay_entry is not None and replay_entry.producer is None:
        replay_entry.producer = asyncio.create_task(_produce_replay(replay_entry))
    await websocket.accept()
    connected_clients.add(websocket)
    try:
        await websocket.send_json(
            {"type": "connected", "speed": speed, "model_version": model_version}
        )
        while True:
            frame = await subscriber.get()
            if frame is None:
                await websocket.close(code=1000)
                break
            await websocket.send_json(frame)
            if broadcaster.is_closed and subscriber.empty():
                await websocket.close(code=1000)
                break
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.unsubscribe(subscriber)
        connected_clients.discard(websocket)


# Routers can be included here (e.g. from pitwall_api.routes import health_router)
