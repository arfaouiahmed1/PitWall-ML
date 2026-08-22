"""Conformalized Quantile Regression calibration (Romano et al., 2019).

CQR wraps any quantile regressor and adjusts its intervals with a finite-sample
correction so marginal coverage holds at ``1 - alpha`` under exchangeability,
without distributional assumptions.
"""

from __future__ import annotations

from typing import Self

import numpy as np


class ConformalQuantileCalibrator:
    """CQR calibrator for symmetric widening of quantile intervals.

    Fit on held-out *validation* predictions (never test). Stores two state
    attributes after :meth:`fit`:

    - ``q_hat_``: conformal correction; the interval widens to
      ``[q10 - q_hat_, q90 + q_hat_]``.
    - ``d_``: median shift ``median(y - q50)`` applied as a point correction.

    Mutation of these attributes inside :meth:`fit` is the documented purpose
    of this class (sklearn-estimator style); it is otherwise immutable.
    """

    def __init__(self) -> None:
        self.q_hat_: float | None = None
        self.d_: float | None = None

    def fit(
        self,
        y_val: np.ndarray,
        q10_val: np.ndarray,
        q50_val: np.ndarray,
        q90_val: np.ndarray,
        alpha: float = 0.2,
    ) -> Self:
        """Fit the conformal correction on validation predictions.

        Conformity scores follow Romano et al. (2019), eq. 2:
        ``E_i = max(q10_i - y_i, y_i - q90_i)`` — negative when the raw
        interval over-covers a point, positive when it misses. The stored
        correction is the ``ceil((n+1)(1-alpha))/n`` empirical quantile of E
        (order-statistic level, clamped into [0, 1] for small n).
        """
        if not (0.0 < alpha < 1.0):
            raise CalibrationError(field="alpha", value=alpha, reason="must be in (0, 1)")
        arrays = {"y_val": y_val, "q10_val": q10_val, "q50_val": q50_val, "q90_val": q90_val}
        lengths = {name: len(a) for name, a in arrays.items()}
        if len(set(lengths.values())) > 1 or next(iter(lengths.values())) == 0:
            raise CalibrationError(
                field="arrays", value=lengths, reason="must be non-empty and equal length"
            )

        scores = np.maximum(q10_val - y_val, y_val - q90_val)
        n = scores.shape[0]
        level = min(float(np.ceil((n + 1) * (1.0 - alpha))) / n, 1.0)
        self.q_hat_ = float(np.quantile(scores, level))
        self.d_ = float(np.median(y_val - q50_val))
        return self

    def params(self) -> dict[str, float]:
        """Fitted parameters as a JSON-ready dict (``{"q_hat": ..., "d": ...}``)."""
        if self.q_hat_ is None or self.d_ is None:
            raise CalibrationError(field="state", value=None, reason="params called before fit")
        return {"q_hat": self.q_hat_, "d": self.d_}

    def transform(
        self, q10: np.ndarray, q50: np.ndarray, q90: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Apply the fitted correction; returns monotone ``(q10c, q50c, q90c)``."""
        if self.q_hat_ is None or self.d_ is None:
            raise CalibrationError(field="state", value=None, reason="transform called before fit")
        lo = q10 - self.q_hat_
        hi = q90 + self.q_hat_
        mid = q50 + self.d_
        lo, hi = np.minimum(lo, hi), np.maximum(lo, hi)
        mid = np.clip(mid, lo, hi)
        return lo, mid, hi


class CalibrationError(ValueError):
    """Raised when the calibrator receives invalid inputs or is unfitted."""

    def __init__(self, field: str, value: float | dict[str, int] | None, reason: str) -> None:
        self.field = field
        self.value = value
        self.reason = reason
        super().__init__(f"calibration input '{field}'={value!r}: {reason}")
