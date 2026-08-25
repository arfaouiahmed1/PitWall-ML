"""Data helpers with lazy imports for lightweight validation utilities."""

from __future__ import annotations

from typing import Any

__all__ = ["build_silver_laps", "events_to_bronze_df", "write_bronze"]


def __getattr__(name: str) -> Any:
    """Load Polars-backed data helpers only when they are actually requested."""
    if name == "build_silver_laps":
        from pitwall.data.silver import build_silver_laps

        return build_silver_laps
    if name in {"events_to_bronze_df", "write_bronze"}:
        from pitwall.data.bronze import events_to_bronze_df, write_bronze

        return {"events_to_bronze_df": events_to_bronze_df, "write_bronze": write_bronze}[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
