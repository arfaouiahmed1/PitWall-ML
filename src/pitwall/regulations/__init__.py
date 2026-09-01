"""2026 Regulation Engine — versioned rules with track segments and era lookup.

RegulationProfile → RaceState → FeatureBuilder → StrategySimulator

The FIA patches Formula 1 like a live-service game. The April-2026 change
(reducing MGU-K from 350 kW to 250 kW outside key acceleration zones) is
encoded as a versioned patch, so the same pipeline can replay:

    2024 Monaco → DRS era rules
    2025 Monaco → DRS era rules
    2026 Monaco → Active Aero era rules (with April patch if post-2026-04-20)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

# ── Era registry ──────────────────────────────────────────────────────────

# Maps a season (or season+date) to its regulation era identifier.
# The era name matches the `regulation_era` column used in silver features.
ERAS: dict[str, str] = {
    "ground_effect_v2": "GroundEffectEra",  # 2022-2025 DRS + 120 kW MGU-K
    "revised_aero_pu_2026": "ActiveAeroEra2026",  # 2026+ Active Aero + 350/250 kW
}

# Season → era mapping (2026 season is split by the April patch date)
SEASON_ERA_MAP: dict[int, str] = {
    2023: "ground_effect_v2",
    2024: "ground_effect_v2",
    2025: "ground_effect_v2",
    2026: "revised_aero_pu_2026",
}

# 2026 regulation revision history (FIA patches like a live-service game)
PATCH_2026_MGUK_LIMIT = datetime(2026, 4, 20)
"""Date when MGU-K was limited to 250 kW outside key acceleration zones."""


# ── Low-level rule dataclasses ────────────────────────────────────────────


@dataclass
class MgukLimits:
    """MGU-K power deployment limits (kW).

    2026: 350 kW in key acceleration zones, 250 kW elsewhere (post-April patch).
    Pre-2026: 120 kW flat.
    """

    key_acceleration_kw: int = 350
    other_zone_kw: int = 250


@dataclass
class EnergyRules:
    """ERS / energy deployment rules for this era."""

    boost_mode: bool = True
    overtake_mode: bool = True
    recharge_mode: bool = True
    mguk: MgukLimits = field(default_factory=MgukLimits)
    # Energy store capacity in kJ (2026: 8 MJ per lap, deployable in any zone)
    es_capacity_kj: float = 8000.0
    # Max deploy per lap (energy limited — not just power limited)
    max_deploy_kj_per_lap: float = 4000.0


@dataclass
class AeroRules:
    """Aerodynamic rules: DRS (legacy) vs Active Aero (2026+)."""

    drs: bool = False
    active_aero: bool = True
    modes: list[str] = field(default_factory=lambda: ["CORNER", "STRAIGHT"])
    # Time penalty for switching aero mode (seconds)
    mode_switch_penalty_s: float = 0.0


@dataclass
class OvertakeRules:
    """Overtaking rules for the era."""

    # Gap threshold for Overtake Mode activation (seconds)
    eligibility_gap_seconds: float = 1.0
    # Energy advantage threshold for meaningful overtake (kJ)
    energy_advantage_threshold_kj: float = 50.0


# ── Track segments ────────────────────────────────────────────────────────


@dataclass
class TrackSegment:
    """One segment of a circuit with regulation-relevant characteristics.

    Segments are ordered by distance through a lap. The FeatureBuilder and
    StrategySimulator use these to decide where energy deploys, where Active
    Aero flips mode, and where overtaking opportunities exist.
    """

    name: str  # e.g. "Turn 1", "Main Straight", "Sector 3"
    seg_type: str  # "CORNER" | "STRAIGHT" | "CHICANE" | "SLOW"
    start_pct: float  # fraction of lap (0..1) where segment begins
    end_pct: float  # fraction of lap where segment ends
    length_m: float  # segment length in metres
    # MGU-K deployment zone? (full 350 kW allowed here)
    key_accel_zone: bool = False
    # Overtake opportunity index (0..1) — based on braking zone length + DRS
    overtake_value: float = 0.0
    # Downforce level needed (affects Active Aero strategy)
    downforce_demand: float = 0.5  # 0..1
    # Regen potential (high-brake-energy corners)
    regen_potential: float = 0.5  # 0..1
    # Speed trap — max speed (km/h) in this segment
    max_speed_kmh: float = 300.0


# ── Circuit configuration ─────────────────────────────────────────────────


@dataclass
class CircuitConfig:
    """Regulation-relevant configuration for one circuit."""

    circuit_key: str  # OpenF1 circuit_key, e.g. "63" for Sakhir
    circuit_short_name: str  # e.g. "Sakhir"
    circuit_name: str  # e.g. "Bahrain International Circuit"
    country: str
    total_laps: int
    # Ordered list of track segments for the lap
    segments: list[TrackSegment] = field(default_factory=list)
    # Mini-sectors for granular energy mapping (percentage of lap)
    mini_sectors: list[float] = field(default_factory=list)

    @property
    def total_length_km(self) -> float:
        return sum(s.length_m for s in self.segments) / 1000.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "circuit_key": self.circuit_key,
            "circuit_short_name": self.circuit_short_name,
            "circuit_name": self.circuit_name,
            "country": self.country,
            "total_laps": self.total_laps,
            "segments": [
                {
                    "name": s.name,
                    "seg_type": s.seg_type,
                    "start_pct": s.start_pct,
                    "end_pct": s.end_pct,
                    "length_m": s.length_m,
                    "key_accel_zone": s.key_accel_zone,
                    "overtake_value": s.overtake_value,
                    "downforce_demand": s.downforce_demand,
                    "regen_potential": s.regen_potential,
                    "max_speed_kmh": s.max_speed_kmh,
                }
                for s in self.segments
            ],
            "mini_sectors": self.mini_sectors,
        }

    def deployable_segments(self) -> list[TrackSegment]:
        """Segments where full MGU-K deployment is allowed (key acceleration zones)."""
        return [s for s in self.segments if s.key_accel_zone]

    def energy_map(self) -> list[tuple[str, float, float, str]]:
        """Return a colour-coded energy map for this circuit.

        Returns list of (segment_name, start_pct, end_pct, colour) where colour
        ∈ {RED: heavy deploy, YELLOW: neutral, GREEN: regen, BLUE: conserve}.
        """
        emap: list[tuple[str, float, float, str]] = []
        for s in self.segments:
            if s.key_accel_zone:
                colour = "RED"
            elif s.seg_type == "CORNER" and s.regen_potential > 0.6:
                colour = "GREEN"
            elif s.seg_type == "STRAIGHT" and s.downforce_demand < 0.3:
                colour = "YELLOW"
            else:
                colour = "BLUE"
            emap.append((s.name, s.start_pct, s.end_pct, colour))
        return emap

    def energy_difficulty_index(self) -> float:
        """Circuit Energy Difficulty Index (0..100).

        Combines: total deploy zones, regen potential, overtake value,
        and energy-limited risk. Higher = more energy strategy matters.
        """
        n_seg = len(self.segments)
        if n_seg == 0:
            return 50.0
        deploy_ratio = sum(1 for s in self.segments if s.key_accel_zone) / n_seg
        regen_ratio = sum(s.regen_potential for s in self.segments) / n_seg
        overtake_sum = sum(s.overtake_value for s in self.segments) / n_seg
        speed_factor = min(sum(s.max_speed_kmh for s in self.segments) / n_seg / 330.0, 1.0)
        idx = deploy_ratio * 30 + regen_ratio * 25 + overtake_sum * 25 + speed_factor * 20
        return round(idx, 1)


# ── Main regulation profile ───────────────────────────────────────────────


@dataclass
class RegulationProfile:
    """Versioned regulation profile governing a race season/era."""

    season: int = 2026
    effective_from: str = "2026-04-20"
    era: str = "revised_aero_pu_2026"
    description: str = (
        "2026 FIA Formula 1 Technical & Sporting Regulations (Active Aero & 350kW/250kW MGU-K)"
    )
    aero: AeroRules = field(default_factory=AeroRules)
    energy: EnergyRules = field(default_factory=EnergyRules)
    overtake: OvertakeRules = field(default_factory=OvertakeRules)
    # Optional circuit config (None = generic)
    circuit: CircuitConfig | None = None

    @classmethod
    def load(cls, path: str | Path) -> RegulationProfile:
        p = Path(path)
        if not p.exists():
            return cls()
        data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        aero_data = data.get("aero", {})
        energy_data = data.get("energy", {})
        mguk_data = energy_data.get("mguk", {})
        overtake_data = data.get("overtake", {})

        return cls(
            season=int(data.get("season", 2026)),
            effective_from=str(data.get("effective_from", "2026-04-20")),
            era=str(data.get("era", "revised_aero_pu_2026")),
            description=str(data.get("description", "")),
            aero=AeroRules(
                drs=bool(aero_data.get("drs", False)),
                active_aero=bool(aero_data.get("active_aero", True)),
                modes=list(aero_data.get("modes", ["CORNER", "STRAIGHT"])),
                mode_switch_penalty_s=float(aero_data.get("mode_switch_penalty_s", 0.0)),
            ),
            energy=EnergyRules(
                boost_mode=bool(energy_data.get("boost_mode", True)),
                overtake_mode=bool(energy_data.get("overtake_mode", True)),
                recharge_mode=bool(energy_data.get("recharge_mode", True)),
                mguk=MgukLimits(
                    key_acceleration_kw=int(mguk_data.get("key_acceleration_kw", 350)),
                    other_zone_kw=int(mguk_data.get("other_zone_kw", 250)),
                ),
                es_capacity_kj=float(energy_data.get("es_capacity_kj", 8000.0)),
                max_deploy_kj_per_lap=float(energy_data.get("max_deploy_kj_per_lap", 4000.0)),
            ),
            overtake=OvertakeRules(
                eligibility_gap_seconds=float(overtake_data.get("eligibility_gap_seconds", 1.0)),
                energy_advantage_threshold_kj=float(
                    overtake_data.get("energy_advantage_threshold_kj", 50.0)
                ),
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "season": self.season,
            "era": self.era,
            "effective_from": self.effective_from,
            "description": self.description,
            "aero": {
                "drs": self.aero.drs,
                "active_aero": self.aero.active_aero,
                "modes": self.aero.modes,
                "mode_switch_penalty_s": self.aero.mode_switch_penalty_s,
            },
            "energy": {
                "boost_mode": self.energy.boost_mode,
                "overtake_mode": self.energy.overtake_mode,
                "recharge_mode": self.energy.recharge_mode,
                "es_capacity_kj": self.energy.es_capacity_kj,
                "max_deploy_kj_per_lap": self.energy.max_deploy_kj_per_lap,
                "mguk": {
                    "key_acceleration_kw": self.energy.mguk.key_acceleration_kw,
                    "other_zone_kw": self.energy.mguk.other_zone_kw,
                },
            },
            "overtake": {
                "eligibility_gap_seconds": self.overtake.eligibility_gap_seconds,
                "energy_advantage_threshold_kj": self.overtake.energy_advantage_threshold_kj,
            },
            "circuit": self.circuit.to_dict() if self.circuit else None,
        }


# ── Era / circuit registry ────────────────────────────────────────────────


def get_era_for_season(season: int) -> str:
    """Return the regulation era name for a given season."""
    return SEASON_ERA_MAP.get(season, "ground_effect_v2")


def get_regulation_profile(season: int = 2026) -> RegulationProfile:
    """Retrieve regulation profile for a given season.

    Loads from ``configs/regulations_<season>.yaml`` if present,
    otherwise constructs from built-in era defaults.
    """
    config_path = Path(f"configs/regulations_{season}.yaml")
    if config_path.exists():
        profile = RegulationProfile.load(config_path)
    elif season >= 2026:
        profile = RegulationProfile(season=season)
    else:
        # pre-2026 ground-effect era (DRS, 120 kW MGU-K)
        profile = RegulationProfile(
            season=season,
            effective_from=f"{season}-01-01",
            era="ground_effect_v2",
            description=f"{season} Ground Effect Regulations (DRS enabled, 120 kW MGU-K)",
            aero=AeroRules(drs=True, active_aero=False, modes=["DRS"]),
            energy=EnergyRules(
                boost_mode=False,
                overtake_mode=False,
                recharge_mode=True,
                mguk=MgukLimits(key_acceleration_kw=120, other_zone_kw=120),
                es_capacity_kj=4000.0,
                max_deploy_kj_per_lap=2000.0,
            ),
        )
    return profile


def get_regulation_era(season: int) -> str:
    """Short alias for ``get_era_for_season``.

    Returns the era name used in feature columns and silver tables.
    """
    return get_era_for_season(season)
