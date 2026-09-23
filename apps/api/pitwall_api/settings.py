"""Typed runtime configuration for the stateless PitWall API service."""

from __future__ import annotations

import os
import secrets
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
    app_env: str = "development"
    live_api_key: str | None = None
    expose_metrics: bool = True
    expose_docs: bool = True

    def verify_api_key(self, provided: str | None) -> bool:
        """Perform constant-time comparison against configured secret; never log or reveal."""
        if self.live_api_key is None:
            return self.app_env != "production"
        if not provided:
            return False
        return secrets.compare_digest(provided, self.live_api_key)

    def is_origin_allowed(self, origin: str | None) -> bool:
        """Validate an HTTP or WebSocket Origin header against exact allowlist."""
        if origin is None:
            return self.app_env != "production"
        normalized = origin.strip().rstrip("/")
        return normalized in self.allowed_origins

    @classmethod
    def from_env(cls) -> ServingSettings:
        app_env = os.getenv("PITWALL_ENV", "development").strip().lower()
        raw_origins = os.getenv("PITWALL_ALLOWED_ORIGINS", DEFAULT_LOCAL_ORIGIN)
        origins = tuple(
            origin.strip().rstrip("/")
            for origin in raw_origins.split(",")
            if origin.strip()
        )
        if not origins:
            raise RuntimeError("PITWALL_ALLOWED_ORIGINS must contain at least one origin")

        raw_key = os.getenv("PITWALL_LIVE_API_KEY")
        live_api_key = raw_key.strip() if raw_key else None

        if app_env == "production":
            if any(origin == "*" for origin in origins):
                raise RuntimeError("Wildcard origin '*' is not allowed in production")
            if not live_api_key:
                raise RuntimeError("PITWALL_LIVE_API_KEY must be set in production (fail-closed)")

        expose_metrics = os.getenv("PITWALL_EXPOSE_METRICS", "true").strip().lower() in {
            "1",
            "true",
            "yes",
        }
        expose_docs = os.getenv("PITWALL_EXPOSE_DOCS", "true").strip().lower() in {
            "1",
            "true",
            "yes",
        }

        return cls(
            artifact_dir=Path(os.getenv("PITWALL_ARTIFACT_DIR", "artifacts/champion")),
            replay_root=Path(os.getenv("PITWALL_REPLAY_ROOT", "data/bronze")),
            allowed_origins=origins,
            openf1_cache_ttl_seconds=_positive_int_env(
                "PITWALL_OPENF1_CACHE_TTL_SECONDS",
                DEFAULT_OPENF1_CACHE_TTL_SECONDS,
                MAX_OPENF1_CACHE_TTL_SECONDS,
            ),
            app_env=app_env,
            live_api_key=live_api_key,
            expose_metrics=expose_metrics,
            expose_docs=expose_docs,
        )
