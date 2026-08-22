# Infrastructure parity — local Compose vs free-tier cloud

PitWall ML is zero-cloud-budget by design: everything runs locally through `compose.yaml`, and the public demo rides free tiers only. This document maps each Compose service to its free-tier cloud equivalent and names the constraint you accept in exchange. It is a migration map, not applied config: `infra/render.yaml` stays the current declarative source for Render, and no Terraform lives in this repo.

## Parity table

| Compose service | Image / build | Port | Free-tier equivalent | Constraint |
|---|---|---|---|---|
| postgres | `postgres:17-alpine` | 5432 | Render Postgres free or Neon free tier | Render free Postgres has an ephemeral disk (data lost on restart/redeploy); Neon autosuspends after idle, adding wake latency |
| redis | `redis:7-alpine` (AOF on) | 6379 | Upstash free tier | 10k commands/day cap; Streams (`XADD`/`XREADGROUP`) require RESP protocol, Upstash supports RESP alongside its REST API |
| mlflow | `ghcr.io/mlflow/mlflow:v2.13.0` (Postgres backend store) | 5000 | (a) MLflow on Render Free with SQLite backend, or (b) skip the hosted registry and promote via CI artifacts (`retrain.yml` → `promote.yml`) | Free tiers give no persistent artifact disk; option (a) loses multi-writer Postgres backend, acceptable for a solo project |
| api | built from `./Dockerfile`, runs `uvicorn pitwall_api.main:app` | 8000 | Render Free web service pulling `ghcr.io/arfaouiahmed1/pitwall-api:latest` (already published by `.github/workflows/publish-api.yml`) | Spins down after 15m idle (~30s cold start); ephemeral FS means `artifacts/` (models, metrics) must be baked into the image at build time |
| prometheus | `prom/prometheus:v2.53.1` (profile `monitoring`) | 9090 | Grafana Cloud free tier: hosted Prometheus fed by `remote_write` from local or Render | Scraping `localhost:8000/metrics` is impossible from the cloud; expose the API publicly or ship metrics via Grafana Agent |
| grafana | `grafana/grafana:11.1.0` (profile `monitoring`) | 3001→3000 | Grafana Cloud dashboards (same stack as above) | Provisioned dashboards/datasources under `monitoring/grafana/` must be re-imported manually |
| web | `apps/web` Next.js static export | 3000 (dev) | GitHub Pages, already live at https://arfaouiahmed1.github.io/PitWall-ML/ via `.github/workflows/deploy-pages.yml` | None; fully automated on push to `main` |

## What Terraform would own

Adopting Terraform would make these resources declarative instead of console clicks:

- `render_web_service` — the api service pulling the GHCR image, with env vars and `/health` check
- `render_postgres` — managed Postgres, wiring `DATABASE_URL`
- Upstash Redis (Upstash Terraform provider) — wiring `REDIS_URL`
- A GHCR registry credential so Render can pull the private image
- `grafana_cloud_stack` + `grafana_cloud_api_key` (Grafana provider) for hosted Prometheus
- Nothing for GitHub Pages: deployment is already declarative through `.github/workflows/deploy-pages.yml`

Status quo: `infra/render.yaml` is the current declarative source (Render Blueprint format). `PARITY.md` documents where Terraform would take over if the project outgrew free-tier click-ops.

## Example HCL snippet

```hcl
# NOTE: illustrative only — Render provider (terraform-provider-render) required; not applied in this repo

terraform {
  required_providers {
    render = {
      source  = "render-oss/render"
      version = "~> 1.7"
    }
  }
}

resource "render_web_service" "pitwall_api" {
  name    = "pitwall-api"
  plan_id = "free" # spins down after 15m idle, ~30s cold start
  region  = "frankfurt"

  # Pull the image published by .github/workflows/publish-api.yml
  image {
    owner_id              = var.render_owner_id
    registry_credential_id = render_registry_credential.ghcr.id
    image_path            = "ghcr.io/arfaouiahmed1/pitwall-api:latest"
  }

  env_vars = {
    DATABASE_URL        = { value = render_postgres.pitwall.database_connection_string }
    REDIS_URL           = { value = "rediss://default:${var.upstash_token}@pitwall.upstash.io:6379" }
    MLFLOW_TRACKING_URI = { value = "https://pitwall-mlflow.onrender.com" } # or CI-artifact promotion instead
  }

  health_check_path = "/health"
}
```

The same pattern extends to `render_postgres` and an Upstash-managed Redis resource; both feed the env vars above. Until then, `infra/render.yaml` plus the two workflows (`publish-api.yml`, `deploy-pages.yml`) remain the whole deployment story.
