.PHONY: bootstrap services ingest features train-pace evaluate replay monitoring test lint format clean

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
	$(PY) -m pitwall.pipeline.features --season $(or $(SEASON),2025)

train-pace:
	$(PY) -m pitwall.train.pace --config configs/development.yaml

evaluate:
	$(PY) -m pitwall.pipeline.evaluate --candidate artifacts/candidate --output artifacts/evaluation.json

replay:
	$(PY) -m pitwall.replay --season $(or $(SEASON),2025) --event "$(EVENT)" --speed $(or $(SPEED),20)

replay-max:
	$(PY) -m pitwall.replay --season $(SEASON) --event "$(EVENT)" --speed MAX

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
	$(PY) -m pitwall.data.quality --silver data/silver
