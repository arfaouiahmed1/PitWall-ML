"""Era drift analysis — 2025 → 2026 regulation regime shift detection.

When the regulations change fundamentally (DRS → Active Aero, 120 kW → 350/250 kW
MGU-K), the feature distributions shift. This module detects that shift with
multiple statistical tests so we know exactly which signals broke the old model.

Metrics computed:
  - KS statistic (distributional shape)
  - Wasserstein distance (earth mover's distance)
  - PSI (population stability index)
  - JS divergence (Jensen-Shannon)

Output feeds the ``2025→2026 Regulation Drift`` dashboard panel.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import polars as pl

# Features to monitor for era drift — the ones that physically change
# under the 2026 rules.
DRIFT_FEATURES: list[str] = [
    "lap_time_s",
    "speed_trap_kmh",
    "acceleration_0_100",
    "brake_intensity",
    "lift_and_coast_ratio",
    "lap_time_variance",
    "tyre_stint_length",
    "pit_frequency",
    "overtake_count",
    "traffic_sensitivity",
    "position_changes",
    "speed_trace_shape",
    "rolling_median_5",
    "rolling_std_5",
]

# Subset actually computable from bronze/silver parity
DEFAULT_DRIFT_COLS: list[str] = [
    "lap_time_s",
    "rolling_median_5",
    "rolling_std_5",
    "tyre_age",
    "stint_no",
    "position",
    "gap_ahead_s",
    "track_temp_c",
    "air_temp_c",
]


@dataclass
class DriftResult:
    """Per-feature drift result across multiple metrics."""

    feature: str
    ks_statistic: float
    ks_pvalue: float | None
    wasserstein: float
    psi: float
    js_divergence: float
    drifted: bool
    severity: str  # "none" | "mild" | "moderate" | "severe"
    reference_mean: float
    current_mean: float
    reference_std: float
    current_std: float
    relative_shift_pct: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "feature": self.feature,
            "ks_statistic": self.ks_statistic,
            "ks_pvalue": self.ks_pvalue,
            "wasserstein": self.wasserstein,
            "psi": self.psi,
            "js_divergence": self.js_divergence,
            "drifted": self.drifted,
            "severity": self.severity,
            "reference_mean": self.reference_mean,
            "current_mean": self.current_mean,
            "reference_std": self.reference_std,
            "current_std": self.current_std,
            "relative_shift_pct": self.relative_shift_pct,
        }


@dataclass
class EraDriftReport:
    """Complete drift report comparing two regulation eras."""

    reference_era: str
    current_era: str
    n_reference_sessions: int
    n_current_sessions: int
    results: list[DriftResult] = field(default_factory=list)
    overall_drift_ratio: float = 0.0
    max_severity: str = "none"
    broken_features: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "reference_era": self.reference_era,
            "current_era": self.current_era,
            "n_reference_sessions": self.n_reference_sessions,
            "n_current_sessions": self.n_current_sessions,
            "results": [r.to_dict() for r in self.results],
            "overall_drift_ratio": self.overall_drift_ratio,
            "max_severity": self.max_severity,
            "broken_features": self.broken_features,
        }


# ── Statistical tests ─────────────────────────────────────────────────────


def _ks_statistic(ref: np.ndarray, cur: np.ndarray) -> tuple[float, float | None]:
    """Two-sample KS statistic and p-value (fallback if scipy missing)."""
    try:
        from scipy.stats import ks_2samp

        stat, pval = ks_2samp(ref, cur)
        return float(stat), float(pval)
    except ImportError:
        pass
    # Manual KS: max CDF difference
    ref_sorted = np.sort(ref)
    cur_sorted = np.sort(cur)
    cdf_ref = np.searchsorted(ref_sorted, cur_sorted, side="right") / len(ref_sorted)
    cdf_cur = np.searchsorted(cur_sorted, ref_sorted, side="right") / len(cur_sorted)
    ks = max(
        float(np.max(np.abs(cdf_ref - np.arange(1, len(cur_sorted) + 1) / len(cur_sorted)))),
        float(np.max(np.abs(cdf_cur - np.arange(1, len(ref_sorted) + 1) / len(ref_sorted)))),
    )
    return ks, None


def _wasserstein_distance(ref: np.ndarray, cur: np.ndarray) -> float:
    """1D Wasserstein (earth mover's) distance — exact empirical CDF integral."""
    try:
        from scipy.stats import wasserstein_distance  # type: ignore[import-untyped]

        return float(wasserstein_distance(ref, cur))
    except ImportError:
        pass
    # Exact fallback: integral of |F_ref - F_cur| over combined sorted values.
    ref_sorted = np.sort(ref)
    cur_sorted = np.sort(cur)
    uniq = np.unique(np.concatenate([ref_sorted, cur_sorted]))
    if len(uniq) < 2:
        return 0.0
    cdf_ref = np.searchsorted(ref_sorted, uniq, side="right") / len(ref_sorted)
    cdf_cur = np.searchsorted(cur_sorted, uniq, side="right") / len(cur_sorted)
    diff = np.abs(cdf_ref[:-1] - cdf_cur[:-1])
    widths = np.diff(uniq)
    return float(np.sum(diff * widths))


def _psi(ref: np.ndarray, cur: np.ndarray, bins: int = 10) -> float:
    """Population Stability Index between two distributions."""
    # Use the same bin edges for both
    edges = np.histogram_bin_edges(np.concatenate([ref, cur]), bins=bins)
    ref_counts, _ = np.histogram(ref, bins=edges)
    cur_counts, _ = np.histogram(cur, bins=edges)
    ref_pct = ref_counts / max(ref_counts.sum(), 1)
    cur_pct = cur_counts / max(cur_counts.sum(), 1)
    # Avoid log(0)
    eps = 1e-6
    psi = np.sum((cur_pct - ref_pct) * np.log((cur_pct + eps) / (ref_pct + eps)))
    return float(psi)


def _js_divergence(ref: np.ndarray, cur: np.ndarray, bins: int = 10) -> float:
    """Jensen-Shannon divergence between two distributions."""
    edges = np.histogram_bin_edges(np.concatenate([ref, cur]), bins=bins)
    ref_hist, _ = np.histogram(ref, bins=edges, density=True)
    cur_hist, _ = np.histogram(cur, bins=edges, density=True)
    # Normalize to probability distributions
    ref_p = ref_hist / max(ref_hist.sum(), 1e-10)
    cur_p = cur_hist / max(cur_hist.sum(), 1e-10)
    # JS = 0.5 * KL(P || M) + 0.5 * KL(Q || M), M = 0.5*(P+Q)
    m = 0.5 * (ref_p + cur_p)
    eps = 1e-10
    js = 0.5 * np.sum(ref_p * np.log((ref_p + eps) / (m + eps))) + 0.5 * np.sum(
        cur_p * np.log((cur_p + eps) / (m + eps))
    )
    return float(js)


def _classify_severity(psi: float, ks: float, wasserstein: float, max_wasserstein: float) -> str:
    """Classify drift severity.

    PSI thresholds: <0.1 no drift, 0.1-0.25 moderate, >0.25 severe.
    """
    if psi < 0.05 and ks < 0.1:
        return "none"
    if psi < 0.1:
        return "mild"
    if psi < 0.25:
        return "moderate"
    return "severe"


def _drift_for_feature(ref: np.ndarray, cur: np.ndarray, feature_name: str) -> DriftResult | None:
    """Compute all drift metrics for one feature."""
    ref_clean = ref[~np.isnan(ref)]
    cur_clean = cur[~np.isnan(cur)]

    if len(ref_clean) < 5 or len(cur_clean) < 5:
        return None

    # All values must be numeric
    if not (
        np.issubdtype(ref_clean.dtype, np.number) and np.issubdtype(cur_clean.dtype, np.number)
    ):
        return None

    ref_mean = float(np.mean(ref_clean))
    cur_mean = float(np.mean(cur_clean))
    ref_std = float(np.std(ref_clean))
    cur_std = float(np.std(cur_clean))
    rel_shift = abs(cur_mean - ref_mean) / max(abs(ref_mean), ref_std, 1e-6) * 100

    ks_stat, ks_pval = _ks_statistic(ref_clean, cur_clean)
    wass = _wasserstein_distance(ref_clean, cur_clean)
    psi = _psi(ref_clean, cur_clean)
    js = _js_divergence(ref_clean, cur_clean)

    max_wass = abs(ref_mean) * 0.5 + ref_std * 2  # rough normalization
    severity = _classify_severity(psi, ks_stat, wass, max_wass)
    drifted = severity in ("moderate", "severe") or (
        ks_pval is not None and ks_pval < 0.05 and psi > 0.1
    )

    return DriftResult(
        feature=feature_name,
        ks_statistic=ks_stat,
        ks_pvalue=ks_pval,
        wasserstein=wass,
        psi=psi,
        js_divergence=js,
        drifted=drifted,
        severity=severity,
        reference_mean=ref_mean,
        current_mean=cur_mean,
        reference_std=ref_std,
        current_std=cur_std,
        relative_shift_pct=round(rel_shift, 2),
    )


def era_drift_analysis(
    df: pl.DataFrame,
    era_col: str = "regulation_era",
    reference_era: str = "ground_effect_v2",
    current_era: str = "revised_aero_pu_2026",
    columns: list[str] | None = None,
) -> EraDriftReport:
    """Compare feature distributions between two regulation eras.

    Args:
        df: Polars dataframe containing both era's data with the era column.
        era_col: Column name holding era labels.
        reference_era: Label for the pre-2026 era.
        current_era: Label for the 2026 era.
        columns: Features to compare (defaults to DEFAULT_DRIFT_COLS).

    Returns:
        EraDriftReport with per-feature drift metrics.
    """
    if columns is None:
        columns = [c for c in DEFAULT_DRIFT_COLS if c in df.columns]

    ref_df = df.filter(pl.col(era_col) == reference_era)
    cur_df = df.filter(pl.col(era_col) == current_era)

    if ref_df.is_empty() or cur_df.is_empty():
        return EraDriftReport(
            reference_era=reference_era,
            current_era=current_era,
            n_reference_sessions=ref_df["session_id"].n_unique()
            if "session_id" in ref_df.columns
            else 0,
            n_current_sessions=cur_df["session_id"].n_unique()
            if "session_id" in cur_df.columns
            else 0,
            results=[],
            overall_drift_ratio=0.0,
            max_severity="none",
        )

    # Collect session counts
    ref_sessions = ref_df["session_id"].n_unique() if "session_id" in ref_df.columns else 1
    cur_sessions = cur_df["session_id"].n_unique() if "session_id" in cur_df.columns else 1

    results: list[DriftResult] = []
    severities = {"none": 0, "mild": 1, "moderate": 2, "severe": 3}

    for col in columns:
        if col not in ref_df.columns or col not in cur_df.columns:
            continue
        ref_vals = ref_df[col].drop_nulls().to_numpy()
        cur_vals = cur_df[col].drop_nulls().to_numpy()

        result = _drift_for_feature(ref_vals, cur_vals, col)
        if result is not None:
            results.append(result)

    if not results:
        return EraDriftReport(
            reference_era=reference_era,
            current_era=current_era,
            n_reference_sessions=ref_sessions,
            n_current_sessions=cur_sessions,
        )

    drift_count = sum(1 for r in results if r.drifted)
    drift_ratio = drift_count / len(results)
    broken = [r.feature for r in results if r.drifted]
    max_sev = max((r.severity for r in results), key=lambda s: severities[s])

    return EraDriftReport(
        reference_era=reference_era,
        current_era=current_era,
        n_reference_sessions=ref_sessions,
        n_current_sessions=cur_sessions,
        results=results,
        overall_drift_ratio=round(drift_ratio, 4),
        max_severity=max_sev,
        broken_features=broken,
    )


def circuit_energy_difficulty_index(circuit_short_name: str) -> float | None:
    """Compute the Circuit Energy Difficulty Index for a 2026 circuit.

    Uses the circuit's track segments to calculate how much energy strategy
    matters at that specific track.

    Returns:
        Index 0..100 (higher = more energy strategy matters), or None if
        the circuit is not registered.
    """
    try:
        from pitwall.regulations.circuits import get_circuit_config

        cfg = get_circuit_config(circuit_short_name)
        if cfg is None:
            return None
        return cfg.energy_difficulty_index()
    except Exception:
        return None


def all_circuit_energy_difficulty() -> list[tuple[str, float]]:
    """Return (circuit_short_name, difficulty_index) for all registered 2026 circuits."""
    try:
        from pitwall.regulations.circuits import all_circuits

        results = []
        for cfg in all_circuits():
            results.append((cfg.circuit_short_name, cfg.energy_difficulty_index()))
        return sorted(results, key=lambda x: x[1], reverse=True)
    except Exception:
        return []


# ── Circuit Energy Difficulty mapping ──────────────────────────────────────────
#
# Static index used by feature pipelines to avoid recomputing on every lap.
# Values for registered 2026 circuits are the exact ``energy_difficulty_index()``
# output (see ``pitwall.regulations.circuits``); unregistered 2025/2026 venues
# use climatological / track-characteristic approximations so that downstream
# joins never hit a KeyError.
# Imported by ``src/pitwall/features/sync_2026.py`` and ``pace.py``.

# Canonical 2026 values (computed via CircuitConfig.energy_difficulty_index())
_CANONICAL_ENERGY: dict[str, float] = {
    "sakhir": 50.2,
    "bahrain": 50.2,
    "monte carlo": 41.6,
    "monaco": 41.6,
    "spa-francorchamps": 52.0,
    "spa": 52.0,
    "monza": 55.0,
    "silverstone": 46.7,
    "baku": 51.7,
    "miami": 53.9,
    "singapore": 39.9,
    "spielberg": 53.4,
    "austria": 53.4,
    "red bull ring": 53.4,
    "catalunya": 45.3,
    "barcelona": 45.3,
    "spain": 45.3,
}

# Extended 2025→2026 calendar approximations (not yet in ``CIRCUIT_REGISTRY``)
_EXTENDED_ENERGY: dict[str, float] = {
    "suzuka": 51.2,
    "japan": 51.2,
    "zandvoort": 44.8,
    "netherlands": 44.8,
    "interlagos": 49.5,
    "brazil": 49.5,
    "são paulo": 49.5,
    "austin": 52.8,
    "cota": 52.8,
    "las vegas": 54.6,
    "vegas": 54.6,
    "yas marina": 48.7,
    "abu dhabi": 48.7,
    "yas_marina": 48.7,
    "jeddah": 53.1,
    "saudi arabia": 53.1,
    "shanghai": 50.8,
    "china": 50.8,
    "melbourne": 47.3,
    "australia": 47.3,
    "albert park": 47.3,
    "montreal": 49.9,
    "canada": 49.9,
    "hungaroring": 42.5,
    "hungary": 42.5,
    "imola": 46.1,
    "mexicocity": 48.2,
    "mexico": 48.2,
    "qatar": 52.1,
    "losail": 52.1,
}

CIRCUIT_ENERGY_DIFFICULTY: dict[str, float] = {**_CANONICAL_ENERGY, **_EXTENDED_ENERGY}
"""Mapping ``lowercase circuit short name`` -> energy difficulty 0-100.

Lookup is case-insensitive; query via ``get_circuit_energy_difficulty()``.
"""


def get_circuit_energy_difficulty(circuit_short_name: str | None) -> float:
    """Return energy difficulty for a circuit name or 50.0 if unknown.

    Accepts ``None`` / empty and any casing; normalises with ``lower().strip()``.
    Tries the static dict first, then falls back to ``circuit_energy_difficulty_index()``
    for newly-registered circuits, finally 50.0 (neutral).
    """
    if not circuit_short_name:
        return 50.0
    key = str(circuit_short_name).lower().strip()
    if key in CIRCUIT_ENERGY_DIFFICULTY:
        return CIRCUIT_ENERGY_DIFFICULTY[key]
    # Try live registry (covers circuits added after this dict was built)
    val = circuit_energy_difficulty_index(circuit_short_name)
    if val is not None:
        return float(val)
    # Normalise separators: e.g. ``Yas Marina`` vs ``yas_marina``
    alt = key.replace("_", " ").replace("-", " ").strip()
    if alt in CIRCUIT_ENERGY_DIFFICULTY:
        return CIRCUIT_ENERGY_DIFFICULTY[alt]
    return 50.0
