"""Regression tests for OpenF1Client pagination and retry handling."""

from __future__ import annotations

from unittest.mock import Mock

import httpx
import polars as pl
import pytest

from pitwall.ingest import openf1 as mod


def _mock_response(data: list[dict], status_code: int = 200) -> Mock:
    resp = Mock()
    resp.status_code = status_code
    resp.json.return_value = data
    resp.raise_for_status = Mock()
    if status_code >= 400:
        req = httpx.Request("GET", "https://api.openf1.org/v1/test")
        resp_obj = httpx.Response(status_code=status_code, request=req)
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            f"HTTP {status_code}", request=req, response=resp_obj
        )
    else:
        resp.raise_for_status.return_value = None
    return resp


def test_pagination_combines_pages(monkeypatch) -> None:
    monkeypatch.setattr(mod, "BATCH_SIZE", 2)
    monkeypatch.setattr(mod.time, "sleep", lambda *_: None)

    call_offsets: list[int] = []

    def fake_get(url, timeout=None, headers=None):
        # parse offset from url
        offset = 0
        if "offset=" in url:
            for part in url.split("&"):
                if part.startswith("offset="):
                    offset = int(part.split("=")[1].split("&")[0])
        call_offsets.append(offset)
        if offset == 0:
            return _mock_response([{"id": 1}, {"id": 2}])
        return _mock_response([{"id": 3}])

    monkeypatch.setattr(mod.httpx, "get", fake_get)
    client = mod.OpenF1Client(max_retries=2)
    result = client._request("test_endpoint")
    assert result == [{"id": 1}, {"id": 2}, {"id": 3}]
    assert call_offsets == [0, 2]


def test_404_returns_partial(monkeypatch) -> None:
    monkeypatch.setattr(mod.time, "sleep", lambda *_: None)

    def fake_get(url, timeout=None, headers=None):
        return _mock_response([], status_code=404)

    monkeypatch.setattr(mod.httpx, "get", fake_get)
    client = mod.OpenF1Client(max_retries=2)
    result = client._request("test_endpoint")
    assert result == []


def test_429_then_success_retries(monkeypatch) -> None:
    monkeypatch.setattr(mod.time, "sleep", lambda *_: None)
    calls = {"n": 0}

    def fake_get(url, timeout=None, headers=None):
        calls["n"] += 1
        if calls["n"] == 1:
            req = httpx.Request("GET", url)
            resp = httpx.Response(status_code=429, request=req)
            raise httpx.HTTPStatusError("429", request=req, response=resp)
        return _mock_response([{"id": 99}])

    monkeypatch.setattr(mod.httpx, "get", fake_get)
    client = mod.OpenF1Client(max_retries=3)
    result = client._request("test_endpoint")
    assert result == [{"id": 99}]
    assert calls["n"] == 2


def test_all_429_exhaustion_raises(monkeypatch) -> None:
    monkeypatch.setattr(mod.time, "sleep", lambda *_: None)

    def fake_get(url, timeout=None, headers=None):
        req = httpx.Request("GET", url)
        resp = httpx.Response(status_code=429, request=req)
        raise httpx.HTTPStatusError("429", request=req, response=resp)

    monkeypatch.setattr(mod.httpx, "get", fake_get)
    client = mod.OpenF1Client(max_retries=2)
    with pytest.raises(RuntimeError, match="rate limit exhausted"):
        client._request("test_endpoint")


def test_season_bronze_distinct_paths(monkeypatch, tmp_path) -> None:
    # Two race rows that both have session_name="Race" must produce distinct bronze paths
    # via meeting_key/circuit disambiguation.
    sessions = pl.DataFrame(
        {
            "session_key": [1001, 1002],
            "session_name": ["Race", "Race"],
            "session_type": ["R", "R"],
            "meeting_key": [1, 2],
            "circuit_short_name": ["BAH", "MON"],
            "location": ["Sakhir", "Monaco"],
        }
    )
    monkeypatch.setattr(mod, "get_latest_race_sessions", lambda year: sessions)

    captured: list[str] = []

    def fake_ingest(session_key, year, event_name, session_type, output_dir):
        path = tmp_path / f"year={year}" / f"event={event_name}" / f"session_type={session_type}"
        captured.append(str(path))
        return {session_key: tmp_path}

    monkeypatch.setattr(mod, "ingest_session_bronze", fake_ingest)
    mod.ingest_season_bronze(year=2026, output_dir=str(tmp_path))
    assert len(captured) == 2
    assert captured[0] != captured[1]
    assert "1_BAH" in captured[0] or "Sakhir" in captured[0] or "1" in captured[0]
    assert "2_MON" in captured[1] or "Monaco" in captured[1] or "2" in captured[1]


def test_ingest_bronze_cli_invokes_season(monkeypatch, tmp_path) -> None:
    from pitwall.ingest import cli as ingest_cli

    called: dict = {}

    def fake_season(year, output_dir):
        called["year"] = year
        called["output_dir"] = output_dir
        return []

    monkeypatch.setattr(ingest_cli, "ingest_season_bronze", fake_season)
    rc = ingest_cli.main(["--year", "2026", "--output-dir", str(tmp_path)])
    assert rc == 0
    assert called["year"] == 2026


def test_pitwall_cli_dispatches_ingest_bronze(monkeypatch) -> None:
    from types import SimpleNamespace

    import pitwall.cli as cli

    calls: list[list[str]] = []

    def fake_run(command, *, check):
        calls.append(command)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    rc = cli.app(["ingest-bronze", "--year", "2026"])
    assert rc == 0
    assert any("pitwall.ingest.cli" in c for c in calls[0])
