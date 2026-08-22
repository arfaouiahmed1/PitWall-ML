.PHONY: bootstrap services services-all ingest features train-pace evaluate validate monitoring test test-all lint format clean api web docker-build

PY := python
PIP := pip

bootstrap:
	$(PIP) install -e ".[dev,ml]"
	pre-commit install || true
	cp -n .env.example .env || true
	mkdir -p data/bronze data/silver data/gold

services:
	docker compose up -d postgres redis mlflow
	@echo "Waiting for services..."
	@sleep 5
	docker compose ps

services-all:
	docker compose --profile monitoring up -d

ingest:
	$(PY) -m pitwall.ingestion.cli --season $(SEASON) --event "$(EVENT)" --session $(or $(SESSION),R)

features:
	$(PY) -m pipelines.features

train-pace:
	$(PY) -m pipelines.train --config configs/development.yaml

evaluate:
	$(PY) -c "from pitwall.registry.promotion import check_promotion_from_files; import json; print(json.dumps(check_promotion_from_files('artifacts/champion/metrics.json', 'artifacts/candidate/metrics.json'), indent=2))"

monitoring:
	docker compose --profile monitoring up -d prometheus grafana

test:
	pytest tests/unit -q
	pytest tests/leakage -q

test-all:
	pytest -q

lint:
	ruff check .
	ruff format --check .
	mypy src apps/api

format:
	ruff check --fix .
	ruff format .

clean:
	docker compose down -v || true
	rm -rf artifacts/ mlartifacts/ .pytest_cache/ .ruff_cache/

api:
	uvicorn pitwall_api.main:app --reload --host 0.0.0.0 --port 8000

web:
	cd apps/web && npm run dev

docker-build:
	docker build -t pitwall-api:test .

# data quality
validate:
	$(PY) -c "import glob; import polars as pl; from pitwall.data.quality import check_silver_laps, quality_report; files = glob.glob('data/silver/**/*.parquet', recursive=True); df = pl.read_parquet(files) if files else pl.DataFrame(); print(quality_report(check_silver_laps(df)))"
