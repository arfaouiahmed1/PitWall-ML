import polars as pl

from pitwall.evaluation.splits import chronological_race_split


def test_chronological_split_no_leakage():
    rows = [
        {"session_id": f"2024_R{i}", "driver_number": 1, "lap_time_s": 90.0}
        for i in range(6)
        for _ in range(5)
    ]
    df = pl.DataFrame(rows)
    splits = chronological_race_split(df, n_test_races=2, n_val_races=1)
    # train/test disjoint
    assert set(splits["train"]).isdisjoint(splits["test"])
    assert set(splits["train"]).isdisjoint(splits["validation"])
    assert set(splits["validation"]).isdisjoint(splits["test"])
    # chronological order preserved (train sessions earlier lexicographically)
    all_sessions = splits["train"] + splits["validation"] + splits["test"]
    assert all_sessions == sorted(all_sessions)
