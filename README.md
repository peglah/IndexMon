# IndexMon

A Dockerized dashboard for monitoring indexer health by polling Prowlarr, Autobrr, and qBittorrent tracker status.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/peglah/indexmon/releases/latest/download/screenshot-dark.png">
  <img alt="IndexMon Dashboard" src="https://github.com/peglah/indexmon/releases/latest/download/screenshot-light.png">
</picture>

## Quick Start

```bash
cp .env.example .env
# Edit .env with your API keys
docker compose up --build
```

Or pull from GitHub Container Registry:

```bash
# Latest stable release
docker pull ghcr.io/peglah/indexmon:latest
# Latest development build
docker pull ghcr.io/peglah/indexmon:develop

docker run -d --name indexmon -p 80:80 \
  --env-file .env -v ./data:/app/data \
  ghcr.io/peglah/indexmon:latest
```

Then open http://localhost. If you set `ADMIN_PASSWORD_HASH` in `.env`, use that password. Otherwise, grab the one-time password from `docker logs indexmon` — search for "Generated admin password".

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PROWLARR_API_KEY` | Yes | — | Prowlarr API key (Settings → General) |
| `PROWLARR_BASE_URL` | No | `http://prowlarr:9696` | Prowlarr URL |
| `AUTOBRR_API_KEY` | Yes | — | Autobrr API key (Settings → API Keys) |
| `AUTOBRR_BASE_URL` | No | `http://autobrr:7474` | Autobrr URL |
| `ADMIN_PASSWORD_HASH` | No | random on each startup | Salted SHA-256 hash. Generate via `backend/scripts/hash.sh yourpass`. If unset, a random password is generated and printed to logs. |
| `APPRISE_API_URL` | No | — | HTTP endpoint of your Apprise API (e.g. `http://192.168.41.4:8084`) |
| `APPRISE_URLS` | No | — | Comma-separated Apprise notification URLs (e.g. `ntfy://host/topic?token=...`) |
| `ALERT_DELAY_MINUTES` | No | `0` | Minimum downtime (minutes) before an Apprise alert fires |
| `QBITTORRENT_BASE_URL` | No | `http://qbittorrent:8080` | qBittorrent Web UI URL (optional — omit to disable tracker checks) |
| `QBITTORRENT_USERNAME` | No | `admin` | qBittorrent login username |
| `QBITTORRENT_PASSWORD` | No | `admin` | qBittorrent login password |
| `QBITTORRENT_POLL_INTERVAL_S` | No | `300` | Tracker status poll interval in seconds |
| `LOG_LEVEL` | No | `info` | Log level — `debug`, `info`, `warn`, or `error` |
| `TRACKER_STATS_TTL_M` | No | `1440` | Per-indexer buffer/ratio refresh interval in minutes. `0` to disable. |
qBittorrent is optional. If `QBITTORRENT_BASE_URL` is unset or unreachable, the tracker status column shows `—` and is ignored for health calculations.

## Metrics

IndexMon exposes Prometheus-compatible metrics at `GET /metrics` (unauthenticated, OpenMetrics format). Includes Node.js process stats (CPU, memory, event loop lag) plus custom metrics for poll duration, upstream reachability, and history row counts.

## Development

In production, nginx on port 80 proxies all requests to the backend. Port 3000 is the backend's direct listen port — you only need host access for local development (e.g. curling the API directly or using Vite's dev proxy).

### Docker

```bash
docker compose up --build
```

Builds and runs the single container with nginx (:80) proxying to the backend (:3000). Add `-p 3000:3000` to `docker compose` or `docker run` if you need direct backend access during development.

### Local (no Docker)

Each service runs separately with hot reload:

```bash
# Backend (port 3000)
cd backend && npm run dev

# Frontend (port 5173, proxies /api to 3000)
cd frontend && npm run dev
```
