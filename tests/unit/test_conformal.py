"""CQR calibrator — coverage on held-out data and monotone output (Q3)."""

import numpy as np
import pytest

from pitwall.evaluation.calibration import ConformalQuantileCalibrator


def test_cqr_holds_coverage_on_held_out_sample():
    # Given a heteroscedastic process and a "model" whose raw bands cover ~48%
    rng = np.random.default_rng(7)
    n_val, n_test = 500, 4000

    def band(x: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        sigma = 0.2 + np.abs(x)
        half_width = 0.5 * 1.2816 * sigma  # half the true q90 spread -> under-coverage
        return x - half_width, x, x + half_width

    def draw(x: np.ndarray) -> np.ndarray:
        return x + (0.2 + np.abs(x)) * rng.normal(size=x.shape[0])

    x_val, x_test = rng.normal(size=n_val), rng.normal(size=n_test)
    y_val, y_test = draw(x_val), draw(x_test)

    # When fitting the calibrator on validation predictions and transforming test bands
    v10, v50, v90 = band(x_val)
    calibrator = ConformalQuantileCalibrator().fit(y_val, v10, v50, v90, alpha=0.2)
    t10, _, t90 = calibrator.transform(*band(x_test))
    coverage = float(np.mean((y_test >= t10) & (y_test <= t90)))

    # Then held-out coverage lands near the 80% nominal level
    assert 0.75 <= coverage <= 0.88


def test_transform_output_is_monotone_and_shifted():
    # Given deliberately crossing input quantiles and a fitted calibrator
    rng = np.random.default_rng(3)
    n = 200
    y = rng.normal(size=n)
    q10, q50, q90 = rng.normal(size=n), rng.normal(size=n), rng.normal(size=n)
    calibrator = ConformalQuantileCalibrator().fit(y, q10, q50, q90)

    # When transforming
    lo, mid, hi = calibrator.transform(q10, q50, q90)

    # Then output is monotone and the median shift d_ is applied to q50
    assert np.all(lo <= mid)
    assert np.all(mid <= hi)
    assert calibrator.params()["d"] == pytest.approx(float(np.median(y - q50)))
