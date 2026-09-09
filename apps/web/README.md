# PitWall ML Web Cockpit

Engineering telemetry and strategy cockpit for PitWall ML, built with Next.js and Tailwind CSS.

## Architecture and Deployment

The web cockpit supports two operational deployment modes:

### 1. Containerized Full-Stack Mode (Docker Compose)
- **Container**: Multi-stage build running `node server.js` from standalone Next.js output (`Dockerfile.web` or `apps/web/Dockerfile`).
- **Compose Service**: Runs on port `3000` alongside `api:8000`, `postgres`, `redis`, and `mlflow`.
- **API Proxying**: Next.js automatically rewrites `/api/*` requests to the internal FastAPI service (`API_URL=http://api:8000`), preventing cross-origin resource sharing (CORS) friction.
- **Run**:
  ```bash
  docker compose up -d web
  ```

### 2. Static Export Mode (GitHub Pages + GHCR Backend)
- **Static Export**: Built via `next build` with `STATIC_EXPORT=true` or `GITHUB_PAGES=true`, producing static HTML/JS assets in `out/`.
- **Backend Connection**: The static cockpit connects directly to the containerized Python API (`ghcr.io/arfaouiahmed1/pitwall-api:latest`) by setting `NEXT_PUBLIC_API_URL` during build:
  ```bash
  NEXT_PUBLIC_API_URL=https://api.pitwall.yourdomain.com npm run build
  ```
- **Fallback / Standby**: When the backend API is unreachable or no live race is active, the cockpit automatically operates in deterministic standby or historical replay mode without artificial jitter.
