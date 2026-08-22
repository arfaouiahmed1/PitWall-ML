"""Promotion CLI — enforce champion/challenger gates and swap the champion bundle.

Usage:
    python -m pitwall.registry.promote_cli \
        --candidate artifacts/candidate --champion-dir artifacts/champion \
        --config configs/promotion.yaml [--dry-run] [--force]

Exit codes: 0 promoted (or dry-run pass), 1 blocked by gate, 2 missing inputs.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pitwall.registry.promotion import check_promotion_from_files

EXIT_PROMOTED = 0
EXIT_BLOCKED = 1
EXIT_MISSING_INPUTS = 2

BUNDLE_DIRS = ("model", "model_quantile", "model_tyre", "model_pit")
BUNDLE_FILES = ("metrics.json", "splits.json", "config.json")


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _read_json(path: Path) -> dict[str, Any]:
    with open(path) as f:
        return json.load(f)


def count_silver_files(silver_dir: Path) -> int:
    return len(list(silver_dir.glob("*.parquet")))


def append_decision(decisions_path: Path, record: dict[str, Any]) -> None:
    decisions_path.parent.mkdir(parents=True, exist_ok=True)
    with open(decisions_path, "a") as f:
        f.write(json.dumps(record) + "\n")


def swap_bundle(staging: Path, champion: Path) -> None:
    """Move staged entries into the champion dir.

    Swap strategy (documented choice): the full new champion state is first
    built in ``<champion>/.staging`` so a crash during copying never touches
    the live champion. The swap then moves each top-level entry with
    ``os.replace`` (same-volume rename). A stale destination directory is
    removed first because ``os.replace`` cannot overwrite a non-empty
    directory on Windows; that remove-rename pair is the only non-atomic
    window and it is per-entry, never per-file.
    """
    for entry in sorted(staging.iterdir()):
        dest = champion / entry.name
        if dest.is_dir():
            shutil.rmtree(dest)
        entry.replace(dest)
    staging.rmdir()


def promote_bundle(candidate: Path, champion: Path) -> None:
    staging = champion / ".staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    copied = 0
    for name in BUNDLE_DIRS:
        src = candidate / name
        if src.is_dir():
            shutil.copytree(src, staging / name, dirs_exist_ok=True)
            copied += 1
    for name in BUNDLE_FILES:
        src = candidate / name
        if src.is_file():
            shutil.copy2(src, staging / name)
            copied += 1
    if copied == 0:
        shutil.rmtree(staging)
        raise FileNotFoundError(f"no bundle entries found in {candidate}")
    try:
        swap_bundle(staging, champion)
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def write_train_state(champion: Path, silver_dir: Path, source: Path) -> None:
    state = {
        "n_silver_files": count_silver_files(silver_dir),
        "promoted_at": _utc_now_iso(),
        "source": str(source),
    }
    with open(champion / "train_state.json", "w") as f:
        json.dump(state, f, indent=2)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pitwall.registry.promote_cli",
        description="Evaluate promotion gates and swap the champion bundle.",
    )
    parser.add_argument("--candidate", required=True, help="challenger bundle directory")
    parser.add_argument("--champion-dir", required=True, help="champion bundle directory")
    parser.add_argument("--config", default="configs/promotion.yaml", help="gate config yaml")
    parser.add_argument("--registry-dir", default="artifacts/registry", help="decision ledger dir")
    parser.add_argument(
        "--silver-dir", default=str(Path("data") / "silver" / "laps"), help="silver laps dir"
    )
    parser.add_argument("--dry-run", action="store_true", help="evaluate only, write nothing")
    parser.add_argument("--force", action="store_true", help="promote even when gates fail")
    return parser


def _verdict_lines(
    candidate: Path,
    champion: Path,
    gate_passed: bool | None,
    forced: bool,
    action: str,
    reasons: list[str],
    rc: int,
) -> list[str]:
    gate_label = "NOT EVALUATED" if gate_passed is None else ("PASS" if gate_passed else "FAIL")
    lines = [
        "=== PROMOTION VERDICT ===",
        f"candidate : {candidate}",
        f"champion  : {champion}",
        f"gate      : {gate_label}",
        f"forced    : {forced}",
        f"action    : {action}",
    ]
    if reasons:
        lines.append("reasons   :")
        lines.extend(f"  - {r}" for r in reasons)
    lines.append(f"exit      : {rc}")
    return lines


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    candidate = Path(args.candidate)
    champion = Path(args.champion_dir)
    decisions_path = Path(args.registry_dir) / "decisions.jsonl"

    cand_metrics = candidate / "metrics.json"
    champ_metrics = champion / "metrics.json"
    missing = [str(p) for p in (cand_metrics, champ_metrics) if not p.is_file()]
    if missing:
        reasons = [f"missing input: {p}" for p in missing]
        verdict = _verdict_lines(
            candidate, champion, None, False, "MISSING INPUTS", reasons, EXIT_MISSING_INPUTS
        )
        print("\n".join(verdict))
        if not args.dry_run:
            append_decision(
                decisions_path,
                {
                    "ts": _utc_now_iso(),
                    "candidate": str(candidate),
                    "passed": False,
                    "forced": False,
                    "reasons": reasons,
                    "promoted": False,
                },
            )
        return EXIT_MISSING_INPUTS

    result = check_promotion_from_files(champ_metrics, cand_metrics, cfg_path=args.config)
    gate_passed = bool(result["passed"])
    forced = bool(args.force) and not gate_passed
    will_promote = gate_passed or forced
    reasons: list[str] = result.get("reasons", [])

    if args.dry_run:
        action = "DRY-RUN (would promote)" if will_promote else "DRY-RUN (would block)"
        rc = EXIT_PROMOTED if gate_passed else EXIT_BLOCKED
    else:
        if will_promote:
            promote_bundle(candidate, champion)
            write_train_state(champion, Path(args.silver_dir), candidate)
        append_decision(
            decisions_path,
            {
                "ts": _utc_now_iso(),
                "candidate": str(candidate),
                "passed": gate_passed,
                "forced": forced,
                "reasons": reasons,
                "promoted": will_promote,
            },
        )
        action = "PROMOTED" if will_promote else "BLOCKED"
        rc = EXIT_PROMOTED if will_promote else EXIT_BLOCKED

    print("\n".join(_verdict_lines(candidate, champion, gate_passed, forced, action, reasons, rc)))
    return rc


if __name__ == "__main__":
    sys.exit(main())
