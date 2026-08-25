#!/usr/bin/env python3
"""Bootstrap and validate the release-backed silver race seed."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path
from urllib.request import urlopen

from pitwall.data.silver_validation import (
    SilverLakeReport,
    inspect_silver_lake,
    require_complete_silver_lake,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "configs" / "silver_seed.json"
DEFAULT_SCHEDULE = ROOT / "configs" / "season_schedule.json"
DEFAULT_SILVER_DIR = ROOT / "data" / "silver" / "laps"


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_config(path: Path) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read seed config {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError(f"seed config {path} must contain an object")
    return raw


def _expected_count(config: dict[str, object]) -> int | None:
    value = config.get("expected_files")
    if value is None:
        return None
    try:
        count = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("seed config expected_files must be an integer") from exc
    if count <= 0:
        raise ValueError("seed config expected_files must be positive")
    return count


def _require_expected_count(report: SilverLakeReport, expected_count: int | None) -> None:
    if expected_count is not None and report.expected_count != expected_count:
        raise ValueError(
            f"silver seed schedule count {report.expected_count} "
            f"does not match config expected_files {expected_count}"
        )


def _extract_members(archive: Path, staging: Path) -> None:
    with tarfile.open(archive, mode="r:gz") as tar:
        members = tar.getmembers()
        if not members:
            raise ValueError("silver seed archive is empty")
        for member in members:
            name = Path(member.name)
            if not member.isfile() or name.name != member.name or name.suffix != ".parquet":
                raise ValueError(
                    "silver seed archive may contain only root-level regular .parquet files: "
                    f"{member.name}"
                )
            destination = staging / name.name
            extracted = tar.extractfile(member)
            if extracted is None:
                raise ValueError(f"cannot read silver seed member {member.name}")
            with destination.open("wb") as output:
                shutil.copyfileobj(extracted, output)


def bootstrap_archive(
    archive: Path | str,
    silver_dir: Path | str,
    schedule_path: Path | str,
    *,
    expected_sha256: str,
    expected_count: int | None = None,
) -> SilverLakeReport:
    """Verify and atomically stage a complete seed archive into ``silver_dir``."""
    archive_path = Path(archive)
    actual_sha256 = sha256_file(archive_path)
    if actual_sha256.lower() != expected_sha256.strip().lower():
        raise ValueError(
            "SHA-256 mismatch for silver seed archive: "
            f"expected {expected_sha256}, got {actual_sha256}"
        )

    destination = Path(silver_dir)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging_parent = Path(tempfile.mkdtemp(prefix="silver-seed-", dir=destination.parent))
    staging = staging_parent / "laps"
    staging.mkdir()
    try:
        _extract_members(archive_path, staging)
        report = require_complete_silver_lake(staging, schedule_path)
        _require_expected_count(report, expected_count)
        if destination.exists():
            shutil.rmtree(destination)
        staging.replace(destination)
        return report
    finally:
        shutil.rmtree(staging_parent, ignore_errors=True)


def _download(url: str, destination: Path) -> None:
    with urlopen(url, timeout=120) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def bootstrap_from_config(
    config_path: Path | str,
    silver_dir: Path | str = DEFAULT_SILVER_DIR,
    schedule_path: Path | str = DEFAULT_SCHEDULE,
) -> SilverLakeReport:
    """Download the configured public seed and bootstrap the silver lake."""
    config = _read_config(Path(config_path))
    url = config.get("asset_url")
    digest = config.get("sha256")
    if not isinstance(url, str) or not url:
        raise ValueError("seed config asset_url is required")
    if not isinstance(digest, str) or not digest:
        raise ValueError("seed config sha256 is required")

    archive_name = str(config.get("archive_name", "silver-laps-seed.tar.gz"))
    with tempfile.TemporaryDirectory(prefix="silver-seed-download-") as temp_dir:
        archive = Path(temp_dir) / archive_name
        _download(url, archive)
        return bootstrap_archive(
            archive,
            silver_dir,
            schedule_path,
            expected_sha256=digest,
            expected_count=_expected_count(config),
        )


def _report_json(report: SilverLakeReport) -> str:
    return json.dumps(
        {
            "complete": report.complete,
            "expected_count": report.expected_count,
            "present_count": report.present_count,
            "missing": list(report.missing),
            "unexpected": list(report.unexpected),
            "empty": list(report.empty),
        },
        sort_keys=True,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--sha256")
    parser.add_argument("--silver-dir", type=Path, default=DEFAULT_SILVER_DIR)
    parser.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    parser.add_argument("--download", action="store_true", help="download asset from --config")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)

    try:
        if args.validate_only:
            config = _read_config(args.config)
            report = inspect_silver_lake(args.silver_dir, args.schedule)
            if not report.complete:
                raise RuntimeError(f"{report.summary()}")
            _require_expected_count(report, _expected_count(config))
        elif args.download:
            report = bootstrap_from_config(args.config, args.silver_dir, args.schedule)
        elif args.archive is not None and args.sha256:
            report = bootstrap_archive(
                args.archive,
                args.silver_dir,
                args.schedule,
                expected_sha256=args.sha256,
            )
        else:
            parser.error("provide --download, or provide both --archive and --sha256")
    except Exception as exc:
        print(f"silver seed error: {exc}", file=sys.stderr)
        return 1

    print(_report_json(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
