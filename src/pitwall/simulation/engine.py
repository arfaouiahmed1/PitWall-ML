"""Monte Carlo race outcome simulator (V2)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class DriverStateSim:
    driver_id: str
    position: int
    current_time_s: float = 0.0
    gap_to_leader_s: float = 0.0
    compound: str = "MEDIUM"
    tyre_age: int = 0


def simulate_race(
    drivers: list[DriverStateSim], n_simulations: int = 5000, laps_remaining: int = 20
) -> dict[str, float]:
    """Stub — V2 will sample pace + pit hazard to estimate finishing distributions."""
    # For V1, return uniform
    n = len(drivers)
    return {d.driver_id: 1.0 / n for d in drivers}
