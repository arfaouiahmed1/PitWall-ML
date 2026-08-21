"""Data quality contracts — invariants logged, not silently dropped."""

from __future__ import annotations

from dataclasses import dataclass

import polars as pl


@dataclass
class QualityCheck:
    name: str
    passed: bool
    count: int
    severity: str  # info, warn, critical
    example: str | None = None


def check_silver_laps(df: pl.DataFrame) -> list[QualityCheck]:
    checks: list[QualityCheck] = []

    if df.is_empty():
        checks.append(QualityCheck("non_empty", False, 0, "critical", "silver laps empty"))
        return checks

    # driver_number non-null for driver events
    if "driver_number" in df.columns:
        nulls = df.filter(pl.col("driver_number").is_null()).height
        checks.append(
            QualityCheck(
                "driver_number_not_null", nulls == 0, nulls, "critical" if nulls > 0 else "info"
            )
        )

    # lap_number >=1
    if "lap_number" in df.columns:
        bad = df.filter((pl.col("lap_number") < 1) | pl.col("lap_number").is_null()).height
        checks.append(QualityCheck("lap_number_ge_1", bad == 0, bad, "warn"))

    # position 1..30
    if "position" in df.columns:
        bad = df.filter(
            pl.col("position").is_not_null()
            & ((pl.col("position") < 1) | (pl.col("position") > 30))
        ).height
        checks.append(QualityCheck("position_range", bad == 0, bad, "warn"))

    # tyre_age >=0
    if "tyre_age" in df.columns:
        bad = df.filter(pl.col("tyre_age").is_not_null() & (pl.col("tyre_age") < 0)).height
        checks.append(QualityCheck("tyre_age_ge_0", bad == 0, bad, "warn"))

    # lap_time sensible
    if "lap_time_s" in df.columns:
        bad = df.filter(
            pl.col("lap_time_s").is_not_null()
            & ((pl.col("lap_time_s") < 30) | (pl.col("lap_time_s") > 400))
        ).height
        checks.append(QualityCheck("lap_time_sensible", bad == 0, bad, "warn"))

    # compound known enum
    if "compound" in df.columns:
        known = {"SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET", "UNKNOWN"}
        bad = df.filter(~pl.col("compound").is_in(list(known))).height
        checks.append(
            QualityCheck(
                "compound_enum",
                bad == 0,
                bad,
                "info",
                example=str(
                    df.filter(~pl.col("compound").is_in(list(known)))["compound"]
                    .unique()
                    .to_list()[:3]
                )
                if bad
                else None,
            )
        )

    # missing rate
    for col in ["lap_time_s", "compound", "tyre_age"]:
        if col in df.columns:
            miss = df.filter(pl.col(col).is_null()).height
            rate = miss / max(df.height, 1)
            sev = "warn" if rate > 0.1 else "info"
            checks.append(QualityCheck(f"missing_{col}", rate < 0.5, miss, sev, f"{rate:.1%}"))

    # duplicate lap per driver/session
    if all(c in df.columns for c in ["session_id", "driver_number", "lap_number"]):
        dups = (
            df.group_by(["session_id", "driver_number", "lap_number"])
            .agg(pl.len().alias("n"))
            .filter(pl.col("n") > 1)
            .height
        )
        checks.append(QualityCheck("no_duplicate_lap", dups == 0, dups, "warn"))

    return checks


def quality_report(checks: list[QualityCheck]) -> dict:
    return {
        "checks": [
            {
                "name": c.name,
                "passed": c.passed,
                "count": c.count,
                "severity": c.severity,
                "example": c.example,
            }
            for c in checks
        ],
        "failed_critical": sum(1 for c in checks if not c.passed and c.severity == "critical"),
        "failed_warn": sum(1 for c in checks if not c.passed and c.severity == "warn"),
    }
