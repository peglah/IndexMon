# IndexMon

A Dockerized dashboard for monitoring indexer health by polling Prowlarr and Autobrr.

<img src="https://github.com/peglah/indexmon/releases/latest/download/screenshot.png" alt="IndexMon Dashboard">

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

Then open http://localhost and log in with `admin` / `admin`.

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
qBittorrent is optional. If `QBITTORRENT_BASE_URL` is unset or unreachable, the tracker status column shows `—` and is ignored for health calculations.

## Built with OpenCode

This project was created using [OpenCode](https://opencode.ai), an AI-powered coding assistant that helps build software through natural language collaboration.

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
