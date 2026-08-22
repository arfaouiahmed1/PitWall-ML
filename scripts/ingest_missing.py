#!/usr/bin/env python3
"""Ingest only the silver race files missing from data/silver/laps.

Reads configs/season_schedule.json (committed snapshot of the F1 calendar) and,
unless --all is passed, requires artifacts/champion/train_state.json to exist
(the champion's training-window anchor). For every scheduled Grand Prix the
expected silver file is data/silver/laps/{season}_{event}_R.parquet; only files
absent from disk are ingested by invoking `python -m pipelines.ingest`
sequentially (timeout-bounded, retried once, failures never abort the loop).

Modes:
    python scripts/ingest_missing.py             # ingest missing (needs champion state)
    python scripts/ingest_missing.py --dry-run   # list what would be ingested, change nothing
    python scripts/ingest_missing.py --all       # ignore champion state, fill from schedule

The last stdout line is always a JSON summary:
    {expected_count, existing_count, missing_count, ingested, skipped, failed,
     committed_n_silver_files, missing}

Exit codes: 0 ok/partial/dry-run, 1 every attempted ingest failed, 2 config error.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE_PATH = ROOT / "configs" / "season_schedule.json"
TRAIN_STATE_PATH = ROOT / "artifacts" / "champion" / "train_state.json"
SILVER_LAPS_DIR = ROOT / "data" / "silver" / "laps"
SESSION = "R"
INGEST_TIMEOUT_S = 900


def config_error(message: str) -> None:
    """Report a fatal configuration problem and exit with the config-error code."""
    print(f"config error: {message}", file=sys.stderr)
    raise SystemExit(2)


@dataclass(frozen=True, slots=True)
class ScheduledRace:
    season: int
    event_name: str

    @property
    def silver_file(self) -> Path:
        return SILVER_LAPS_DIR / f"{self.season}_{self.event_name}_{SESSION}.parquet"


@dataclass(frozen=True, slots=True)
class Plan:
    expected: tuple[ScheduledRace, ...]
    missing: tuple[ScheduledRace, ...]
    committed_n_silver_files: int | None


def load_schedule(path: Path) -> tuple[ScheduledRace, ...]:
    """Parse the committed schedule into an ordered, deduplicated race tuple."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        config_error(f"cannot read {path}: {exc}")
    except json.JSONDecodeError as exc:
        config_error(f"malformed JSON in {path}: {exc}")

    races: dict[tuple[int, str], ScheduledRace] = {}
    for season_entry in raw:
        season = int(season_entry["season"])
        seen_rounds: set[int] = set()
        for rnd in season_entry["rounds"]:
            round_number = int(rnd["round"])
            event_name = str(rnd["event_name"])
            if round_number <= 0 or "Grand Prix" not in event_name:
                continue
            if round_number in seen_rounds:  # sprint weekends share one round
                continue
            seen_rounds.add(round_number)
            races[(season, event_name)] = ScheduledRace(season, event_name)
    if not races:
        config_error(f"no Grand Prix rounds parsed from {path}")
    return tuple(races.values())


def build_plan(require_state: bool) -> Plan:
    races = load_schedule(SCHEDULE_PATH)
    committed_n: int | None = None
    if TRAIN_STATE_PATH.exists():
        try:
            state = json.loads(TRAIN_STATE_PATH.read_text(encoding="utf-8"))
            committed_n = int(state["n_silver_files"])
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            print(f"warning: unreadable {TRAIN_STATE_PATH} ({exc}); proceeding without baseline")
    elif require_state:
        config_error(
            f"{TRAIN_STATE_PATH} not found "
            "(champion state anchors incremental ingestion); pass --all to override"
        )
    missing = tuple(race for race in races if not race.silver_file.exists())
    return Plan(expected=races, missing=missing, committed_n_silver_files=committed_n)


def summary_line(plan: Plan, mode: str, ingested: int, failed: int) -> str:
    return json.dumps(
        {
            "mode": mode,
            "expected_count": len(plan.expected),
            "existing_count": len(plan.expected) - len(plan.missing),
            "missing_count": len(plan.missing),
            "ingested": ingested,
            "skipped": len(plan.expected) - len(plan.missing),
            "failed": failed,
            "committed_n_silver_files": plan.committed_n_silver_files,
            "missing": [f"{r.season}_{r.event_name}" for r in plan.missing],
        }
    )


def ingest_one(race: ScheduledRace) -> bool:
    """Run pipelines.ingest for one race; retry once; True on success."""
    cmd = [
        sys.executable,
        "-m",
        "pipelines.ingest",
        "--season",
        str(race.season),
        "--event",
        race.event_name,
        "--session",
        SESSION,
    ]
    for attempt in (1, 2):
        try:
            result = subprocess.run(
                cmd,
                cwd=ROOT,
                timeout=INGEST_TIMEOUT_S,
                check=False,
            )
        except subprocess.TimeoutExpired:
            print(
                f"[{race.season} {race.event_name}] attempt {attempt}: "
                f"timed out after {INGEST_TIMEOUT_S}s"
            )
            continue
        if result.returncode == 0:
            return True
        print(f"[{race.season} {race.event_name}] attempt {attempt}: exit {result.returncode}")
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="list missing races without ingesting"
    )
    parser.add_argument(
        "--all", action="store_true", help="ignore champion train_state requirement"
    )
    args = parser.parse_args(argv)

    plan = build_plan(require_state=not args.all)

    if args.dry_run:
        for race in plan.missing:
            print(f"would ingest: {race.silver_file.name}")
        print(summary_line(plan, mode="dry-run", ingested=0, failed=0))
        return 0

    if not plan.missing:
        print("nothing to ingest — silver lake already matches the schedule")
        print(summary_line(plan, mode="ingest", ingested=0, failed=0))
        return 0

    print(
        f"ingesting {len(plan.missing)} of {len(plan.expected)} races "
        f"(started {datetime.now(tz=UTC).isoformat(timespec='seconds')})"
    )
    ingested = 0
    failed: list[ScheduledRace] = []
    for race in plan.missing:
        if ingest_one(race):
            ingested += 1
        else:
            failed.append(race)

    print(summary_line(plan, mode="ingest", ingested=ingested, failed=len(failed)))
    if failed and ingested == 0:
        print(f"ALL ingests failed: {[f'{r.season}_{r.event_name}' for r in failed]}")
        return 1
    for race in failed:
        print(f"warning: failed to ingest {race.season}_{race.event_name} (continuing)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
