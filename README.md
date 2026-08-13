# IndexMon

<p align="center">
  <img src="frontend/public/favicon.svg" width="128" height="128" alt="IndexMon">
</p>

A Dockerized dashboard for monitoring indexer health by polling Prowlarr, Autobrr, and qBittorrent tracker status.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/peglah/indexmon/releases/latest/download/screenshot-dark.png">
  <img alt="IndexMon Dashboard" src="https://github.com/peglah/indexmon/releases/latest/download/screenshot-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/peglah/indexmon/releases/latest/download/screenshot-dark-mobile.png">
  <img alt="IndexMon Dashboard (mobile)" src="https://github.com/peglah/indexmon/releases/latest/download/screenshot-light-mobile.png">
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

Open http://localhost. If you set `ADMIN_PASSWORD_HASH` in `.env`, use that password. Otherwise grab the one-time password from `docker logs indexmon` — search for "Generated admin password".

## Architecture

Single container running nginx + Express (SQLite embedded in the Node process):

- **nginx** (:80) — serves the frontend build and proxies `/api/*` → Express
- **Express** (:3000) — backend API. `GET /api/indexers` returns a cached result immediately and triggers a background fetch from upstream services; first request reads from disk cache or returns empty state. A backend timer (`INDEXER_POLL_INTERVAL_S`, default 60s) also polls Prowlarr/Autobrr continuously, so history and alerts stay accurate even when the dashboard is closed.
- **SQLite** (`/app/data/indexmon.db`) — stores indexer history and alert state (no external DB needed)

Favicon caches live in `/app/data/icons/` alongside the database.

### Key Details

- **Dark mode**: Class-based theme with inline `<script>` in `index.html` to prevent flash. Toggle in dashboard persists to `localStorage.theme`.
- **Circuit breaker**: 3 consecutive Prowlarr/Autobrr failures → 60s cooldown before retrying.
- **SSRF protection**: Outbound requests to indexer sites, favicons, and tracker stats are checked against private IP ranges via `isPrivateUrl()`.
- **SQLite**: WAL mode with 5000ms busy timeout for better concurrency.
- **Name normalization**: Indexer names are lowercased, stripped of `(API)` and special characters. Channel aliases: `mtv`→`morethantv`, `td`→`torrentday`, `tl`→`torrentleech`.
- **Autobrr definitions**: Fetched from GitHub API at startup and every 24h (±30min jitter) with retry. Used to detect indexers missing from Autobrr.
- **Graceful shutdown**: On SIGTERM, drains icon caches, closes the HTTP server, stops polling intervals, and destroys the database connection (10s forced exit).
- **Nginx logging**: Structured JSON format (`time`, `remote_addr`, `status`, `request`) compatible with Loki.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PROWLARR_API_KEY` | Yes | — | Prowlarr API key (Settings → General) |
| `PROWLARR_BASE_URL` | No | `http://prowlarr:9696` | Prowlarr URL |
| `AUTOBRR_API_KEY` | No | — | Autobrr API key (Settings → API Keys) |
| `AUTOBRR_BASE_URL` | No | `http://autobrr:7474` | Autobrr URL |
| `ADMIN_PASSWORD_HASH` | No | random on each startup | Bcrypt hash (see Authentication below). Generate via `scripts/hash.sh yourpass`, `node backend/scripts/hash-password.js yourpass`, or `docker run --rm ghcr.io/peglah/indexmon hash-password yourpass`. |
| `APPRISE_URLS` | No | — | Comma-separated Apprise notification URLs (e.g. `ntfy://host/topic?token=...`). ntfy URLs sent via direct HTTP API with `Icon` header; all others via bundled `apprise-go` binary. Up to 3 delivery attempts with exponential backoff. |
| `ALERT_DELAY_M` | No | `0` | Minimum downtime (minutes) before an alert fires |
| `QBITTORRENT_BASE_URL` | No | `http://qbittorrent:8080` | qBittorrent Web UI URL (set `QBITTORRENT_USERNAME` to enable tracker checks) |
| `QBITTORRENT_USERNAME` | No | — | qBittorrent login username |
| `QBITTORRENT_PASSWORD` | No | — | qBittorrent login password |
| `QBITTORRENT_POLL_INTERVAL_S` | No | `300` | Tracker status poll interval in seconds |
| `INDEXER_POLL_INTERVAL_S` | No | `60` | Prowlarr/Autobrr status poll interval in seconds (backend timer, independent of the frontend) |
| `TRACKER_STATS_TTL_M` | No | `1440` | Per-indexer buffer/ratio refresh interval in minutes. `0` to disable. |
| `LOG_LEVEL` | No | `info` | Log level — `debug`, `info`, `warn`, or `error` |

qBittorrent is optional. If `QBITTORRENT_USERNAME` is unset, the qB column is hidden entirely.
Autobrr is optional. If `AUTOBRR_API_KEY` is unset, the Autobrr column is hidden entirely.

### Authentication

A random 24-character hex password is generated on every container start and printed to the logs:

```
=== Generated admin password: a1b2c3d4e5f6a7b8c9d0e1f2 ===
```

Set a persistent password via `ADMIN_PASSWORD_HASH` (bcrypt hash). When using `.env`, **wrap the hash in single quotes** to prevent Docker Compose from expanding `$` signs:

```ini
ADMIN_PASSWORD_HASH='$2a$10$...'
```

The login flow:

1. `POST /api/auth/login` with `{"password":"..."}` → returns `{"ok":true}` and sets an httpOnly session cookie
2. `GET /api/auth/me` validates the session (called on app mount)
3. `POST /api/auth/logout` destroys the session

Login is rate-limited to 10 attempts per 15 minutes.

## API Reference

| Endpoint | Auth | Description |
|---|---|---|
| `GET /health` | No | Returns `{"ok":true}` for Docker HEALTHCHECK |
| `GET /metrics` | No | Prometheus metrics (OpenMetrics format) |
| `GET /api/indexers/icon/:prowlarrId` | No | Cached favicon (PNG/ICO/SVG auto-detected). Rate-limited 500/15min. |
| `POST /api/auth/login` | No | Login with `{"password":"..."}`. Rate-limited 10/15min. |
| `GET /api/auth/me` | Yes | Session validation |
| `POST /api/auth/logout` | Yes | Destroy session, returns `{"message":"Logged out"}` |
| `GET /api/indexers` | Yes | Poll Prowlarr + Autobrr, return merged indexers with health, downtime, uptime %, qB tracker status, buffer stats. Rate-limited 900/15min. |
| `GET /api/indexers/history` | Yes | `?limit=1000&offset=0` (clamped 1–5000). Returns transition history. |
| `POST /api/apprise/test` | Yes | Send test Apprise notification |

`GET /api/indexers` returns `{ indexers: [...], services: { prowlarr, autobrr, qbittorrent, appriseConfigured } }`.

## Dashboard

### Tile Colors

Composite "worst wins" priority:

| Color | Condition | Meaning |
|-------|-----------|---------|
| 🟥 Red | Prowlarr reports down | Disabled or health check failure |
| 🟧 Orange | qB tracker errors | Seeding/swarming may be broken |
| 🟨 Yellow | Autobrr disconnected/not monitoring | Can't receive announces |
| 🟫 Amber | Buffer ratio < 0.80 | Low buffer risk |
| ⬜ Grey | No Autobrr entry exists despite known definition | Won't auto-grab |
| 🟩 Green | All healthy | — |

Animates `alert-pulse` on transitions to red/orange, `recover` on transitions away.

### Dark Mode

Toggle in the dashboard header persists to `localStorage.theme`. The theme is applied before React renders via an inline `<script>` in `index.html` to prevent flash. A `matchMedia` listener keeps the toggle in sync with the OS preference.

### Collapsible Sections

Dashboard sections ("Overview", "Current Status") use CSS grid transitions for smooth collapse/expand. Per-section state is persisted in `localStorage`.

### Prometheus Metrics

IndexMon exposes custom metrics at `GET /metrics` (unauthenticated) plus Node.js default metrics (CPU, memory, event loop lag):

| Metric | Type | Labels | Description |
|---|---|---|---|
| `indexmon_poll_duration_seconds` | Histogram | — | Duration of full poll cycle |
| `indexmon_poll_total` | Counter | `result` | Total poll cycles |
| `indexmon_upstream_reachable` | Gauge | `service` | Upstream reachability (prowlarr/autobrr/qbittorrent) |
| `indexmon_upstream_errors_total` | Counter | `service` | Upstream error count |
| `indexmon_circuit_breaker_open` | Gauge | `service` | Circuit breaker state (prowlarr/autobrr) |
| `indexmon_history_rows` | Gauge | — | Rows in `indexer_history` table |
| `indexmon_indexer_up` | Gauge | `indexer`, `source` | Per-indexer up(1)/down(0) per source |
| `indexmon_indexer_uptime_percentage` | Gauge | `indexer`, `source` | 24h time-weighted uptime % |
| `indexmon_announce_age_seconds` | Gauge | `indexer` | Seconds since last Autobrr announce |
| `indexmon_tracker_buffer_bytes` | Gauge | `indexer` | Per-indexer buffer in bytes |
| `indexmon_tracker_ratio` | Gauge | `indexer` | Per-indexer upload/download ratio |
| `indexmon_http_request_duration_seconds` | Histogram | `method`, `route`, `status` | HTTP request duration |
| `indexmon_http_requests_total` | Counter | `method`, `route`, `status` | HTTP request count |
| `indexmon_alert_sends_total` | Counter | `result` | Alert send count (success/failure) |

## Development

Single container (with nginx) or split processes with hot reload.

### Docker

```bash
docker compose up --build
```

Add `-p 3000:3000` if you need direct backend access alongside nginx.

### Local (no Docker)

Each service runs separately:

```bash
# Backend (port 3000, tsx watch)
cd backend && npm run dev

# Frontend (port 5173, proxies /api → 3000)
cd frontend && npm run dev
```

### Testing

```bash
# Frontend — lint then test
cd frontend && npm run lint && npm test

# Backend — lint, typecheck, then test
cd backend && npm run lint && npm run typecheck && npm test
```

Backend tests use an in-memory SQLite database by default (`jest.config.js` sets `DB_PATH=:memory:`). The CI overrides this with a file-based DB at `./test-data/test.db`.

Three test frameworks:

- **Frontend**: Vitest + jsdom + `@testing-library/react` (34 tests across 3 files)
- **Backend**: Jest + `ts-jest` + supertest (8 test files: auth, apprise, normalize, indexers routing, fetchIndexers service, indexer-alerts, indexer-fetcher, indexer-history)
- **Migrations**: Knex with `better-sqlite3` (run via `cd backend && npm run migrate`)

## Project Structure

```
indexmon/
├── Dockerfile                  Multi-stage build (frontend → backend → nginx)
├── docker-compose.yml          Container definition
├── nginx.conf                  Reverse proxy config
├── backend/
│   ├── src/
│   │   ├── server.ts           Entrypoint, graceful shutdown
│   │   ├── app.ts              Express middleware stack, route wiring
│   │   ├── services/           Polling logic (indexer, fetcher, history,
│   │   │                       alerts, icons, qbittorrent, definitions,
│   │   │                       apprise, tracker-stats)
│   │   ├── middleware/         auth, requestId, httpMetrics, error
│   │   ├── routes/             Express route handlers
│   │   ├── utils/              normalize, logger, metrics, ssrf
│   │   └── config/             database.ts (knex + better-sqlite3)
│   ├── migrations/             SQLite schema migrations
│   ├── scripts/                init-db.cjs, hash-password.js
│   └── tests/                  8 Jest test files
├── frontend/
│   └── src/
│       ├── context/            AuthContext
│       ├── components/         StatusGrid, IndexerTable, CollapsibleSection,
│       │                       ProtectedRoute, ErrorBoundary, ui/
│       ├── pages/              DashboardPage, LoginPage
│       ├── hooks/              useIndexers
│       └── utils/              axios instance, cn, stripApi
└── scripts/
    ├── docker-entrypoint.sh    Container entrypoint
    ├── hash.sh                 Password hash helper
    └── screenshot.mjs          Playwright release screenshots
```

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
