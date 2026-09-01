"""Regression tests for CarProfile isolation and epoch handling."""

from __future__ import annotations

from datetime import date

import pytest

from pitwall.car_profile import CHASSIS_2026, get_car_profile


def test_get_car_profile_order_independent() -> None:
    # Two calls with different as_of dates should not leak epoch state
    p1 = get_car_profile("McLaren", season=2026, as_of=date(2026, 3, 20))
    p2 = get_car_profile("McLaren", season=2026, as_of=date(2026, 7, 30))
    p1_again = get_car_profile("McLaren", season=2026, as_of=date(2026, 3, 20))
    assert p1 is not None and p2 is not None and p1_again is not None
    # p1 and p1_again should have same epoch despite intervening call with later date
    assert p1.chassis.current_epoch_name == p1_again.chassis.current_epoch_name
    assert p1.chassis.current_epoch_name != p2.chassis.current_epoch_name


def test_get_car_profile_no_applicable_epoch_resets_to_launch() -> None:
    # Date before any epoch should reset to launch, not inherit previous
    _ = get_car_profile("McLaren", season=2026, as_of=date(2026, 7, 30))
    p_early = get_car_profile("McLaren", season=2026, as_of=date(2026, 1, 1))
    assert p_early is not None
    assert p_early.chassis.current_epoch_name == "launch"


def test_get_car_profile_does_not_mutate_shared_chassis() -> None:
    chassis_before = CHASSIS_2026["MCL40"].current_epoch_name
    _ = get_car_profile("McLaren", season=2026, as_of=date(2026, 7, 30))
    chassis_after = CHASSIS_2026["MCL40"].current_epoch_name
    assert chassis_before == chassis_after  # shared object not mutated


def test_current_performance_twice_without_registry_change() -> None:
    p = get_car_profile("McLaren", season=2026, as_of=date(2026, 6, 1))
    assert p is not None
    perf1 = p.current_performance()
    perf2 = p.current_performance()
    assert perf1.high_speed_deployment == pytest.approx(perf2.high_speed_deployment)
    assert perf1.peak_acceleration == pytest.approx(perf2.peak_acceleration)
    # Mutating returned vector must not affect next call
    perf1.high_speed_deployment = 0.0
    perf3 = p.current_performance()
    assert perf3.high_speed_deployment != 0.0


def test_performance_at_returns_copy() -> None:
    chassis = CHASSIS_2026["MCL40"]
    v1 = chassis.performance_at(date(2026, 1, 1))
    v1.high_speed = 0.0
    v2 = chassis.performance_at(date(2026, 1, 1))
    assert v2.high_speed != 0.0


def test_launch_vs_later_performance_delta() -> None:
    p_launch = get_car_profile("McLaren", season=2026, as_of=date(2026, 3, 16))
    p_later = get_car_profile("McLaren", season=2026, as_of=date(2026, 7, 30))
    assert p_launch is not None and p_later is not None
    perf_launch = p_launch.current_performance()
    perf_later = p_later.current_performance()
    assert p_launch.chassis.current_epoch_name != p_later.chassis.current_epoch_name
    assert (
        perf_launch.high_speed != perf_later.high_speed
        or perf_launch.traction != perf_later.traction
        or perf_launch.energy_efficiency != perf_later.energy_efficiency
    )


def test_performance_at_none_uses_current_epoch_not_latest() -> None:
    p_early = get_car_profile("Red Bull Racing", season=2026, as_of=date(2026, 3, 16))
    assert p_early is not None
    perf_none = p_early.chassis.performance_at(None)
    perf_launch = p_early.chassis.performance_at(date(2026, 3, 16))
    assert perf_none.high_speed == pytest.approx(perf_launch.high_speed)
    assert perf_none.traction == pytest.approx(perf_launch.traction)
