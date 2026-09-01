"""Public command-line entry point for PitWall ML workflows."""

from __future__ import annotations

import argparse
import subprocess
import sys
from collections.abc import Sequence

from pitwall import __version__

_COMMAND_MODULES = {
    "ingest": "pipelines.ingest",
    "ingest-bronze": "pitwall.ingest.cli",
    "features": "pipelines.features",
    "train": "pipelines.train",
    "flow": "pipelines.flow_cli",
    "bootstrap-silver": "scripts.bootstrap_silver",
    "ingest-missing": "scripts.ingest_missing",
}


def build_parser() -> argparse.ArgumentParser:
    """Build the top-level parser without importing heavyweight ML dependencies."""
    parser = argparse.ArgumentParser(
        prog="pitwall",
        description="Run PitWall ML ingestion, feature, training, and operations workflows.",
        epilog=(
            "Examples: pitwall features --season 2025; "
            "pitwall train --config configs/development.yaml"
        ),
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    subparsers = parser.add_subparsers(dest="command", metavar="COMMAND")
    for command in _COMMAND_MODULES:
        subparsers.add_parser(
            command,
            help=f"run the {command.replace('-', ' ')} workflow",
            description=f"Run the {command.replace('-', ' ')} workflow.",
        )
    return parser


def app(argv: Sequence[str] | None = None) -> int:
    """Dispatch a named workflow and return its exit code."""
    parser = build_parser()
    parsed, forwarded = parser.parse_known_args(argv)
    if parsed.command is None:
        parser.print_help()
        return 0

    command = [
        sys.executable,
        "-m",
        _COMMAND_MODULES[parsed.command],
        *forwarded,
    ]
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(app())
