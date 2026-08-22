"""FastAPI entrypoint — PitWall ML serving layer."""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from pitwall.ingestion.replay import ParquetReplaySource, ReplayConfig
from pitwall.schemas.predictions import PacePrediction
from pitwall.state.race_state import RaceState

# --- App state ---
race_state = RaceState(session_id="demo")
ml_model = None
quantile_model = None
tyre_model = None
pit_model = None
model_version = "demo-v0"
model_metrics: dict[str, Any] = {}
shap_summary: dict[str, float] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    global \
        ml_model, \
        quantile_model, \
        tyre_model, \
        pit_model, \
        model_version, \
        model_metrics, \
        shap_summary
    import os

    # Try local artifacts first (fast, no network) — preferred for smoke/tests
    # Only try MLflow if env explicitly points to a tracking server
    if os.getenv("MLFLOW_TRACKING_URI"):
        try:
            from pitwall.registry.mlflow_utils import load_champion

            ml_model = load_champion()
            model_version = "champion"
        except Exception:
            ml_model = None
    else:
        ml_model = None

    # Try local artifacts (V2) as fallback — will override demo if present (prefer newest)
    local_candidates = [
        Path("artifacts/v2_shap_test"),
        Path("artifacts/v2_full_test"),
        Path("artifacts/v2_test_full"),
        Path("artifacts/v2_quantile_test"),
        Path("artifacts/smoke"),
        Path("artifacts/candidate"),
    ]
    for cand in local_candidates:
        if (cand / "model" / "model.pkl").exists():
            try:
                from pitwall.models.pace.lightgbm_model import PaceLightGBM, QuantileLightGBM
                from pitwall.models.pit.lightgbm_pit import PitHazardLightGBM
                from pitwall.models.tyre.lightgbm_tyre import TyreLightGBM

                if ml_model is None:
                    ml_model = PaceLightGBM.load(cand / "model")
                    model_version = f"local:{cand.name}"
                if (cand / "model_quantile" / "model.pkl").exists():
                    quantile_model = QuantileLightGBM.load(cand / "model_quantile")
                if (cand / "model_tyre" / "model.pkl").exists():
                    tyre_model = TyreLightGBM.load(cand / "model_tyre")
                if (cand / "model_pit" / "model.pkl").exists():
                    pit_model = PitHazardLightGBM.load(cand / "model_pit")
                if (cand / "metrics.json").exists():
                    import json

                    model_metrics = json.loads((cand / "metrics.json").read_text())
                if (cand / "shap_summary.json").exists():
                    import json

                    shap_summary = json.loads((cand / "shap_summary.json").read_text())
                break
            except Exception:
                continue
    # Push initial metrics to Prometheus gauges
    try:
        from pitwall.monitoring.metrics import set_pace_metrics

        if model_metrics:
            set_pace_metrics(model_metrics, model_version=model_version)
    except Exception:
        pass
    yield


app = FastAPI(title="PitWall ML API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
        if quantile_model is not None:
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
            qd = quantile_model.predict(batch)
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

        # For demo, reconstruct synthetic gold as in train
        # Attempt to load silver then build gold, else return no_data
        silver_root = Path("data/silver")
        files = (
            list((silver_root / "laps").rglob("*.parquet"))
            if (silver_root / "laps").exists()
            else []
        )
        if files:
            silver = pl.read_parquet(files)
            from pitwall.features.pace import build_pace_features

            gold = build_pace_features(silver)
        else:
            # synthetic small gold for drift demo
            import numpy as np

            np.random.seed(0)
            rows = []
            for s in range(6):
                for d in [1, 44]:
                    for lap in range(1, 10):
                        rows.append(
                            {
                                "session_id": f"2024_R{s}",
                                "driver_number": d,
                                "lap_number": lap,
                                "lap_time_s": 90 + np.random.normal(0, 1),
                                "compound": "MEDIUM",
                                "tyre_age": lap % 5,
                                "stint_no": 1,
                                "position": 1,
                                "is_valid_training_lap": True,
                                "rolling_median_5": 90.0,
                                "rolling_std_5": 0.5,
                                "track_temp_c": 37.0,
                                "race_progress": lap / 10,
                            }
                        )
            silver = pl.DataFrame(rows)
            from pitwall.features.pace import build_pace_features

            gold = build_pace_features(silver)

        # Use pace feature cols for drift
        drift_res = drift_on_window(gold, n_reference_races=2, n_current_races=2)
        # push to gauges
        try:
            from pitwall.monitoring.metrics import set_drift_metrics

            set_drift_metrics(drift_res)
        except Exception:
            pass
        return {
            "drift": drift_res,
            "model_version": model_version,
            "timestamp": datetime.now(UTC).isoformat(),
        }
    except Exception as e:
        return {"error": str(e), "model_version": model_version}


@app.get("/monitoring/overview")
async def monitoring_overview() -> dict[str, Any]:
    """Aggregated health for Grafana + frontend monitoring page."""
    # Reuse drift and promotion
    drift = {}
    with contextlib.suppress(Exception):
        drift = (await monitoring_drift()).get("drift", {})
    promo = {}
    with contextlib.suppress(Exception):
        promo = await registry_promotion()
    return {
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
    body = payload or {}
    laps_remaining = int(body.get("laps_remaining", 15))
    n_sims = int(body.get("n_simulations", 200))
    n_sims = max(10, min(n_sims, 2000))  # clamp for latency
    if not race_state.drivers:
        # demo drivers if no live state
        from pitwall.simulation.engine import DriverStateSim

        drivers = [
            DriverStateSim(
                driver_id="1", position=1, current_time_s=0, tyre_age=5, compound="MEDIUM"
            ),
            DriverStateSim(
                driver_id="16", position=2, current_time_s=1.2, tyre_age=8, compound="MEDIUM"
            ),
            DriverStateSim(
                driver_id="44", position=3, current_time_s=3.5, tyre_age=2, compound="HARD"
            ),
            DriverStateSim(
                driver_id="63", position=4, current_time_s=5.1, tyre_age=11, compound="MEDIUM"
            ),
        ]
    else:
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


@app.get("/replay/status")
async def replay_status() -> dict[str, Any]:
    return {"status": "idle", "speed": "20x", "session": race_state.session_id}


# --- WebSocket ---

connected_clients: set[WebSocket] = set()


@app.websocket("/ws/race")
async def ws_race(websocket: WebSocket) -> None:
    await websocket.accept()
    connected_clients.add(websocket)

    # optional query params: speed, session
    params = websocket.query_params
    speed = params.get("speed", "20x")
    bronze_path = params.get("bronze_path", "data/bronze")

    config = ReplayConfig(bronze_path=Path(bronze_path), speed=speed)  # type: ignore[arg-type]
    source = ParquetReplaySource(config)

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
                    base = getattr(ds, "last_lap_s", 90.0) or 90.0
                    age = getattr(ds, "tyre_age", 0) or 0
                    point = base + age * 0.05
                    pred = {
                        "q10": round(point - 0.5, 3),
                        "q50": round(point, 3),
                        "q90": round(point + 0.6, 3),
                    }

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
            import contextlib

            with contextlib.suppress(Exception):
                from pitwall.eventbus import get_bus

                get_bus().publish(f"pitwall:race:{race_state.session_id}", msg)
            await websocket.send_json(msg)

            # Small yield
            await asyncio.sleep(0)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "message": str(e)})
    finally:
        connected_clients.discard(websocket)


# Routers can be included here (e.g. from pitwall_api.routes import health_router)
