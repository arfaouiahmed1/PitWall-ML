"""Unit and ASGI integration tests for CORS, authentication, secrets, and security headers."""

from __future__ import annotations

import os

import httpx
import pitwall_api.main as main
import pytest
from pitwall_api.settings import ServingSettings
from starlette.websockets import WebSocketDisconnect


def test_settings_development_defaults() -> None:
    settings = ServingSettings.from_env()
    assert settings.app_env in {"development", "test"}
    assert "http://localhost:3000" in settings.allowed_origins
    assert settings.verify_api_key(None) is True


def test_settings_production_requires_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PITWALL_ENV", "production")
    monkeypatch.delenv("PITWALL_LIVE_API_KEY", raising=False)
    monkeypatch.setenv("PITWALL_ALLOWED_ORIGINS", "https://pitwall.example.com")

    with pytest.raises(RuntimeError, match="PITWALL_LIVE_API_KEY"):
        ServingSettings.from_env()


def test_settings_production_rejects_wildcard_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PITWALL_ENV", "production")
    monkeypatch.setenv("PITWALL_LIVE_API_KEY", "prod-secret-key-12345")
    monkeypatch.setenv("PITWALL_ALLOWED_ORIGINS", "*")

    with pytest.raises(RuntimeError, match=r"[Ww]ildcard"):
        ServingSettings.from_env()


def test_settings_constant_time_key_comparison(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PITWALL_ENV", "production")
    monkeypatch.setenv("PITWALL_LIVE_API_KEY", "super-secret-key")
    monkeypatch.setenv("PITWALL_ALLOWED_ORIGINS", "https://pitwall.example.com")

    settings = ServingSettings.from_env()
    assert settings.verify_api_key("super-secret-key") is True
    assert settings.verify_api_key("wrong-secret-key") is False
    assert settings.verify_api_key("") is False
    assert settings.verify_api_key(None) is False


@pytest.mark.asyncio
async def test_cors_allowed_and_hostile_origins() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Allowed origin
        allowed_res = await client.get("/health", headers={"origin": "http://localhost:3000"})
        assert allowed_res.status_code == 200
        assert allowed_res.headers.get("access-control-allow-origin") == "http://localhost:3000"

        # Hostile origin
        hostile_res = await client.get("/health", headers={"origin": "https://hostile-site.com"})
        assert hostile_res.status_code == 200
        assert hostile_res.headers.get("access-control-allow-origin") is None


@pytest.mark.asyncio
async def test_cors_preflight_options() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Allowed preflight with X-Pitwall-API-Key header
        preflight = await client.options(
            "/live/start",
            headers={
                "origin": "http://localhost:3000",
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type, x-pitwall-api-key",
            },
        )
        assert preflight.status_code == 200
        assert preflight.headers.get("access-control-allow-origin") == "http://localhost:3000"
        allowed_headers = preflight.headers.get("access-control-allow-headers", "").lower()
        assert "x-pitwall-api-key" in allowed_headers
        assert "content-type" in allowed_headers

        # Hostile preflight
        hostile_preflight = await client.options(
            "/live/start",
            headers={
                "origin": "https://hostile-site.com",
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
        )
        assert hostile_preflight.headers.get("access-control-allow-origin") is None


@pytest.mark.asyncio
async def test_live_mutation_auth_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    # Configure production settings with required key
    test_settings = ServingSettings(
        artifact_dir=main.settings.artifact_dir,
        replay_root=main.settings.replay_root,
        allowed_origins=("http://localhost:3000",),
        openf1_cache_ttl_seconds=4,
        app_env="production",
        live_api_key="expected-prod-key-xyz",
    )
    monkeypatch.setattr(main, "settings", test_settings)

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Missing key -> 401
        res_no_key = await client.post("/live/start", json={"session_key": "latest"})
        assert res_no_key.status_code == 401
        assert "missing" in res_no_key.json()["detail"].lower()

        # Wrong key -> 403
        res_wrong_key = await client.post(
            "/live/start",
            json={"session_key": "latest"},
            headers={"X-Pitwall-API-Key": "wrong-key"},
        )
        assert res_wrong_key.status_code == 403
        assert "invalid" in res_wrong_key.json()["detail"].lower()

        # Valid key -> succeeds (200)
        res_valid_key = await client.post(
            "/live/start",
            json={"session_key": "latest"},
            headers={"X-Pitwall-API-Key": "expected-prod-key-xyz"},
        )
        assert res_valid_key.status_code == 200

        # Stop endpoint missing key -> 401
        stop_no_key = await client.post("/live/stop")
        assert stop_no_key.status_code == 401

        # Stop endpoint wrong key -> 403
        stop_wrong_key = await client.post(
            "/live/stop",
            headers={"X-Pitwall-API-Key": "wrong-key"},
        )
        assert stop_wrong_key.status_code == 403

        # Stop endpoint valid key -> succeeds
        stop_valid_key = await client.post(
            "/live/stop",
            headers={"X-Pitwall-API-Key": "expected-prod-key-xyz"},
        )
        assert stop_valid_key.status_code == 200


@pytest.mark.asyncio
async def test_security_headers_present_on_responses() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.headers.get("x-content-type-options") == "nosniff"
        assert response.headers.get("x-frame-options") in {"SAMEORIGIN", "DENY"}
        assert "strict-origin" in response.headers.get("referrer-policy", "").lower()


def test_websocket_origin_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    test_settings = ServingSettings(
        artifact_dir=main.settings.artifact_dir,
        replay_root=main.settings.replay_root,
        allowed_origins=("http://localhost:3000",),
        openf1_cache_ttl_seconds=4,
        app_env="production",
        live_api_key="secret",
    )
    monkeypatch.setattr(main, "settings", test_settings)

    with TestClient(main.app) as test_client:
        # Hostile origin handshake rejected with 1008
        with (
            pytest.raises(WebSocketDisconnect) as closed_hostile,
            test_client.websocket_connect(
                "/ws/race?replay_id=dummy&speed=MAX",
                headers={"origin": "http://evil-attacker.com"},
            ),
        ):
            pass
        assert closed_hostile.value.code == 1008

        # Missing origin in production rejected with 1008
        with (
            pytest.raises(WebSocketDisconnect) as closed_no_origin,
            test_client.websocket_connect("/ws/race?replay_id=dummy&speed=MAX"),
        ):
            pass
        assert closed_no_origin.value.code == 1008


@pytest.mark.asyncio
async def test_live_mutation_in_development_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    test_settings = ServingSettings(
        artifact_dir=main.settings.artifact_dir,
        replay_root=main.settings.replay_root,
        allowed_origins=("http://localhost:3000",),
        openf1_cache_ttl_seconds=4,
        app_env="development",
        live_api_key=None,
    )
    monkeypatch.setattr(main, "settings", test_settings)

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Development without key does not block mutation
        res = await client.post("/live/start", json={"session_key": "latest"})
        assert res.status_code == 200


@pytest.mark.asyncio
async def test_metrics_exposure_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    # Enabled
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        res_enabled = await client.get("/metrics")
        assert res_enabled.status_code == 200

        # Disabled
        disabled_settings = ServingSettings(
            artifact_dir=main.settings.artifact_dir,
            replay_root=main.settings.replay_root,
            allowed_origins=("http://localhost:3000",),
            openf1_cache_ttl_seconds=4,
            app_env="production",
            live_api_key="secret",
            expose_metrics=False,
        )
        monkeypatch.setattr(main, "settings", disabled_settings)
        res_disabled = await client.get("/metrics")
        assert res_disabled.status_code == 404


def test_compose_config_requires_secrets_and_accepts_dev_env() -> None:
    import shutil
    import subprocess

    if not shutil.which("docker"):
        pytest.skip("Docker CLI not available")

    # Bare config without secrets must fail closed
    empty_env = os.environ.copy()
    empty_env.pop("POSTGRES_PASSWORD", None)
    empty_env.pop("GRAFANA_ADMIN_PASSWORD", None)

    proc_bare = subprocess.run(
        ["docker", "compose", "config"],
        capture_output=True,
        text=True,
        env=empty_env,
        timeout=30,
    )
    assert proc_bare.returncode != 0
    assert "POSTGRES_PASSWORD is required" in proc_bare.stderr

    # Config with dev env file succeeds
    proc_dev = subprocess.run(
        ["docker", "compose", "--env-file", ".env.development", "config"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc_dev.returncode == 0

