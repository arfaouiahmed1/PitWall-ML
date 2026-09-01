"""2026 Car DNA — latent performance vectors for chassis, power units, and upgrades.

Instead of treating ``team="McLaren"`` as a categorical variable, PitWall models
every 2026 chassis and power unit as a latent performance vector, tracks upgrade
epochs through the season, and decomposes observed performance into
Driver + Chassis + Power Unit + Circuit + Tyres + Strategy + Noise.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date
from typing import Any

# ── Latent performance vectors ────────────────────────────────────────────


@dataclass
class PerformanceVector:
    """Latent performance characteristics (0..1, higher is better).

    These dimensions are learnt from telemetry over the season but are
    bootstrapped from expert priors for 2026 since live data is limited.
    """

    high_speed: float = 0.50  # performance in high-speed corners / straights
    low_speed: float = 0.50  # performance in slow corners / traction
    traction: float = 0.50  # acceleration out of slow corners
    tyre_conservation: float = 0.50
    energy_efficiency: float = 0.50  # MGU-K deploy/recharge efficiency
    straight_line_efficiency: float = 0.50
    wet_performance: float = 0.50
    reliability: float = 0.50
    # 2026-specific
    active_aero_gain: float = 0.50  # straight-line gain from Active Aero
    overtake_mode_effectiveness: float = 0.50  # success rate of overtake mode
    recharge_efficiency: float = 0.50  # regen under braking per lap
    heat_sensitivity: float = 0.50  # performance loss in hot conditions (- = bad)
    # PU-blend dimensions (used by CarProfile.current_performance)
    high_speed_deployment: float = 0.50
    peak_acceleration: float = 0.50

    def to_dict(self) -> dict[str, float]:
        return {
            "high_speed": self.high_speed,
            "low_speed": self.low_speed,
            "traction": self.traction,
            "tyre_conservation": self.tyre_conservation,
            "energy_efficiency": self.energy_efficiency,
            "straight_line_efficiency": self.straight_line_efficiency,
            "wet_performance": self.wet_performance,
            "reliability": self.reliability,
            "active_aero_gain": self.active_aero_gain,
            "overtake_mode_effectiveness": self.overtake_mode_effectiveness,
            "recharge_efficiency": self.recharge_efficiency,
            "heat_sensitivity": self.heat_sensitivity,
            "high_speed_deployment": self.high_speed_deployment,
            "peak_acceleration": self.peak_acceleration,
        }


# ── Power Unit ────────────────────────────────────────────────────────────


@dataclass
class PowerUnit:
    """Latent power-unit performance profile."""

    name: str  # e.g. "Mercedes-2026", "Ferrari-065/9", "Ford-Cosworth"
    manufacturer: str  # e.g. "Mercedes", "Ferrari", "Red Bull Ford", "Honda", "Audi"
    teams: list[str] = field(default_factory=list)
    # Latent characteristics (0..1)
    peak_acceleration: float = 0.50
    high_speed_deployment: float = 0.50
    recharge_efficiency: float = 0.50  # regen energy recovered per braking event
    energy_consistency: float = 0.50  # low variance in deploy output across laps
    reliability: float = 0.50
    heat_sensitivity: float = 0.50  # power loss in hot conditions
    circuit_sensitivity: dict[str, float] = field(default_factory=dict)
    # 2026-specific: MGU-K characteristics
    mguk_peak_kw: int = 350
    mguk_limited_kw: int = 250
    es_capacity_kj: float = 8000.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "manufacturer": self.manufacturer,
            "teams": self.teams,
            "peak_acceleration": self.peak_acceleration,
            "high_speed_deployment": self.high_speed_deployment,
            "recharge_efficiency": self.recharge_efficiency,
            "energy_consistency": self.energy_consistency,
            "reliability": self.reliability,
            "heat_sensitivity": self.heat_sensitivity,
            "circuit_sensitivity": self.circuit_sensitivity,
            "mguk_peak_kw": self.mguk_peak_kw,
            "mguk_limited_kw": self.mguk_limited_kw,
            "es_capacity_kj": self.es_capacity_kj,
        }


@dataclass
class Chassis:
    """Chassis / car design profile with upgrade epochs."""

    name: str  # e.g. "MCL40", "RB22", "SF-26"
    constructor: str  # e.g. "McLaren"
    power_unit: str  # references PowerUnit.name
    base_performance: PerformanceVector = field(default_factory=PerformanceVector)
    # Upgrade epochs through the season (ordered by date)
    upgrade_epochs: list[UpgradeEpoch] = field(default_factory=list)
    current_epoch_name: str = "launch"

    def performance_at(self, d: date | str | None = None) -> PerformanceVector:
        """Return the performance vector for the given date (or current epoch)."""
        if d is None:
            for epoch in self.upgrade_epochs:
                if epoch.name == self.current_epoch_name:
                    return epoch.performance_override(self.base_performance)
            for epoch in self.upgrade_epochs:
                if epoch.name.lower() == self.current_epoch_name.lower():
                    return epoch.performance_override(self.base_performance)
            return replace(self.base_performance)
        if isinstance(d, str):
            try:
                d = date.fromisoformat(d)
            except ValueError:
                return replace(self.base_performance)
        applicable = [e for e in self.upgrade_epochs if e.effective_from <= d]
        if not applicable:
            return replace(self.base_performance)
        latest = max(applicable, key=lambda e: e.effective_from)
        return latest.performance_override(self.base_performance)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "constructor": self.constructor,
            "power_unit": self.power_unit,
            "base_performance": self.base_performance.to_dict(),
            "upgrade_epochs": [e.to_dict() for e in self.upgrade_epochs],
            "current_epoch": self.current_epoch_name,
        }


@dataclass
class UpgradeEpoch:
    """A development upgrade introduced at a specific race.

    Car development in 2026 is unusually aggressive — teams bring major
    packages multiple times per season. Each epoch captures the delta.
    """

    name: str  # e.g. "Miami_spec"
    effective_from: date  # first race date
    race_name: str  # e.g. "Miami Grand Prix"
    description: str  # e.g. "New floor, front wing, sidepods"
    # Delta applied on top of base (0..1 adjustments for each dimension)
    upgrades: dict[str, float] = field(default_factory=dict)
    # Whether the upgrade was assessed as working / not working
    assessed: bool = False
    assessed_result: str = "unknown"  # "working", "not_working", "mixed"

    def performance_override(self, base: PerformanceVector) -> PerformanceVector:
        """Apply this epoch's deltas to a base performance vector."""
        d = base.to_dict()
        for key, delta in self.upgrades.items():
            if key in d:
                d[key] = max(0.0, min(1.0, d[key] + delta))
        return PerformanceVector(**d)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "effective_from": self.effective_from.isoformat()
            if isinstance(self.effective_from, date)
            else str(self.effective_from),
            "race_name": self.race_name,
            "description": self.description,
            "upgrades": self.upgrades,
            "assessed": self.assessed,
            "assessed_result": self.assessed_result,
        }


@dataclass
class CarProfile:
    """Full car profile: chassis + power unit + current upgrade epoch."""

    chassis: Chassis
    power_unit: PowerUnit

    @property
    def name(self) -> str:
        return self.chassis.name

    @property
    def constructor(self) -> str:
        return self.chassis.constructor

    def current_performance(self, d: date | str | None = None) -> PerformanceVector:
        """Get the combined performance vector at a given date."""
        # Always work on a fresh copy; never mutate the chassis' cached vector.
        perf = replace(self.chassis.performance_at(d))
        pu = self.power_unit
        perf.high_speed_deployment = (
            perf.high_speed_deployment * 0.6 + pu.high_speed_deployment * 0.4
        )
        perf.peak_acceleration = perf.peak_acceleration * 0.5 + pu.peak_acceleration * 0.5
        return perf

    def to_dict(self) -> dict[str, Any]:
        return {
            "chassis": self.chassis.to_dict(),
            "power_unit": self.power_unit.to_dict(),
        }


# ── 2026 metadata registry ────────────────────────────────────────────────

# Mapping: team name (as returned by OpenF1) → (chassis_name, pu_name)
TEAM_TO_CAR_2026: dict[str, tuple[str, str]] = {
    "McLaren": ("MCL40", "Mercedes-2026"),
    "Red Bull Racing": ("RB22", "Red Bull Ford-2026"),
    "Racing Bulls": ("RBTH-Red Bull", "Red Bull Ford-2026"),
    "Ferrari": ("SF-26", "Ferrari-2026"),
    "Aston Martin": ("AMR26", "Honda-2026"),
    "Mercedes": ("W16", "Mercedes-2026"),
    "Williams": ("FW46", "Mercedes-2026"),
    "Alpine": ("A526", "Renault-2026"),
    "Haas F1 Team": ("VF-26", "Ferrari-2026"),
    "Cadillac": ("CA-26", "GM-2026"),
    "Audi": ("AE1", "Audi-2026"),
}

# Power unit database — latent characteristics for the 5 2026 PU families.
POWER_UNITS_2026: dict[str, PowerUnit] = {
    "Mercedes-2026": PowerUnit(
        name="Mercedes-2026",
        manufacturer="Mercedes",
        teams=["Mercedes", "McLaren", "Williams", "Alpine"],
        peak_acceleration=0.85,
        high_speed_deployment=0.88,
        recharge_efficiency=0.82,
        energy_consistency=0.85,
        reliability=0.80,
        heat_sensitivity=0.15,  # 0 = no sensitivity, 1 = very sensitive
        circuit_sensitivity={"monza": 0.90, "spa": 0.88, "silverstone": 0.85},
        mguk_peak_kw=350,
        mguk_limited_kw=250,
        es_capacity_kj=8000.0,
    ),
    "Ferrari-2026": PowerUnit(
        name="Ferrari-2026",
        manufacturer="Ferrari",
        teams=["Ferrari", "Haas F1 Team", "Cadillac"],
        peak_acceleration=0.82,
        high_speed_deployment=0.80,
        recharge_efficiency=0.75,
        energy_consistency=0.78,
        reliability=0.75,
        heat_sensitivity=0.30,
        circuit_sensitivity={"monza": 0.85, "spa": 0.82, "monaco": 0.75},
        mguk_peak_kw=350,
        mguk_limited_kw=250,
        es_capacity_kj=8000.0,
    ),
    "Red Bull Ford-2026": PowerUnit(
        name="Red Bull Ford-2026",
        manufacturer="Red Bull Ford",
        teams=["Red Bull Racing", "Racing Bulls"],
        peak_acceleration=0.88,
        high_speed_deployment=0.90,
        recharge_efficiency=0.80,
        energy_consistency=0.82,
        reliability=0.78,
        heat_sensitivity=0.20,
        circuit_sensitivity={"monza": 0.92, "spa": 0.89, "austria": 0.95},
        mguk_peak_kw=350,
        mguk_limited_kw=250,
        es_capacity_kj=8000.0,
    ),
    "Honda-2026": PowerUnit(
        name="Honda-2026",
        manufacturer="Honda",
        teams=["Aston Martin"],
        peak_acceleration=0.80,
        high_speed_deployment=0.78,
        recharge_efficiency=0.70,
        energy_consistency=0.75,
        reliability=0.72,
        heat_sensitivity=0.25,
        circuit_sensitivity={"monza": 0.80, "spa": 0.75, "interlagos": 0.85},
        mguk_peak_kw=350,
        mguk_limited_kw=250,
        es_capacity_kj=8000.0,
    ),
    "Audi-2026": PowerUnit(
        name="Audri-2026",
        manufacturer="Audi",
        teams=["Audi"],
        peak_acceleration=0.75,
        high_speed_deployment=0.76,
        recharge_efficiency=0.72,
        energy_consistency=0.70,
        reliability=0.70,
        heat_sensitivity=0.30,
        circuit_sensitivity={"monza": 0.82, "spa": 0.78},
        mguk_peak_kw=350,
        mguk_limited_kw=250,
        es_capacity_kj=8000.0,
    ),
    # Legacy PUs for 2024/25 (used in decomposition model)
    "Mercedes-legacy": PowerUnit(
        name="Mercedes-legacy",
        manufacturer="Mercedes",
        teams=["Mercedes", "McLaren", "Aston Martin"],
        peak_acceleration=0.80,
        high_speed_deployment=0.78,
        recharge_efficiency=0.70,
        energy_consistency=0.80,
        reliability=0.82,
        heat_sensitivity=0.20,
        mguk_peak_kw=120,
        mguk_limited_kw=120,
        es_capacity_kj=4000.0,
    ),
    "Ferrari-legacy": PowerUnit(
        name="Ferrari-legacy",
        manufacturer="Ferrari",
        teams=["Ferrari"],
        peak_acceleration=0.75,
        high_speed_deployment=0.72,
        recharge_efficiency=0.68,
        energy_consistency=0.75,
        reliability=0.78,
        heat_sensitivity=0.25,
        mguk_peak_kw=120,
        mguk_limited_kw=120,
        es_capacity_kj=4000.0,
    ),
    "Red Bull Ford-legacy": PowerUnit(
        name="Red Bull Ford-legacy",
        manufacturer="Red Bull Ford",
        teams=["Red Bull Racing"],
        peak_acceleration=0.85,
        high_speed_deployment=0.85,
        recharge_efficiency=0.75,
        energy_consistency=0.80,
        reliability=0.80,
        heat_sensitivity=0.18,
        mguk_peak_kw=120,
        mguk_limited_kw=120,
        es_capacity_kj=4000.0,
    ),
}

# Chassis database with 2026 upgrade epochs
CHASSIS_2026: dict[str, Chassis] = {
    "MCL40": Chassis(
        name="MCL40",
        constructor="McLaren",
        power_unit="Mercedes-2026",
        base_performance=PerformanceVector(
            high_speed=0.82,
            low_speed=0.67,
            traction=0.73,
            tyre_conservation=0.79,
            energy_efficiency=0.76,
            straight_line_efficiency=0.71,
            wet_performance=0.68,
            reliability=0.65,
            active_aero_gain=0.80,
            overtake_mode_effectiveness=0.75,
            recharge_efficiency=0.78,
            heat_sensitivity=0.30,
        ),
        upgrade_epochs=[
            UpgradeEpoch(
                name="launch",
                effective_from=date(2026, 2, 26),
                race_name="Bahrain Grand Prix",
                description="Launch specification",
                upgrades={},
            ),
            UpgradeEpoch(
                name="miami_spec",
                effective_from=date(2026, 5, 2),
                race_name="Miami Grand Prix",
                description="New floor, front wing, sidepods, and PU update",
                upgrades={
                    "high_speed": 0.04,
                    "energy_efficiency": 0.05,
                    "straight_line_efficiency": 0.03,
                    "traction": 0.03,
                },
                assessed=True,
                assessed_result="working",
            ),
            UpgradeEpoch(
                name="canada_spec",
                effective_from=date(2026, 5, 23),
                race_name="Canadian Grand Prix",
                description="Austrian-spec floor and rear wing development",
                upgrades={
                    "low_speed": 0.03,
                    "tyre_conservation": 0.02,
                    "recharge_efficiency": 0.04,
                },
                assessed=True,
                assessed_result="mixed",
            ),
            UpgradeEpoch(
                name="hungary_spec",
                effective_from=date(2026, 7, 26),
                race_name="Hungarian Grand Prix",
                description="Major aerodynamic package, new rear wing profile",
                upgrades={
                    "high_speed": 0.05,
                    "low_speed": 0.04,
                    "energy_efficiency": 0.03,
                },
                assessed=True,
                assessed_result="working",
            ),
        ],
        current_epoch_name="hungary_spec",
    ),
    "RB22": Chassis(
        name="RB22",
        constructor="Red Bull Racing",
        power_unit="Red Bull Ford-2026",
        base_performance=PerformanceVector(
            high_speed=0.88,
            low_speed=0.85,
            traction=0.82,
            tyre_conservation=0.75,
            energy_efficiency=0.80,
            straight_line_efficiency=0.85,
            wet_performance=0.72,
            reliability=0.70,
            active_aero_gain=0.85,
            overtake_mode_effectiveness=0.88,
            recharge_efficiency=0.82,
            heat_sensitivity=0.25,
        ),
        upgrade_epochs=[
            UpgradeEpoch(
                name="launch",
                effective_from=date(2026, 2, 26),
                race_name="Bahrain Grand Prix",
                description="Launch specification",
                upgrades={},
            ),
            UpgradeEpoch(
                name="spielberg_spec",
                effective_from=date(2026, 6, 28),
                race_name="Austrian Grand Prix",
                description="Significant upgrade package: new floor, front wing, rear wing",
                upgrades={
                    "high_speed": 0.05,
                    "energy_efficiency": 0.04,
                    "active_aero_gain": 0.03,
                    "downforce_demand": -0.02,
                },
                assessed=True,
                assessed_result="working",
            ),
        ],
        current_epoch_name="spielberg_spec",
    ),
    "SF-26": Chassis(
        name="SF-26",
        constructor="Ferrari",
        power_unit="Ferrari-2026",
        base_performance=PerformanceVector(
            high_speed=0.80,
            low_speed=0.75,
            traction=0.70,
            tyre_conservation=0.72,
            energy_efficiency=0.75,
            straight_line_efficiency=0.78,
            wet_performance=0.70,
            reliability=0.68,
            active_aero_gain=0.75,
            overtake_mode_effectiveness=0.72,
            recharge_efficiency=0.74,
            heat_sensitivity=0.35,
        ),
        upgrade_epochs=[
            UpgradeEpoch(
                name="launch",
                effective_from=date(2026, 2, 26),
                race_name="Bahrain Grand Prix",
                description="Launch specification",
                upgrades={},
            ),
            UpgradeEpoch(
                name="monaco_spec",
                effective_from=date(2026, 6, 7),
                race_name="Monaco Grand Prix",
                description="New front wing, rear wing, suspension updates",
                upgrades={
                    "low_speed": 0.03,
                    "tyre_conservation": 0.03,
                    "wet_performance": 0.05,
                },
                assessed=True,
                assessed_result="mixed",
            ),
            UpgradeEpoch(
                name="hungary_spec",
                effective_from=date(2026, 7, 26),
                race_name="Hungarian Grand Prix",
                description="Major floor and diffuser update",
                upgrades={
                    "high_speed": 0.04,
                    "low_speed": 0.03,
                    "energy_efficiency": 0.03,
                },
                assessed=True,
                assessed_result="working",
            ),
        ],
        current_epoch_name="hungary_spec",
    ),
    "AMR26": Chassis(
        name="AMR26",
        constructor="Aston Martin",
        power_unit="Honda-2026",
        base_performance=PerformanceVector(
            high_speed=0.75,
            low_speed=0.78,
            traction=0.75,
            tyre_conservation=0.76,
            energy_efficiency=0.72,
            straight_line_efficiency=0.74,
            wet_performance=0.75,
            reliability=0.65,
            active_aero_gain=0.72,
            overtake_mode_effectiveness=0.70,
            recharge_efficiency=0.73,
            heat_sensitivity=0.30,
        ),
        upgrade_epochs=[
            UpgradeEpoch(
                name="launch",
                effective_from=date(2026, 2, 26),
                race_name="Bahrain Grand Prix",
                description="Launch specification",
                upgrades={},
            ),
        ],
        current_epoch_name="launch",
    ),
    "A526": Chassis(
        name="A526",
        constructor="Alpine",
        power_unit="Renault-2026",
        base_performance=PerformanceVector(
            high_speed=0.70,
            low_speed=0.72,
            traction=0.71,
            tyre_conservation=0.74,
            energy_efficiency=0.74,
            straight_line_efficiency=0.70,
            wet_performance=0.67,
            reliability=0.63,
            active_aero_gain=0.70,
            overtake_mode_effectiveness=0.68,
            recharge_efficiency=0.75,
            heat_sensitivity=0.28,
        ),
        upgrade_epochs=[
            UpgradeEpoch(
                name="launch",
                effective_from=date(2026, 2, 26),
                race_name="Bahrain Grand Prix",
                description="Launch specification",
                upgrades={},
            ),
        ],
        current_epoch_name="launch",
    ),
    # 2024/25 legacy chassis for drift analysis
    "W15": Chassis(
        name="W15",
        constructor="Mercedes",
        power_unit="Mercedes-legacy",
        base_performance=PerformanceVector(
            high_speed=0.75,
            low_speed=0.72,
            traction=0.68,
            tyre_conservation=0.74,
            energy_efficiency=0.70,
            straight_line_efficiency=0.72,
            wet_performance=0.70,
            reliability=0.80,
            active_aero_gain=0.0,
            overtake_mode_effectiveness=0.0,
            recharge_efficiency=0.70,
            heat_sensitivity=0.20,
        ),
    ),
    "MCL38": Chassis(
        name="MCL38",
        constructor="McLaren",
        power_unit="Mercedes-legacy",
        base_performance=PerformanceVector(
            high_speed=0.80,
            low_speed=0.75,
            traction=0.74,
            tyre_conservation=0.78,
            energy_efficiency=0.72,
            straight_line_efficiency=0.75,
            wet_performance=0.68,
            reliability=0.75,
            active_aero_gain=0.0,
            overtake_mode_effectiveness=0.0,
            recharge_efficiency=0.70,
            heat_sensitivity=0.25,
        ),
    ),
    "SF-25": Chassis(
        name="SF-25",
        constructor="Ferrari",
        power_unit="Ferrari-legacy",
        base_performance=PerformanceVector(
            high_speed=0.78,
            low_speed=0.74,
            traction=0.72,
            tyre_conservation=0.73,
            energy_efficiency=0.71,
            straight_line_efficiency=0.75,
            wet_performance=0.72,
            reliability=0.75,
            active_aero_gain=0.0,
            overtake_mode_effectiveness=0.0,
            recharge_efficiency=0.70,
            heat_sensitivity=0.30,
        ),
    ),
    "RB21": Chassis(
        name="RB21",
        constructor="Red Bull Racing",
        power_unit="Red Bull Ford-legacy",
        base_performance=PerformanceVector(
            high_speed=0.85,
            low_speed=0.82,
            traction=0.80,
            tyre_conservation=0.72,
            energy_efficiency=0.78,
            straight_line_efficiency=0.82,
            wet_performance=0.70,
            reliability=0.78,
            active_aero_gain=0.0,
            overtake_mode_effectiveness=0.0,
            recharge_efficiency=0.70,
            heat_sensitivity=0.22,
        ),
    ),
}

# A basic Renault PU for Alpine (not previously in POWER_UNITS_2026 — add it)
if "Renault-2026" not in POWER_UNITS_2026:
    POWER_UNITS_2026["Renault-2026"] = PowerUnit(
        name="Renault-2026",
        manufacturer="Renault",
        teams=["Alpine"],
        peak_acceleration=0.75,
        high_speed_deployment=0.75,
        recharge_efficiency=0.72,
        energy_consistency=0.72,
        reliability=0.70,
        heat_sensitivity=0.30,
        mguk_peak_kw=350,
        mguk_limited_kw=250,
        es_capacity_kj=8000.0,
    )

if "GM-2026" not in POWER_UNITS_2026:
    POWER_UNITS_2026["GM-2026"] = PowerUnit(
        name="GM-2026",
        manufacturer="GM",
        teams=["Cadillac"],
        peak_acceleration=0.70,
        high_speed_deployment=0.72,
        recharge_efficiency=0.70,
        energy_consistency=0.70,
        reliability=0.68,
        heat_sensitivity=0.32,
        mguk_peak_kw=350,
        mguk_limited_kw=250,
        es_capacity_kj=8000.0,
    )


def get_car_profile(
    team_name: str, season: int = 2026, as_of: date | str | None = None
) -> CarProfile | None:
    """Look up the CarProfile for a team at a given season/date."""
    if season >= 2026:
        mapping = TEAM_TO_CAR_2026
    else:
        # Legacy: map teams to legacy chassis
        mapping = {
            "Mercedes": ("W15", "Mercedes-legacy"),
            "McLaren": ("MCL38", "Mercedes-legacy"),
            "Red Bull Racing": ("RB21", "Red Bull Ford-legacy"),
            "Ferrari": ("SF-25", "Ferrari-legacy"),
            "Aston Martin": ("AMR25", "Honda-legacy"),
            "Williams": ("FW46", "Mercedes-legacy"),
            "Alpine": ("A524", "Renault-legacy"),
            "Haas F1 Team": ("VF-24", "Ferrari-legacy"),
        }
        if "Honda-legacy" not in POWER_UNITS_2026:
            POWER_UNITS_2026["Honda-legacy"] = PowerUnit(
                name="Honda-legacy",
                manufacturer="Honda",
                mguk_peak_kw=120,
                mguk_limited_kw=120,
                es_capacity_kj=4000.0,
            )
        if "Renault-legacy" not in POWER_UNITS_2026:
            POWER_UNITS_2026["Renault-legacy"] = PowerUnit(
                name="Renault-legacy",
                manufacturer="Renault",
                mguk_peak_kw=120,
                mguk_limited_kw=120,
                es_capacity_kj=4000.0,
            )
        if as_of is None:
            as_of = date(2025, 12, 31)

    chassis_name, pu_name = mapping.get(team_name, (None, None))
    if chassis_name is None:
        return None

    chassis = CHASSIS_2026.get(chassis_name)
    if chassis is None:
        # Create a generic chassis
        chassis = Chassis(
            name=chassis_name,
            constructor=team_name,
            power_unit=pu_name,
            base_performance=PerformanceVector(),
        )

    pu = POWER_UNITS_2026.get(pu_name)
    if pu is None:
        pu = PowerUnit(name=pu_name, manufacturer="unknown")

    if as_of is None:
        as_of = date(2026, 8, 1)  # default to mid-season

    # Epoch selection is pure (no mutation of shared CHASSIS_2026 entries).
    epochs = chassis.upgrade_epochs
    applicable = [
        e
        for e in epochs
        if e.effective_from
        <= (
            as_of if isinstance(as_of, date) else date.fromisoformat(as_of)  # type: ignore[arg-type]
        )
    ]
    epoch_name = max(applicable, key=lambda e: e.effective_from).name if applicable else "launch"
    chassis_copy = replace(chassis, current_epoch_name=epoch_name)

    return CarProfile(chassis=chassis_copy, power_unit=pu)


def list_2026_cars() -> list[str]:
    """Return all 2026 chassis names."""
    return list(CHASSIS_2026.keys())


def list_power_units(season: int = 2026) -> list[str]:
    """Return all power unit names for a season."""
    if season >= 2026:
        return [pu for pu in POWER_UNITS_2026 if pu.endswith("-2026")]
    return [pu for pu in POWER_UNITS_2026 if pu.endswith("-legacy")]
