import json
import sys
from pathlib import Path

import pytest

from pipelines.train import main as train_main
from pitwall.data.silver_validation import (
    SilverLakeValidationError,
    inspect_silver_lake,
    require_complete_silver_lake,
)


def _write_schedule(path: Path) -> Path:
    path.write_text(
        json.dumps(
            [
                {
                    "season": 2024,
                    "rounds": [
                        {"round": 1, "event_name": "Bahrain Grand Prix"},
                        {"round": 2, "event_name": "Saudi Arabian Grand Prix"},
                    ],
                }
            ]
        ),
        encoding="utf-8",
    )
    return path


def _touch_lap(silver_dir: Path, name: str, content: str = "parquet") -> None:
    silver_dir.mkdir(parents=True, exist_ok=True)
    (silver_dir / name).write_text(content, encoding="utf-8")


def test_complete_lake_matches_every_scheduled_race(tmp_path: Path) -> None:
    schedule = _write_schedule(tmp_path / "schedule.json")
    silver = tmp_path / "laps"
    _touch_lap(silver, "2024_Bahrain Grand Prix_R.parquet")
    _touch_lap(silver, "2024_Saudi Arabian Grand Prix_R.parquet")

    report = require_complete_silver_lake(silver, schedule)

    assert report.complete is True
    assert report.expected_count == 2
    assert report.present_count == 2
    assert report.missing == ()
    assert report.unexpected == ()
    assert report.empty == ()


def test_partial_or_extra_lake_is_rejected_before_training(tmp_path: Path) -> None:
    schedule = _write_schedule(tmp_path / "schedule.json")
    silver = tmp_path / "laps"
    _touch_lap(silver, "2024_Bahrain Grand Prix_R.parquet")
    _touch_lap(silver, "2024_Unexpected Grand Prix_R.parquet")

    report = inspect_silver_lake(silver, schedule)

    assert report.complete is False
    assert report.missing == ("2024_Saudi Arabian Grand Prix_R.parquet",)
    assert report.unexpected == ("2024_Unexpected Grand Prix_R.parquet",)
    with pytest.raises(SilverLakeValidationError, match=r"missing=1.*unexpected=1"):
        require_complete_silver_lake(silver, schedule)


def test_empty_expected_file_is_not_a_valid_seed_member(tmp_path: Path) -> None:
    schedule = _write_schedule(tmp_path / "schedule.json")
    silver = tmp_path / "laps"
    _touch_lap(silver, "2024_Bahrain Grand Prix_R.parquet", content="")
    _touch_lap(silver, "2024_Saudi Arabian Grand Prix_R.parquet")

    report = inspect_silver_lake(silver, schedule)

    assert report.complete is False
    assert report.empty == ("2024_Bahrain Grand Prix_R.parquet",)
    with pytest.raises(SilverLakeValidationError, match="empty=1"):
        require_complete_silver_lake(silver, schedule)


def test_production_trainer_refuses_to_use_synthetic_data(tmp_path: Path, monkeypatch) -> None:
    schedule = _write_schedule(tmp_path / "schedule.json")
    config = tmp_path / "production.yaml"
    config.write_text(
        "\n".join(
            [
                "data:",
                f"  silver_path: {tmp_path / 'missing-laps'}",
                f"  schedule_path: {schedule}",
                "  require_real_data: true",
            ]
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        sys,
        "argv",
        ["train", "--config", str(config), "--output-dir", str(tmp_path / "candidate")],
    )
    with pytest.raises(SilverLakeValidationError, match="missing=2"):
        train_main()
