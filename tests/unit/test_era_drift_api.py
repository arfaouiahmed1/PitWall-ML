"""HTTP contract tests for cached era drift and circuit configuration routes."""

from __future__ import annotations

import pitwall_api.main as main
from fastapi.testclient import TestClient


def test_era_drift_reports_no_data_without_both_eras() -> None:
    """Given no comparable pair of eras, GET reports no_data without fabricated rows."""
    response = TestClient(main.app).get("/monitoring/era-drift")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "no_data"
    assert payload["results"] == []
    assert payload["metric_count"] == 0
    assert payload["reason"] == "insufficient_era_metrics"


def test_openapi_documents_typed_responses_and_unknown_circuit_404() -> None:
    """Given the API schema, drift and circuit responses expose named models."""
    schema = main.app.openapi()

    assert schema["paths"]["/monitoring/era-drift"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("EraDriftResponse")
    circuits = schema["paths"]["/circuits"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert circuits.endswith("CircuitListResponse")
    detail = schema["paths"]["/circuits/{circuit_id}"]["get"]["responses"]
    assert detail["200"]["content"]["application/json"]["schema"]["$ref"].endswith("CircuitResponse")
    assert "404" in detail


def test_corrupt_parquet_cache_is_unavailable_and_api_import_survives(tmp_path, monkeypatch) -> None:
    """Given corrupt silver data, cache and fresh module import yield unavailable."""
    parquet_dir = tmp_path / "data" / "silver" / "laps"
    parquet_dir.mkdir(parents=True)
    (parquet_dir / "bad.parquet").write_bytes(b"not parquet")
    monkeypatch.chdir(tmp_path)

    report = main._build_era_drift_cache()
    assert report["status"] == "unavailable"
    assert report["reason"] == "unreadable_silver_laps"
    assert main.app.title


def test_era_drift_cache_refreshes_when_source_fingerprint_changes(tmp_path, monkeypatch) -> None:
    """Given changed parquet metadata, refreshing the cache records new fingerprint."""
    monkeypatch.chdir(tmp_path)
    first = main._build_era_drift_cache()
    parquet_dir = tmp_path / "data" / "silver" / "laps"
    parquet_dir.mkdir(parents=True)
    (parquet_dir / "broken.parquet").write_bytes(b"broken")
    second = main._build_era_drift_cache()

    assert first["source_fingerprint"] != second["source_fingerprint"]
    assert second["status"] == "unavailable"
    refreshed = main.refresh_era_drift_cache()
    assert refreshed.source_fingerprint == second["source_fingerprint"]


def test_circuits_lists_registered_configurations() -> None:
    """Given the backend registry, GET circuits lists each unique configured circuit."""
    response = TestClient(main.app).get("/circuits")

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == len(payload["circuits"])
    assert 0 < payload["count"] <= 13
    assert any(circuit["circuit_short_name"] == "Monza" for circuit in payload["circuits"])


def test_circuit_detail_resolves_monza() -> None:
    """Given a known circuit alias, GET returns its configured track details."""
    response = TestClient(main.app).get("/circuits/monza")

    assert response.status_code == 200
    payload = response.json()
    assert payload["circuit_short_name"] == "Monza"
    assert payload["circuit_name"] == "Autodromo Nazionale Monza"
    assert payload["total_laps"] == 53
    assert payload["segments"]


def test_circuit_detail_unknown_returns_404() -> None:
    """Given an unregistered circuit, GET returns HTTP 404."""
    response = TestClient(main.app).get("/circuits/not-a-circuit")

    assert response.status_code == 404
    assert response.json()["detail"] == "unknown_circuit"


def test_existing_monitoring_drift_unavailable_contract_is_preserved() -> None:
    """Given missing silver laps, existing GET monitoring drift keeps its response contract."""
    response = TestClient(main.app).get("/monitoring/drift")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] in {"unavailable", "error", "available"}
    assert "model_version" in payload
