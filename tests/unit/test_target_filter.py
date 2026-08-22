"""Target hygiene filters — green-flag pairing and outlier trim (Q2)."""

import polars as pl

from pitwall.features.pace import build_pace_features


def _laps(times: list[float], statuses: list[str] | None = None) -> pl.DataFrame:
    rows = [
        {
            "session_id": "2024_R0",
            "driver_number": 44,
            "lap_number": i,
            "lap_time_s": t,
            "compound": "MEDIUM",
            "tyre_age": i - 1,
            "stint_no": 1,
            "position": 1,
            "is_valid_training_lap": True,
        }
        for i, t in enumerate(times, start=1)
    ]
    if statuses is not None:
        for row, status in zip(rows, statuses, strict=True):
            row["track_status"] = status
    return pl.DataFrame(rows)


def test_target_nulled_when_yellow_flanks_lap():
    # Given a driver whose lap 2 carries a multi-char yellow+safety-car status
    # When building pace features
    gold = build_pace_features(_laps([90.0] * 5, ["1", "2;4", "1", "1", "1"]))
    # Then targets touching the yellow lap are nulled, pure green pairs survive
    assert gold["next_clean_lap_s"].to_list() == [None, None, 90.0, 90.0, None]
    assert gold["is_valid_training_lap_target"].to_list() == [
        False,
        False,
        True,
        True,
        False,
    ]


def test_green_to_green_target_kept():
    # Given consecutive green laps ('1' and separator-only '1;' are both green)
    # When building pace features
    times = [90.0, 90.5, 91.0, 91.5, 92.0]
    gold = build_pace_features(_laps(times, ["1", "1;", "1", "1", "1"]))
    # Then every green->green pair keeps its shifted next-lap target
    assert gold["next_clean_lap_s"].to_list() == [90.5, 91.0, 91.5, 92.0, None]


def test_outlier_trim_nulls_spike_next_lap():
    # Given a stable ~90s pace with a single 120s spike at lap 7
    # When building pace features (rolling_median_5 available from lap 6)
    times = [90.0] * 6 + [120.0, 90.0]
    gold = build_pace_features(_laps(times, ["1"] * 8))
    # Then only the row whose NEXT lap exceeds 1.07x its rolling median is trimmed;
    # lap 5 keeps its target because its rolling median is not yet available
    assert gold["next_clean_lap_s"].to_list() == [90.0] * 5 + [None, 90.0, None]
