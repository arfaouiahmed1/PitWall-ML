.PHONY: bootstrap services services-all ingest ingest-bronze features train-pace evaluate mlops-loop mlops-status validate monitoring test test-all lint format clean api web docker-build

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

ingest-bronze:
	$(PY) -m pitwall.ingest.cli --year $(or $(YEAR),$(SEASON)) --output-dir $(or $(OUTPUT_DIR),data/bronze)

features:
	$(PY) -m pipelines.features

train-pace:
	$(PY) -m pipelines.train --config configs/development.yaml

evaluate:
	$(PY) -c "from pitwall.registry.promotion import check_promotion_from_files; import json; print(json.dumps(check_promotion_from_files('artifacts/champion/metrics.json', 'artifacts/candidate/metrics.json'), indent=2))"

# Local twin of .github/workflows/retrain.yml: ingest missing races ->
# train candidate -> gated promotion via the registry CLI.
mlops-loop:
	$(PY) scripts/ingest_missing.py
	$(PY) -m pipelines.train --config configs/production.yaml --output-dir artifacts/candidate
	$(PY) -m pitwall.registry.promote_cli --candidate artifacts/candidate --champion-dir artifacts/champion --config configs/promotion.yaml

# Pretty-print committed champion state + last 3 promotion decisions (if any).
mlops-status:
	$(PY) -c "import json,pathlib as p; s=p.Path('artifacts/champion/train_state.json'); print('champion train_state:'); print(json.dumps(json.loads(s.read_text()), indent=2)); d=p.Path('artifacts/champion/decisions.jsonl'); print('last decisions:'); [print(' ', l.rstrip()) for l in d.read_text().splitlines()[-3:]] if d.exists() else print('  (no decisions log yet)')"

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
