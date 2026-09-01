"""CLI for OpenF1 Bronze ingestion — `pitwall ingest-bronze` / `make ingest-bronze`."""

from __future__ import annotations

import argparse

from pitwall.ingest.openf1 import ingest_season_bronze


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest OpenF1 Bronze layer for a season")
    parser.add_argument("--year", type=int, required=True, help="Season year, e.g. 2025")
    parser.add_argument(
        "--output-dir", default="data/bronze", help="Bronze output directory (default: data/bronze)"
    )
    args = parser.parse_args(argv)
    results = ingest_season_bronze(year=args.year, output_dir=args.output_dir)
    print(f"Ingested {len(results)} sessions to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
