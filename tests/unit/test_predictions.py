import pytest

from pitwall.schemas.predictions import PacePrediction


def test_quantiles_ordered():
    p = PacePrediction(driver_number=44, q10=89.5, q50=90.0, q90=90.6, model_version="v1")
    assert p.interval_width == pytest.approx(1.1)


def test_quantiles_must_be_ordered():
    from pydantic import ValidationError

    with pytest.raises((AssertionError, ValidationError)):
        PacePrediction(driver_number=44, q10=91.0, q50=90.0, q90=90.5, model_version="v1")
