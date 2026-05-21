# IndexMon

A Dockerized dashboard for monitoring indexer health by polling Prowlarr and Autobrr.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your API keys
docker compose up --build
```

Then open http://localhost and log in with `admin` / `admin`.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PROWLARR_API_KEY` | Yes | — | Prowlarr API key (Settings → General) |
| `PROWLARR_BASE_URL` | No | `http://prowlarr:9696` | Prowlarr URL |
| `AUTOBRR_API_KEY` | Yes | — | Autobrr API key (Settings → API Keys) |
| `AUTOBRR_BASE_URL` | No | `http://autobrr:7474` | Autobrr URL |
| `ADMIN_PASSWORD_HASH` | No | `admin` | Salted SHA-256 hash. Generate via `backend/scripts/hash.sh yourpass` |
| `APRISE_URLS` | No | — | Comma-separated Apprise notification URLs |


## Development

```bash
# Backend (port 3000)
cd backend && npm run dev

# Frontend (port 5173, proxies /api to 3000)
cd frontend && npm run dev
```
