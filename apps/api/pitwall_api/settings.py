"""Typed runtime configuration for the stateless PitWall API service."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_LOCAL_ORIGIN = "http://localhost:3000"
DEFAULT_OPENF1_CACHE_TTL_SECONDS = 4
MAX_OPENF1_CACHE_TTL_SECONDS = 60


def _positive_int_env(name: str, default: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if not 1 <= value <= maximum:
        raise RuntimeError(f"{name} must be between 1 and {maximum}")
    return value


@dataclass(frozen=True)
class ServingSettings:
    artifact_dir: Path
    replay_root: Path
    allowed_origins: tuple[str, ...]
    openf1_cache_ttl_seconds: int

    @classmethod
    def from_env(cls) -> ServingSettings:
        origins = tuple(
            origin.strip().rstrip("/")
            for origin in os.getenv("PITWALL_ALLOWED_ORIGINS", DEFAULT_LOCAL_ORIGIN).split(",")
            if origin.strip()
        )
        if not origins:
            raise RuntimeError("PITWALL_ALLOWED_ORIGINS must contain at least one origin")
        return cls(
            artifact_dir=Path(os.getenv("PITWALL_ARTIFACT_DIR", "artifacts/champion")),
            replay_root=Path(os.getenv("PITWALL_REPLAY_ROOT", "data/bronze")),
            allowed_origins=origins,
            openf1_cache_ttl_seconds=_positive_int_env(
                "PITWALL_OPENF1_CACHE_TTL_SECONDS",
                DEFAULT_OPENF1_CACHE_TTL_SECONDS,
                MAX_OPENF1_CACHE_TTL_SECONDS,
            ),
        )
