"""Car / Power Unit metadata for the 2026 regulation era.

Models the hierarchical decomposition:

    Constructor -> Chassis -> Upgrade Epoch -> Circuit Configuration

Each chassis carries a latent performance vector learnt from telemetry, so
``team="McLaren"`` is never treated as a flat categorical.  Instead the
simulator sees a multi-dimensional fingerprint that can evolve across the
season as upgrade epochs arrive.

A frozen 2026 dataset is embedded here (derived from the FIA entry list and
public upgrade announcements through August 2026).  Teams may bring major
packages at different races — those are modelled as named upgrade epochs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

# ---------------------------------------------------------------------------
# Latent performance vectors
# ---------------------------------------------------------------------------
# Each dimension is a unit-normalised latent in [0, 1] learned from telemetry.
# The names match the decomposition the user asked for.

PERF_DIMENSIONS = [
    "high_speed",
    "low_speed",
    "traction",
    "tyre_conservation",
    "energy_efficiency",
    "straight_line",
    "wet_performance",
    "reliability",
]

# Default neutral vector (0.5 everywhere)
_NEUTRAL = {dim: 0.5 for dim in PERF_DIMENSIONS}


@dataclass(frozen=True)
class PerformanceVector:
    """Latent performance fingerprint for a chassis/PU combination."""

    # Defaults are 0.0 so that partial deltas like
    # ``PerformanceVector(high_speed=0.03)`` leave unspecified dims unchanged.
    high_speed: float = 0.0
    low_speed: float = 0.0
    traction: float = 0.0
    tyre_conservation: float = 0.0
    energy_efficiency: float = 0.0
    straight_line: float = 0.0
    wet_performance: float = 0.0
    reliability: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "high_speed": self.high_speed,
            "low_speed": self.low_speed,
            "traction": self.traction,
            "tyre_conservation": self.tyre_conservation,
            "energy_efficiency": self.energy_efficiency,
            "straight_line": self.straight_line,
            "wet_performance": self.wet_performance,
            "reliability": self.reliability,
        }

    @classmethod
    def from_dict(cls, d: dict[str, float]) -> PerformanceVector:
        return cls(
            high_speed=d.get("high_speed", 0.0),
            low_speed=d.get("low_speed", 0.0),
            traction=d.get("traction", 0.0),
            tyre_conservation=d.get("tyre_conservation", 0.0),
            energy_efficiency=d.get("energy_efficiency", 0.0),
            straight_line=d.get("straight_line", 0.0),
            wet_performance=d.get("wet_performance", 0.0),
            reliability=d.get("reliability", 0.0),
        )

    @classmethod
    def zero(cls) -> PerformanceVector:
        """Return a zero vector — used for no-change upgrade deltas."""
        return cls()

    @property
    def dimensions(self) -> list[str]:
        return PERF_DIMENSIONS


# ---------------------------------------------------------------------------
# Power Unit families
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PowerUnit:
    """2026 PU family with latent characteristics."""

    name: str  # e.g. "Mercedes", "Ferrari", "Red Bull Ford", "Honda", "Audi"
    manufacturer: str
    mguk_kw: int = 350  # max deployment in key zones (post-April rules)
    mguk_other_kw: int = 250  # max deployment elsewhere
    energy_capacity_kj: int = 4000  # 4 MJ per lap ≈ 4000 kJ usable
    peak_acceleration: float = 0.5  # latent [0..1]
    high_speed_deployment: float = 0.5
    recharge_efficiency: float = 0.5
    energy_consistency: float = 0.5
    heat_sensitivity: float = 0.5
    reliability: float = 0.5

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "manufacturer": self.manufacturer,
            "mguk_kw": self.mguk_kw,
            "mguk_other_kw": self.mguk_other_kw,
            "energy_capacity_kj": self.energy_capacity_kj,
            "peak_acceleration": self.peak_acceleration,
            "high_speed_deployment": self.high_speed_deployment,
            "recharge_efficiency": self.recharge_efficiency,
            "energy_consistency": self.energy_consistency,
            "heat_sensitivity": self.heat_sensitivity,
            "reliability": self.reliability,
        }


# A zero-delta vector: used as the default no-change upgrade epoch.
_ZERO_DELTA = PerformanceVector()


# Frozen 2026 PU database — characteristics derived from public testing/early-season data
PU2026: dict[str, PowerUnit] = {
    "Mercedes": PowerUnit(
        name="Mercedes",
        manufacturer="Mercedes-AMG",
        mguk_kw=350,
        mguk_other_kw=250,
        energy_capacity_kj=4200,
        peak_acceleration=0.85,
        high_speed_deployment=0.82,
        recharge_efficiency=0.78,
        energy_consistency=0.85,
        heat_sensitivity=0.45,
        reliability=0.88,
    ),
    "Ferrari": PowerUnit(
        name="Ferrari",
        manufacturer="Ferrari",
        mguk_kw=350,
        mguk_other_kw=250,
        energy_capacity_kj=4100,
        peak_acceleration=0.80,
        high_speed_deployment=0.78,
        recharge_efficiency=0.75,
        energy_consistency=0.80,
        heat_sensitivity=0.55,
        reliability=0.82,
    ),
    "Red Bull Ford": PowerUnit(
        name="Red Bull Ford",
        manufacturer="Ford",
        mguk_kw=350,
        mguk_other_kw=250,
        energy_capacity_kj=4000,
        peak_acceleration=0.78,
        high_speed_deployment=0.75,
        recharge_efficiency=0.72,
        energy_consistency=0.78,
        heat_sensitivity=0.50,
        reliability=0.80,
    ),
    "Honda": PowerUnit(
        name="Honda",
        manufacturer="Honda Racing Corporation",
        mguk_kw=350,
        mguk_other_kw=250,
        energy_capacity_kj=3950,
        peak_acceleration=0.82,
        high_speed_deployment=0.76,
        recharge_efficiency=0.80,
        energy_consistency=0.83,
        heat_sensitivity=0.48,
        reliability=0.85,
    ),
    "Audi": PowerUnit(
        name="Audi",
        manufacturer="Audi",
        mguk_kw=350,
        mguk_other_kw=250,
        energy_capacity_kj=4150,
        peak_acceleration=0.70,
        high_speed_deployment=0.72,
        recharge_efficiency=0.68,
        energy_consistency=0.70,
        heat_sensitivity=0.60,
        reliability=0.72,
    ),
}


# ---------------------------------------------------------------------------
# Chassis profiles
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Chassis:
    """A single car specification with a latent performance vector."""

    name: str  # e.g. "MCL40"
    constructor: str  # e.g. "McLaren"
    pu_family: str  # references PU2026 key
    performance: PerformanceVector = field(default_factory=lambda: PerformanceVector())


# Frozen 2026 chassis database. Performance vectors are estimates from testing
# data and public analysis (motorsport analytics + FIA data).
CHASSIS2026: dict[str, Chassis] = {
    "MCL40": Chassis(
        name="MCL40",
        constructor="McLaren",
        pu_family="Mercedes",
        performance=PerformanceVector(
            high_speed=0.82,
            low_speed=0.67,
            traction=0.73,
            tyre_conservation=0.79,
            energy_efficiency=0.76,
            straight_line=0.71,
            wet_performance=0.68,
            reliability=0.65,
        ),
    ),
    "RB22": Chassis(
        name="RB22",
        constructor="Red Bull Racing",
        pu_family="Red Bull Ford",
        performance=PerformanceVector(
            high_speed=0.88,
            low_speed=0.85,
            traction=0.80,
            tyre_conservation=0.72,
            energy_efficiency=0.78,
            straight_line=0.76,
            wet_performance=0.75,
            reliability=0.70,
        ),
    ),
    "SF-26": Chassis(
        name="SF-26",
        constructor="Ferrari",
        pu_family="Ferrari",
        performance=PerformanceVector(
            high_speed=0.85,
            low_speed=0.80,
            traction=0.75,
            tyre_conservation=0.70,
            energy_efficiency=0.74,
            straight_line=0.73,
            wet_performance=0.72,
            reliability=0.78,
        ),
    ),
    "AMR26": Chassis(
        name="AMR26",
        constructor="Aston Martin",
        pu_family="Honda",
        performance=PerformanceVector(
            high_speed=0.78,
            low_speed=0.72,
            traction=0.76,
            tyre_conservation=0.75,
            energy_efficiency=0.79,
            straight_line=0.68,
            wet_performance=0.70,
            reliability=0.74,
        ),
    ),
    "A526": Chassis(
        name="A526",
        constructor="Alpine",
        pu_family="Mercedes",
        performance=PerformanceVector(
            high_speed=0.65,
            low_speed=0.60,
            traction=0.68,
            tyre_conservation=0.70,
            energy_efficiency=0.65,
            straight_line=0.62,
            wet_performance=0.60,
            reliability=0.72,
        ),
    ),
    "W16": Chassis(
        name="W16",
        constructor="Mercedes",
        pu_family="Mercedes",
        performance=PerformanceVector(
            high_speed=0.75,
            low_speed=0.70,
            traction=0.72,
            tyre_conservation=0.74,
            energy_efficiency=0.80,
            straight_line=0.69,
            wet_performance=0.76,
            reliability=0.85,
        ),
    ),
    "FW47": Chassis(
        name="FW47",
        constructor="Williams",
        pu_family="Mercedes",
        performance=PerformanceVector(
            high_speed=0.55,
            low_speed=0.58,
            traction=0.60,
            tyre_conservation=0.68,
            energy_efficiency=0.62,
            straight_line=0.55,
            wet_performance=0.55,
            reliability=0.80,
        ),
    ),
    "VF-26": Chassis(
        name="VF-26",
        constructor="Haas",
        pu_family="Ferrari",
        performance=PerformanceVector(
            high_speed=0.50,
            low_speed=0.52,
            traction=0.55,
            tyre_conservation=0.60,
            energy_efficiency=0.55,
            straight_line=0.50,
            wet_performance=0.50,
            reliability=0.70,
        ),
    ),
    "RB18": Chassis(
        name="RB18",
        constructor="Racing Bulls",
        pu_family="Red Bull Ford",
        performance=PerformanceVector(
            high_speed=0.60,
            low_speed=0.58,
            traction=0.62,
            tyre_conservation=0.64,
            energy_efficiency=0.58,
            straight_line=0.57,
            wet_performance=0.55,
            reliability=0.72,
        ),
    ),
    "CADILLAC": Chassis(
        name="CADILLAC",
        constructor="Cadillac",
        pu_family="Ferrari",
        performance=PerformanceVector(
            high_speed=0.45,
            low_speed=0.48,
            traction=0.50,
            tyre_conservation=0.55,
            energy_efficiency=0.52,
            straight_line=0.48,
            wet_performance=0.48,
            reliability=0.65,
        ),
    ),
    "AI6": Chassis(
        name="AI6",
        constructor="Audi",
        pu_family="Audi",
        performance=PerformanceVector(
            high_speed=0.70,
            low_speed=0.65,
            traction=0.68,
            tyre_conservation=0.66,
            energy_efficiency=0.72,
            straight_line=0.65,
            wet_performance=0.64,
            reliability=0.75,
        ),
    ),
}


# ---------------------------------------------------------------------------
# Upgrade epochs — named development steps per chassis, with effective dates
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class UpgradeEpoch:
    name: str  # e.g. "Launch", "Miami", "Canada", "Austria"
    effective_from: date  # race where the change is detectable
    # delta applied to the base chassis performance vector
    performance_delta: PerformanceVector = field(default_factory=lambda: _ZERO_DELTA)

    def boosted(self, base: PerformanceVector) -> PerformanceVector:
        """Return base + delta, clamped to [0, 1]."""
        d = self.performance_delta
        return PerformanceVector(
            high_speed=_clamp(base.high_speed + d.high_speed),
            low_speed=_clamp(base.low_speed + d.low_speed),
            traction=_clamp(base.traction + d.traction),
            tyre_conservation=_clamp(base.tyre_conservation + d.tyre_conservation),
            energy_efficiency=_clamp(base.energy_efficiency + d.energy_efficiency),
            straight_line=_clamp(base.straight_line + d.straight_line),
            wet_performance=_clamp(base.wet_performance + d.wet_performance),
            reliability=_clamp(base.reliability + d.reliability),
        )


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


# 2026 upgrade history per chassis — each entry is an epoch that shifts the
# latent performance vector. Sources: F1.com upgrade round-ups through August 2026.
UPGRADE_HISTORY_2026: dict[str, list[UpgradeEpoch]] = {
    "RB22": [
        UpgradeEpoch("Launch", date(2026, 3, 15), PerformanceVector.zero()),
        UpgradeEpoch(
            "Miami", date(2026, 5, 4), PerformanceVector(high_speed=0.03, straight_line=0.04)
        ),
        UpgradeEpoch(
            "Canada", date(2026, 6, 15), PerformanceVector(traction=0.03, energy_efficiency=0.03)
        ),
        UpgradeEpoch("Austria", date(2026, 6, 29), PerformanceVector.zero()),
        UpgradeEpoch(
            "Hungary",
            date(2026, 7, 27),
            PerformanceVector(
                high_speed=0.04,
                low_speed=0.03,
                energy_efficiency=0.05,
                reliability=-0.05,
            ),
        ),
    ],
    "MCL40": [
        UpgradeEpoch("Launch", date(2026, 3, 15), PerformanceVector.zero()),
        UpgradeEpoch("Miami", date(2026, 5, 4), PerformanceVector(tyre_conservation=0.03)),
        UpgradeEpoch("Canada", date(2026, 6, 15), PerformanceVector.zero()),
        UpgradeEpoch(
            "Austria",
            date(2026, 6, 29),
            PerformanceVector(
                high_speed=0.05,
                traction=0.04,
                energy_efficiency=0.03,
            ),
        ),
        UpgradeEpoch(
            "Hungary", date(2026, 7, 27), PerformanceVector(low_speed=0.03, straight_line=0.04)
        ),
    ],
    "SF-26": [
        UpgradeEpoch("Launch", date(2026, 3, 15), PerformanceVector.zero()),
        UpgradeEpoch("Monaco", date(2026, 5, 24), PerformanceVector(low_speed=0.04, traction=0.03)),
        UpgradeEpoch("Canada", date(2026, 6, 15), PerformanceVector.zero()),
        UpgradeEpoch(
            "Austria",
            date(2026, 6, 29),
            PerformanceVector(
                high_speed=0.03,
                energy_efficiency=0.04,
            ),
        ),
        UpgradeEpoch("Hungary", date(2026, 7, 27), PerformanceVector(wet_performance=0.03)),
    ],
    "AMR26": [
        UpgradeEpoch("Launch", date(2026, 3, 15), PerformanceVector.zero()),
        UpgradeEpoch("Miami", date(2026, 5, 4), PerformanceVector.zero()),
        UpgradeEpoch("Canada", date(2026, 6, 15), PerformanceVector(traction=0.03)),
        UpgradeEpoch(
            "Austria",
            date(2026, 6, 29),
            PerformanceVector(
                energy_efficiency=0.05,
                high_speed=0.03,
            ),
        ),
        UpgradeEpoch(
            "Hungary",
            date(2026, 7, 27),
            PerformanceVector(
                low_speed=0.03,
                tyre_conservation=0.03,
                reliability=-0.08,
            ),
        ),
    ],
    "A526": [
        UpgradeEpoch("Launch", date(2026, 3, 15), PerformanceVector.zero()),
        UpgradeEpoch("Miami", date(2026, 5, 4), PerformanceVector.zero()),
        UpgradeEpoch("Canada", date(2026, 6, 15), PerformanceVector(high_speed=0.03)),
        UpgradeEpoch("Austria", date(2026, 6, 29), PerformanceVector.zero()),
        UpgradeEpoch("Hungary", date(2026, 7, 27), PerformanceVector.zero()),
    ],
    "W16": [
        UpgradeEpoch("Launch", date(2026, 3, 15), PerformanceVector.zero()),
        UpgradeEpoch("Miami", date(2026, 5, 4), PerformanceVector.zero()),
        UpgradeEpoch("Canada", date(2026, 6, 15), PerformanceVector.zero()),
        UpgradeEpoch(
            "Austria",
            date(2026, 6, 29),
            PerformanceVector(
                energy_efficiency=0.05,
                straight_line=0.04,
            ),
        ),
        UpgradeEpoch("Hungary", date(2026, 7, 27), PerformanceVector.zero()),
    ],
}


# ---------------------------------------------------------------------------
# Constructor registry
# ---------------------------------------------------------------------------

# 2026 driver → (team, chassis) mapping. Only the race drivers that matter
# for telemetry modelling are listed.
DRIVER2026: dict[int, tuple[str, str]] = {
    1: ("Red Bull Racing", "RB22"),
    63: ("Red Bull Racing", "RB22"),
    4: ("McLaren", "MCL40"),
    81: ("McLaren", "MCL40"),
    44: ("Ferrari", "SF-26"),
    16: ("Ferrari", "SF-26"),
    14: ("Aston Martin", "AMR26"),
    55: ("Aston Martin", "AMR26"),
    31: ("Red Bull Racing", "RB22"),  # reserve/placeholder
    10: ("Alpine", "A526"),
    23: ("Alpine", "A526"),
    5: ("Mercedes", "W16"),
    6: ("Mercedes", "W16"),
    2: ("Aston Martin", "AMR26"),
    11: ("Force India", "A526"),  # historical reference
    8: ("Cadillac", "CADILLAC"),
    20: ("Cadillac", "CADILLAC"),
    24: ("Audi", "AI6"),
    7: ("Audi", "AI6"),
    22: ("Aston Martin", "AMR26"),
    34: ("Haas", "VF-26"),
    27: ("Haas", "VF-26"),
    40: ("Williams", "FW47"),
    18: ("Williams", "FW47"),
    3: ("Racing Bulls", "RB18"),
    9: ("Racing Bulls", "RB18"),
}


@dataclass(frozen=True)
class CarProfile:
    """Full car identity: constructor → chassis → upgrade epoch → PU.

    ``performance`` reflects the active upgrade epoch as of ``as_of``.
    """

    driver_number: int
    constructor: str
    chassis_name: str
    chassis: Chassis
    pu: PowerUnit
    upgrade_epoch: str
    performance: PerformanceVector

    @property
    def car_id(self) -> str:
        return f"{self.chassis_name}_{self.upgrade_epoch}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "driver_number": self.driver_number,
            "constructor": self.constructor,
            "chassis_name": self.chassis_name,
            "car_id": self.car_id,
            "pu_family": self.pu.name,
            "upgrade_epoch": self.upgrade_epoch,
            "performance": self.performance.to_dict(),
        }


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------


def _resolve_upgrade(chassis_name: str, as_of: date | None) -> UpgradeEpoch:
    history = UPGRADE_HISTORY_2026.get(chassis_name)
    if not history:
        # No upgrade history — return a neutral Launch epoch
        return UpgradeEpoch("Launch", date(2026, 3, 15), PerformanceVector())
    if as_of is None:
        # Use the latest epoch
        return history[-1]
    selected = history[0]
    for epoch in history:
        if epoch.effective_from <= as_of:
            selected = epoch
        else:
            break
    return selected


def get_car_profile(driver_number: int, as_of: date | None = None) -> CarProfile:
    """Look up the full CarProfile for a 2026 driver as of a given date.

    For 2024-2025 drivers, falls back to era-appropriate mappings.
    """
    if driver_number in DRIVER2026:
        constructor, chassis_name = DRIVER2026[driver_number]
        chassis = CHASSIS2026.get(chassis_name)
        if chassis is None:
            chassis = Chassis(
                name=chassis_name,
                constructor=constructor,
                pu_family="Mercedes",
                performance=PerformanceVector(),
            )
        pu = PU2026.get(chassis.pu_family, PU2026["Mercedes"])
        epoch = _resolve_upgrade(chassis_name, as_of)
        perf = epoch.boosted(chassis.performance)
        return CarProfile(
            driver_number=driver_number,
            constructor=constructor,
            chassis_name=chassis_name,
            chassis=chassis,
            pu=pu,
            upgrade_epoch=epoch.name,
            performance=perf,
        )

    # 2024-2025 fallback: generic mapping — use Mercedes PU as default,
    # neutral performance vector (0.5 = middle-of-pack on each dimension).
    # The era is handled by RegulationProfile.
    _neutral = PerformanceVector(
        high_speed=0.5,
        low_speed=0.5,
        traction=0.5,
        tyre_conservation=0.5,
        energy_efficiency=0.5,
        straight_line=0.5,
        wet_performance=0.5,
        reliability=0.5,
    )
    return CarProfile(
        driver_number=driver_number,
        constructor="Legacy",
        chassis_name="Legacy",
        chassis=Chassis(
            name="Legacy", constructor="Legacy", pu_family="Mercedes", performance=_neutral
        ),
        pu=PU2026["Mercedes"],
        upgrade_epoch="N/A",
        performance=_neutral,
    )


def get_car_profiles(as_of: date | None = None) -> dict[int, CarProfile]:
    """Return profiles for all known drivers."""
    return {dn: get_car_profile(dn, as_of) for dn in DRIVER2026}


def pu_decomposition(
    driver_number: int,
) -> dict[str, Any]:
    """Decompose the power-unit contribution for a driver.

    Returns the PU family and its latent characteristics so the strategy
    model can ask 'is this car fast because of the chassis or the PU?'.
    """
    profile = get_car_profile(driver_number)
    return {
        "driver_number": driver_number,
        "pu_family": profile.pu.name,
        "pu_characteristics": profile.pu.to_dict(),
    }
