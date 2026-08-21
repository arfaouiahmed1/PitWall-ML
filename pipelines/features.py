"""Build Gold features from Silver."""

import argparse
from pathlib import Path

import polars as pl

from pitwall.features.pace import build_pace_features


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--silver", default="data/silver")
    parser.add_argument("--gold", default="data/gold")
    args = parser.parse_args()

    silver_root = Path(args.silver) / "laps"
    files = list(silver_root.rglob("*.parquet")) if silver_root.exists() else []
    if not files:
        print("No silver laps found. Run make ingest first.")
        return
    df = pl.read_parquet(files)
    if args.season:
        df = df.filter(pl.col("session_id").str.contains(str(args.season)))
    gold = build_pace_features(df)
    out = Path(args.gold) / "pace_training" / "training.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    gold.write_parquet(str(out))
    print(f"Wrote gold to {out} rows={len(gold)}")


if __name__ == "__main__":
    main()
