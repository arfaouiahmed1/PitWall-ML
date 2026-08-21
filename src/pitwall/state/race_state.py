"""Race state engine — maintains event-time state for inference."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from pitwall.schemas.events import RaceEvent


@dataclass
class DriverState:
    driver_number: int
    position: int | None = None
    gap_to_leader_s: float | None = None
    gap_ahead_s: float | None = None
    gap_behind_s: float | None = None
    last_lap_s: float | None = None
    last_lap_no: int | None = None
    compound: str = "UNKNOWN"
    tyre_age: int | None = None
    stint_no: int | None = None
    lap_times: list[float] = field(default_factory=list)
    status: str = "running"


@dataclass
class RaceState:
    session_id: str
    lap: int = 0
    track_status: str = "GREEN"
    safety_car: bool = False
    vsc: bool = False
    drivers: dict[int, DriverState] = field(default_factory=dict)
    last_update: datetime = field(default_factory=lambda: datetime.now(UTC))
    event_count: int = 0

    def apply(self, event: RaceEvent) -> None:
        self.last_update = event.event_ts
        self.event_count += 1
        p = event.payload

        # lap events
        if str(event.event_type) == "lap" or event.event_type == "lap":
            dn = event.driver_number
            if dn is None:
                return
            ds = self.drivers.setdefault(dn, DriverState(driver_number=dn))
            if "lap_number" in p and p["lap_number"] is not None:
                try:
                    lap_no = int(p["lap_number"])
                    ds.last_lap_no = lap_no
                    self.lap = max(self.lap, lap_no)
                except Exception:
                    pass
            if "lap_time_s" in p and p["lap_time_s"] is not None:
                try:
                    lt = float(p["lap_time_s"])
                    ds.last_lap_s = lt
                    ds.lap_times.append(lt)
                    # keep last 20
                    if len(ds.lap_times) > 20:
                        ds.lap_times = ds.lap_times[-20:]
                except Exception:
                    pass
            if "position" in p and p["position"] is not None:
                try:
                    ds.position = int(p["position"])
                except Exception:
                    pass
            if p.get("compound"):
                ds.compound = str(p["compound"]).upper()
            if "tyre_age" in p or "tyre_life" in p:
                try:
                    ds.tyre_age = int(p.get("tyre_age", p.get("tyre_life")))
                except Exception:
                    pass
            if "stint" in p and p["stint"] is not None:
                try:
                    ds.stint_no = int(p["stint"])
                except Exception:
                    pass

        # position / interval events
        elif str(event.event_type) in ("position", "interval"):
            dn = event.driver_number
            if dn is not None and dn in self.drivers:
                ds = self.drivers[dn]
                if "gap_to_leader" in p:
                    try:
                        ds.gap_to_leader_s = float(p["gap_to_leader"])
                    except Exception:
                        pass
                if "interval" in p:
                    try:
                        ds.gap_ahead_s = float(p["interval"])
                    except Exception:
                        pass

        # race control
        elif str(event.event_type) == "race_control":
            flag = p.get("flag") or p.get("category") or p.get("status")
            if flag:
                self.track_status = str(flag).upper()
                self.safety_car = "safety_car" in str(flag).lower() or str(flag).lower() == "sc"
                self.vsc = "vsc" in str(flag).lower()

        # weather
        elif str(event.event_type) == "weather":
            # stored at race level for feature builder to pick up
            pass

    def to_feature_dict(self, driver_number: int) -> dict:
        ds = self.drivers.get(driver_number, DriverState(driver_number=driver_number))

        # rolling stats
        def rolling_median(window: int) -> float | None:
            if len(ds.lap_times) < window:
                return None
            vals = sorted(ds.lap_times[-window:])
            n = len(vals)
            return vals[n // 2] if n % 2 == 1 else (vals[n // 2 - 1] + vals[n // 2]) / 2

        def rolling_std(window: int) -> float | None:
            if len(ds.lap_times) < window:
                return None
            vals = ds.lap_times[-window:]
            m = sum(vals) / len(vals)
            var = sum((x - m) ** 2 for x in vals) / len(vals)
            return var**0.5

        return {
            "driver_number": driver_number,
            "position": ds.position,
            "gap_ahead_s": ds.gap_ahead_s,
            "gap_leader_s": ds.gap_to_leader_s,
            "compound": ds.compound,
            "tyre_age": ds.tyre_age,
            "stint_no": ds.stint_no,
            "last_clean_lap_s": ds.last_lap_s,
            "rolling_median_3": rolling_median(3),
            "rolling_median_5": rolling_median(5),
            "rolling_std_5": rolling_std(5),
            "lap_number": ds.last_lap_no or self.lap,
            "track_status": self.track_status,
            "safety_car": self.safety_car,
            "vsc": self.vsc,
        }
