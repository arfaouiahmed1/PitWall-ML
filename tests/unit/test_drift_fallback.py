"""Regression tests for drift helpers — fallback vs scipy and psi finite."""

from __future__ import annotations

import sys

import numpy as np
import pytest
from scipy.stats import wasserstein_distance

from pitwall.monitoring import drift_era as mod


def test_wasserstein_fallback_matches_scipy_on_unequal_sizes(monkeypatch) -> None:
    rng = np.random.default_rng(7)
    ref = rng.normal(0, 1, 1000)
    cur = rng.normal(0.5, 1, 100)
    expected = wasserstein_distance(ref, cur)
    monkeypatch.setitem(sys.modules, "scipy.stats", None)
    result = mod._wasserstein_distance(ref, cur)
    assert result == pytest.approx(expected, rel=1e-6)


def test_wasserstein_fallback_no_scipy_equal_sizes(monkeypatch) -> None:
    rng = np.random.default_rng(8)
    ref = rng.normal(0, 1, 500)
    cur = rng.normal(0, 1, 500)
    expected = wasserstein_distance(ref, cur)
    monkeypatch.setitem(sys.modules, "scipy.stats", None)
    result = mod._wasserstein_distance(ref, cur)
    assert result == pytest.approx(expected, rel=1e-6)


def test_psi_returns_finite() -> None:
    rng = np.random.default_rng(9)
    ref = rng.normal(0, 1, 1000)
    cur = rng.normal(0.2, 1, 1000)
    psi = mod._psi(ref, cur)
    assert np.isfinite(psi)
    assert psi >= 0


def test_psi_identical_distributions_near_zero() -> None:
    rng = np.random.default_rng(10)
    ref = rng.normal(0, 1, 5000)
    cur = rng.normal(0, 1, 5000)
    psi = mod._psi(ref, cur)
    assert psi < 0.1  # same distribution -> low PSI
