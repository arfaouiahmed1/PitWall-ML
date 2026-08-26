from pipelines.train import _fallback_smoke_split


def test_two_session_smoke_fallback_keeps_splits_disjoint() -> None:
    sessions = ["2024_R0", "2024_R1"]

    splits = _fallback_smoke_split(sessions)

    assert splits == {
        "train": ["2024_R0"],
        "validation": [],
        "test": ["2024_R1"],
    }
    assert set(splits["train"]).isdisjoint(splits["validation"])
    assert set(splits["train"]).isdisjoint(splits["test"])
    assert set(splits["validation"]).isdisjoint(splits["test"])
