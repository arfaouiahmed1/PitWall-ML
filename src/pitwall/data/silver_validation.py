"""Fail-closed validation for the race-level silver lake."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class SilverLakeReport:
    """Completeness report for the expected race-level silver files."""

    expected: tuple[str, ...]
    present: tuple[str, ...]
    missing: tuple[str, ...]
    unexpected: tuple[str, ...]
    empty: tuple[str, ...]

    @property
    def complete(self) -> bool:
        return not self.missing and not self.unexpected and not self.empty

    @property
    def expected_count(self) -> int:
        return len(self.expected)

    @property
    def present_count(self) -> int:
        return len(self.present)

    def summary(self) -> str:
        return (
            f"expected={self.expected_count} present={self.present_count} "
            f"missing={len(self.missing)} unexpected={len(self.unexpected)} "
            f"empty={len(self.empty)}"
        )


class SilverLakeValidationError(RuntimeError):
    """Raised when the silver lake is absent, partial, or contains extras."""

    def __init__(self, report: SilverLakeReport) -> None:
        self.report = report
        details = [report.summary()]
        if report.missing:
            details.append(f"missing={list(report.missing)}")
        if report.unexpected:
            details.append(f"unexpected={list(report.unexpected)}")
        if report.empty:
            details.append(f"empty={list(report.empty)}")
        super().__init__("Silver lake is not complete: " + "; ".join(details))


def _scheduled_rounds(raw: Any) -> list[tuple[int, str]]:
    """Return ordered, deduplicated Grand Prix identifiers from a schedule."""
    races: dict[tuple[int, str], None] = {}
    for season_entry in raw:
        season = int(season_entry["season"])
        seen_rounds: set[int] = set()
        for round_entry in season_entry["rounds"]:
            round_number = int(round_entry["round"])
            event_name = str(round_entry["event_name"])
            if round_number <= 0 or "Grand Prix" not in event_name:
                continue
            if round_number in seen_rounds:
                continue
            seen_rounds.add(round_number)
            races[(season, event_name)] = None
    return list(races)


def expected_silver_filenames(schedule_path: Path | str) -> tuple[str, ...]:
    """Return the exact race-level parquet names required by a schedule."""
    path = Path(schedule_path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read silver schedule {path}: {exc}") from exc

    try:
        races = _scheduled_rounds(raw)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"invalid silver schedule {path}: {exc}") from exc
    if not races:
        raise ValueError(f"silver schedule {path} contains no Grand Prix rounds")
    return tuple(sorted(f"{season}_{event}_R.parquet" for season, event in races))


def inspect_silver_lake(silver_dir: Path | str, schedule_path: Path | str) -> SilverLakeReport:
    """Inspect expected race files without mutating the lake."""
    root = Path(silver_dir)
    expected = expected_silver_filenames(schedule_path)
    expected_set = set(expected)
    actual = (
        {path.name for path in root.glob("*.parquet") if path.is_file()} if root.is_dir() else set()
    )

    present = tuple(sorted(actual & expected_set))
    missing = tuple(sorted(expected_set - actual))
    unexpected = tuple(sorted(actual - expected_set))
    empty = tuple(name for name in present if (root / name).stat().st_size == 0)
    return SilverLakeReport(
        expected=expected,
        present=present,
        missing=missing,
        unexpected=unexpected,
        empty=empty,
    )


def require_complete_silver_lake(
    silver_dir: Path | str, schedule_path: Path | str
) -> SilverLakeReport:
    """Return a complete report or fail closed before training."""
    report = inspect_silver_lake(silver_dir, schedule_path)
    if not report.complete:
        raise SilverLakeValidationError(report)
    return report
