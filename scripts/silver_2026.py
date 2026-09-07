"""Convert all ingested 2026 bronze sessions into silver.laps files.

Practices, quals, sprints, and races all become silver laps with the FastF1
schema so the feature builder and trained models work unchanged.
"""
from __future__ import annotations

import pathlib

from pitwall.data.openf1_silver import build_silver_from_openf1, write_silver_session

BRONZE = pathlib.Path("data/bronze/year=2026")
SILVER = pathlib.Path("data/silver")


def session_label(stype: str) -> str:
    return stype if stype != "R" else "Grand Prix"


def main() -> None:
    total_rows = 0
    n_sessions = 0
    for sess_dir in sorted(BRONZE.rglob("sessions.parquet")):
        root = sess_dir.parent
        event = root.parent.name.replace("event=", "")
        stype = root.name.replace("session_type=", "")
        year = 2026

        # Only convert dirs that have laps + stints + drivers
        if not (root / "laps.parquet").exists():
            continue
        if not (root / "stints.parquet").exists():
            continue
        if not (root / "drivers.parquet").exists():
            continue

        try:
            df = build_silver_from_openf1(root, year, event, stype)
        except Exception as e:
            print(f"  SKIP {event}/{stype}: {e}")
            continue
        if df.is_empty():
            continue

        # Practice sessions have no pit/stint data sometimes; still usable for
        # telemetry-adjacent features but mark them non-training by default.
        # (The pace feature builder only keeps R sessions for target training.)
        out = write_silver_session(SILVER, df, year, event, session_label(stype))
        total_rows += len(df)
        n_sessions += 1
        print(f"  {event:<16} {stype:<18} {len(df):>5} laps -> {out.name}")

    print(f"\nConverted {n_sessions} sessions, {total_rows:,} total silver laps")


if __name__ == "__main__":
    main()