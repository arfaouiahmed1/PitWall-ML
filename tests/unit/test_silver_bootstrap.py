import hashlib
import json
import tarfile
from pathlib import Path

import pytest

from pitwall.data.silver_validation import SilverLakeValidationError
from scripts.bootstrap_silver import bootstrap_archive


def _schedule(path: Path) -> Path:
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


def _archive(tmp_path: Path, names: list[str]) -> tuple[Path, str]:
    source = tmp_path / "source"
    source.mkdir()
    for name in names:
        (source / name).write_text("parquet", encoding="utf-8")
    archive = tmp_path / "seed.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name in names:
            tar.add(source / name, arcname=name)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    return archive, digest


def test_bootstrap_archive_replaces_partial_lake_only_after_validation(tmp_path: Path) -> None:
    schedule = _schedule(tmp_path / "schedule.json")
    archive, digest = _archive(
        tmp_path,
        [
            "2024_Bahrain Grand Prix_R.parquet",
            "2024_Saudi Arabian Grand Prix_R.parquet",
        ],
    )
    silver = tmp_path / "laps"
    silver.mkdir()
    (silver / "partial.parquet").write_text("old", encoding="utf-8")

    report = bootstrap_archive(archive, silver, schedule, expected_sha256=digest)

    assert report.complete is True
    assert sorted(path.name for path in silver.glob("*.parquet")) == [
        "2024_Bahrain Grand Prix_R.parquet",
        "2024_Saudi Arabian Grand Prix_R.parquet",
    ]


def test_bootstrap_archive_rejects_bad_digest_without_mutating_destination(tmp_path: Path) -> None:
    schedule = _schedule(tmp_path / "schedule.json")
    archive, _digest = _archive(tmp_path, ["2024_Bahrain Grand Prix_R.parquet"])
    silver = tmp_path / "laps"
    silver.mkdir()
    sentinel = silver / "sentinel.parquet"
    sentinel.write_text("keep", encoding="utf-8")

    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        bootstrap_archive(archive, silver, schedule, expected_sha256="0" * 64)

    assert sentinel.read_text(encoding="utf-8") == "keep"


def test_bootstrap_archive_rejects_partial_seed_without_mutating_destination(
    tmp_path: Path,
) -> None:
    schedule = _schedule(tmp_path / "schedule.json")
    archive, digest = _archive(tmp_path, ["2024_Bahrain Grand Prix_R.parquet"])
    silver = tmp_path / "laps"
    silver.mkdir()
    sentinel = silver / "sentinel.parquet"
    sentinel.write_text("keep", encoding="utf-8")

    with pytest.raises(SilverLakeValidationError):
        bootstrap_archive(archive, silver, schedule, expected_sha256=digest)

    assert sentinel.read_text(encoding="utf-8") == "keep"
