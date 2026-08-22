"""CLI entrypoint for the local flow runner — python -m pipelines.flow_cli."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

from pitwall.orchestration.flow import FlowRunner


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the PitWall local flow (Prefect-style).")
    parser.add_argument("--config", default="configs/flow.yaml", help="Flow YAML config path")
    parser.add_argument(
        "--steps",
        default=None,
        help="Comma-separated subset of step names to run (default: all configured steps)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the plan and execute nothing; all steps report dry-run",
    )
    args = parser.parse_args()

    with open(args.config, encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}

    subset = [s.strip() for s in args.steps.split(",") if s.strip()] if args.steps else None
    runner = FlowRunner(config)
    manifest = runner.run(steps=subset, dry_run=args.dry_run)

    print(f"flow={manifest['flow']} run_id={manifest['run_id']} dry_run={args.dry_run}")
    for step in manifest["steps"]:
        line = f"  {step['name']:<10} {step['status']}"
        if step.get("error"):
            line += f" — {step['error']}"
        print(line)

    manifest_path = (
        Path(config.get("manifest_dir", "artifacts/flow"))
        / str(manifest["run_id"])
        / "manifest.json"
    )
    print(f"manifest: {manifest_path}")

    failed_blocking = [
        s["name"]
        for s in manifest["steps"]
        if s["status"] == "failed" and not _allow_fail(config, s["name"])
    ]
    return 1 if failed_blocking else 0


def _allow_fail(config: dict, name: str) -> bool:
    for entry in config.get("steps", []):
        if entry.get("name") == name:
            return bool(entry.get("allow_fail", False))
    return False


if __name__ == "__main__":
    sys.exit(main())
