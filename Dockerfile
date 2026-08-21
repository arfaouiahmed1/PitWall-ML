FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps for lightgbm, psycopg2, duckdb
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src ./src
COPY apps/api ./apps/api
COPY configs ./configs

RUN pip install --upgrade pip && pip install -e "."

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "pitwall_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
