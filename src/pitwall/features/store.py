"""Local parquet-backed feature store with point-in-time joins (Feast-style).

Zero external dependencies beyond polars. Each feature view is stored as
``root/<name>/data.parquet`` plus a ``meta.json`` descriptor. Historical
retrieval is point-in-time correct: a query row only ever sees stored rows
whose event timestamp is <= the query timestamp (backward as-of join per
entity key), so no future values can leak into training data.
"""

from __future__ import annotations

import json
import warnings
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import polars as pl

# Sentinel event timestamp for views registered from frames without time info.
_EPOCH_TS = datetime(1970, 1, 1)

_ENTITY_KEYS = ["session_id", "driver_number"]

_PACE_FEATURES = [
    "rolling_median_3",
    "rolling_median_5",
    "rolling_std_5",
    "tyre_age",
    "stint_no",
    "lap_number",
    "position",
    "race_progress",
    "compound",
    "next_clean_lap_s",
]
_TYRE_FEATURES = ["tyre_age", "stint_no", "compound"]
_PIT_FEATURES = ["tyre_age", "stint_no", "position", "compound", "race_progress"]


@dataclass
class FeatureView:
    """Definition of one feature group: entity keys, event timestamp and features."""

    name: str
    entities: list[str]
    event_ts_col: str = "event_ts"
    features: list[str] = field(default_factory=list)  # [] = all non-entity/non-ts columns
    ttl_days: float = 365.0


class FeatureStore:
    """Filesystem feature store: register views, serve historical/online features."""

    def __init__(self, root: str | Path = "data/store") -> None:
        """Create the store root directory if missing."""
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _view_dir(self, name: str) -> Path:
        return self.root / name

    def _load(self, view_name: str) -> tuple[FeatureView, pl.DataFrame]:
        """Load a view's metadata and data; raise FileNotFoundError if unregistered."""
        meta_path = self._view_dir(view_name) / "meta.json"
        if not meta_path.exists():
            msg = f"Feature view not registered: {view_name!r} under {self.root}"
            raise FileNotFoundError(msg)
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        view = FeatureView(
            name=meta["name"],
            entities=meta["entities"],
            event_ts_col=meta["event_ts_col"],
            features=meta["features"],
            ttl_days=meta["ttl_days"],
        )
        return view, pl.read_parquet(self._view_dir(view_name) / "data.parquet")

    def register(self, view: FeatureView, df: pl.DataFrame) -> Path:
        """Persist ``view`` from ``df`` as parquet + meta.json; return the data path.

        Only entity keys, the event timestamp column and feature columns are kept.
        If the frame lacks ``event_ts_col`` it is synthesized as a constant column
        so the stored data and metadata stay consistent.
        """
        entities = [c for c in view.entities if c in df.columns]
        if view.features:
            features = [c for c in view.features if c in df.columns]
        else:
            skip = {*entities, view.event_ts_col}
            features = [c for c in df.columns if c not in skip]

        has_ts = view.event_ts_col in df.columns
        select_cols = (
            [*entities, *features]
            if not has_ts
            else [
                *entities,
                view.event_ts_col,
                *features,
            ]
        )
        out = df.select(select_cols)
        if not has_ts:
            out = out.with_columns(pl.lit(_EPOCH_TS).alias(view.event_ts_col))

        view_dir = self._view_dir(view.name)
        view_dir.mkdir(parents=True, exist_ok=True)
        data_path = view_dir / "data.parquet"
        out.write_parquet(data_path)
        meta = {
            "name": view.name,
            "entities": entities,
            "event_ts_col": view.event_ts_col,
            "features": features,
            "ttl_days": view.ttl_days,
            "rows": out.height,
        }
        (view_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return data_path

    def list_views(self) -> list[dict]:
        """Return the metadata dict of every registered view."""
        return [
            json.loads(p.read_text(encoding="utf-8")) for p in sorted(self.root.glob("*/meta.json"))
        ]

    @staticmethod
    def _resolve_features(view: FeatureView, feature_refs: list[str] | None) -> list[str]:
        """Map optional feature refs (``view:feature`` or bare names) to stored columns."""
        if not feature_refs:
            return view.features
        wanted = {ref.split(":")[-1] for ref in feature_refs}
        return [f for f in view.features if f in wanted]

    def get_historical_features(
        self, entity_df: pl.DataFrame, view_name: str, feature_refs: list[str] | None = None
    ) -> pl.DataFrame:
        """Point-in-time join of stored features onto ``entity_df``.

        With an event timestamp on the query frame, each row is matched to the
        latest stored row at or before its timestamp per entity key (backward
        as-of join) — future rows are never visible. Without a timestamp, the
        latest stored row per entity is left-joined on the keys instead.
        """
        view, stored = self._load(view_name)
        keys = [k for k in view.entities if k in entity_df.columns and k in stored.columns]
        features = self._resolve_features(view, feature_refs)
        ts = view.event_ts_col

        if ts in entity_df.columns:
            right = stored.select([*keys, ts, *features]).sort(ts).set_sorted(ts)
            left = entity_df.sort(ts).set_sorted(ts)
            # Sortedness is guaranteed by construction above; polars cannot verify
            # it per 'by' group and always warns, so silence that false positive.
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", message=".*Sortedness of columns.*")
                return left.join_asof(right, on=ts, by=keys or None, strategy="backward")
        latest = stored.sort(ts).group_by(keys).last()
        return entity_df.join(latest, on=keys, how="left")

    def get_online_features(self, view_name: str, entity_keys: dict) -> dict:
        """Serve the latest stored row for one entity as a flat column→value dict."""
        view, stored = self._load(view_name)
        for key, value in entity_keys.items():
            if key in stored.columns:
                stored = stored.filter(pl.col(key) == value)
        if stored.is_empty():
            return {}
        return stored.sort(view.event_ts_col).tail(1).to_dicts()[0]


def materialize_gold_store(gold: pl.DataFrame, root: str | Path = "data/store") -> FeatureStore:
    """Register the standard pace/tyre/pit views from a Gold table into a new store.

    Feature lists are intersected with the columns actually available so any
    Gold schema variant registers cleanly.
    """
    fs = FeatureStore(root)
    entities = [c for c in _ENTITY_KEYS if c in gold.columns]
    specs: dict[str, list[str]] = {
        "pace": _PACE_FEATURES,
        "tyre": _TYRE_FEATURES,
        "pit": _PIT_FEATURES,
    }
    for name, wanted in specs.items():
        available = [c for c in wanted if c in gold.columns]
        fs.register(FeatureView(name=name, entities=entities, features=available), gold)
    return fs
