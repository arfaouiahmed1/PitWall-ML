"""CLI: ingest historical session via FastF1 -> Bronze -> Silver."""

from __future__ import annotations

import argparse
from pathlib import Path

import polars as pl

from pitwall.data.quality import check_silver_laps, quality_report
from pitwall.data.silver import build_silver_from_fastf1
from pitwall.ingestion.fastf1 import fetch_session_laps_polars


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest F1 session via FastF1")
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--event", type=str, required=True, help="e.g. 'Monaco Grand Prix'")
    parser.add_argument("--session", type=str, default="R")
    parser.add_argument("--bronze", type=str, default="data/bronze")
    parser.add_argument("--silver", type=str, default="data/silver")
    args = parser.parse_args()

    print(f"Fetching {args.season} {args.event} {args.session} via FastF1...")
    df, _sess = fetch_session_laps_polars(args.season, args.event, args.session)
    print(f"Raw laps: {len(df)} columns: {df.columns}")

    # Bronze: also write events parquet for replay
    # For V1 we write silver directly + a bronze events file derived from laps

    # Build silver
    silver = build_silver_from_fastf1(df, args.season, args.event, args.session)
    valid = (
        silver.filter(pl.col("is_valid_training_lap")).height
        if "is_valid_training_lap" in silver.columns
        else "unknown"
    )
    print(f"Silver laps: {len(silver)} valid: {valid}")

    # Quality
    checks = check_silver_laps(silver)
    report = quality_report(checks)
    print("Quality:", report)

    # Write silver
    out = Path(args.silver) / "laps" / f"{args.season}_{args.event}_{args.session}.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    silver.write_parquet(str(out))
    print(f"Wrote silver to {out}")

    # Also write bronze events (so replay works)
    # Convert silver rows to bronze-like events parquet
    bronze_root = (
        Path(args.bronze)
        / f"season={args.season}"
        / f"event={args.event.replace(' ', '_')}"
        / f"session={args.session}"
    )
    bronze_root.mkdir(parents=True, exist_ok=True)
    # Simple: store silver as bronze event payload for demo
    # Real pipeline would store normalized RaceEvent rows
    silver.write_parquet(str(bronze_root / "laps.parquet"))
    print(f"Wrote bronze mirror to {bronze_root}")


if __name__ == "__main__":
    main()
