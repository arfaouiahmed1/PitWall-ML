"""FastAPI entrypoint — PitWall ML serving layer."""

from __future__ import annotations

import asyncio
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
model_version = "demo-v0"


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    # Try to load champion model
    global ml_model, model_version
    try:
        from pitwall.registry.mlflow_utils import load_champion

        ml_model = load_champion()
        model_version = "champion"
    except Exception:
        # fallback: no model, use heuristic
        ml_model = None
    yield


app = FastAPI(title="PitWall ML API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    """Return current pace predictions for all drivers in state."""
    preds: list[dict[str, Any]] = []
    for dn, ds in race_state.drivers.items():
        # Heuristic prediction if no model
        base = ds.last_lap_s or 90.0
        # Add tyre age penalty
        age = ds.tyre_age or 0
        point = base + age * 0.08 + (0.1 if ds.compound == "SOFT" else 0)
        preds.append(
            PacePrediction(
                driver_number=dn,
                lap_number=ds.last_lap_no,
                q10=round(point - 0.55, 3),
                q50=round(point, 3),
                q90=round(point + 0.65, 3),
                model_version=model_version,
            ).model_dump()
        )
    return preds


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

            # Generate prediction for that driver
            dn = event.driver_number
            pred = None
            if dn is not None and dn in race_state.drivers:
                ds = race_state.drivers[dn]
                base = ds.last_lap_s or 90.0
                age = ds.tyre_age or 0
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
            await websocket.send_json(msg)

            # Small yield
            await asyncio.sleep(0)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        connected_clients.discard(websocket)


# Routers can be included here (e.g. from pitwall_api.routes import health_router)
