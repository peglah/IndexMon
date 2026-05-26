# IndexMon

Single-container Docker dashboard (nginx:80 → Express:3000) that polls Prowlarr + Autobrr for indexer health, plus qBittorrent tracker status.

## Commands
- **Docker**: `docker compose up --build` (single container from root `Dockerfile`)
- **Local dev**: `cd frontend && npm run dev` (Vite :5173 proxies `/api` → :3000) / `cd backend && npm run dev` (tsx watch, :3000)
- **Test**: `cd frontend && npm test` (Vitest+jsdom) / `cd backend && npm test` (Jest+supertest, needs `DB_PATH` for test DB)
- **Lint→typecheck order**: `cd frontend && npm run lint` (ESLint 9, `--max-warnings 0`) / `cd backend && npm run lint && npm run typecheck` (ESLint 8 `.eslintrc.json`)
- **Frontend install** requires `--legacy-peer-deps` (React 19 RC)
- **Migrations**: `cd backend && npx knex migrate:make <name>` / `npx knex migrate:latest`

## Auth
- Custom session. `POST /api/auth/login {"password":"..."}` → `{"token":"..."}`. Stored in `localStorage.token`, auto-attached via `utils/axios.ts` interceptor as `Authorization: Bearer`. 24h expiry.
- Random 24-char hex password generated on every startup and printed to logs (`=== Generated admin password: ${password} ===`). Override via `ADMIN_PASSWORD_HASH` env var (salted SHA-256 `salt:hash` hex, generate with `backend/scripts/hash.sh`). Password hash kept in-memory, not persisted to DB.
- `express-rate-limit` installed but only applied to `/api/auth/login` (10 req/15min), NOT globally.

## API
| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/login` | No | Rate-limited |
| `POST /api/auth/logout` | Yes | Deletes session row |
| `GET /api/indexers` | Yes | Fetches Prowlarr + Autobrr inline, writes history, computes downtime + 24h uptime %, fires Apprise alerts, merges qB data |
| `GET /api/indexers/history` | Yes | Maps `indexer_id`→`indexerId`, `last_checked`→`timestamp` |
 | `GET /api/indexers/icon/:prowlarrId` | No | Serves cached favicon (before auth middleware — `<img>` tags can't send headers). Detects PNG/ICO/SVG via magic bytes and text prefix. |
| `GET /health` | No | Returns `{ ok: true }` for Docker HEALTHCHECK |
| `GET /metrics` | No | Prometheus metrics (OpenMetrics format) |

## Metrics
- Exposed at `GET /metrics` (unauthenticated). Uses `prom-client` with `collectDefaultMetrics()` for Node.js process stats.
- Custom metrics:
  - `indexmon_poll_duration_seconds` — Histogram of full poll cycle duration (buckets: 1, 2, 5, 10, 20, 30s)
  - `indexmon_poll_total{result="success|failure"}` — Counter of poll cycles by result
  - `indexmon_upstream_reachable{service="prowlarr|autobrr|qbittorrent"}` — Gauge, 1 if reachable
  - `indexmon_history_rows` — Gauge of rows in `indexer_history` table

## Quirks
- **Prowlarr 2.x** drops the `status` field from `GET /api/v1/indexer`. Auto-disabled (failing) indexers detected via `GET /api/v1/health` → `IndexerStatusCheck` warning message (comma-separated names). Manually-disabled indexers detected via `enable` field on each indexer object. Header: `X-Api-Key`.
- **Autobrr**: endpoint `/api/irc` (not `/api/indexers`). Header `X-API-Token`. Health = `channel.monitoring && network.connected` only — `channel.enabled` is a user preference, NOT checked.
- **Name matching**: `normalize()` = lowercase, strip `(API)`, strip punctuation/whitespace/hyphens/`#`. Hardcoded aliases: `mtv`→`morethantv`, `td`→`torrentday`, `tl`→`torrentleech`.
- **Autobrr absent vs down**: No Autobrr entry → green (`—`, grey tile if `autobrrMissing`). With Autobrr but disconnected → yellow tile, red `DOWN` in table.
- **qBittorrent**: cookie-based auth (`POST /api/v2/auth/login`, re-auth on 403). Background `setInterval` polling (interval from `QBITTORRENT_POLL_INTERVAL_S`, default 300s). Caches ~28 tracker domains from 1000+ torrents. Domain suffix matching against `siteUrl`; `DOMAIN_OVERRIDES` map for mismatched domains (`hd-space.org`↔`hd-space.pw`, `rutracker.org`↔`t-ru.org`, `tday.love`↔`td-peers.com`). Config via env: `QBITTORRENT_BASE_URL`, `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD`.
- **Favicons**: discovers `<link rel="icon">` from each indexer's homepage (`siteUrl` from Prowlarr `indexerUrls[0]`), falls back to `/favicon.ico`. Cached in `/app/data/icons/`. 24h TTL ±30min jitter; force-downloaded on container restart (`firstPoll`).
- **Autobrr definitions**: fetched from GitHub API at startup and every 24h. Used to detect `autobrrMissing` (indexer in Prowlarr but absent in Autobrr).
- **Apprise alerts**: POST to `{APPRISE_API_URL}/notify`. `APPRISE_URLS` comma-separated. Skipped if `APPRISE_API_URL` unset. In-memory dedup via `alertedDownIds` Set (resets on restart). On any new down transition, lists ALL currently-down indexers. `ALERT_DELAY_MINUTES` (default `0` = immediate) delays alert until the indexer has been continuously down for that duration.
- **History**: transition-only inserts (only on up↔down state change). Downtime from most recent `up` entry. Availability = time-weighted percentage over 24h. Cleanup after 14 days.
- **Version**: from `process.env.APP_VERSION` (Docker build arg), NOT `package.json`. Shows `dev` locally.
- **DB**: SQLite. Runtime path from `DB_PATH` env (default `/app/data/indexmon.db`). Both knex runtime + `init-db.cjs` use `better-sqlite3` (single driver). `knexfile.ts` uses `data/db.sqlite` for migration CLI only (different path). To reset, delete the DB file — `init-db.cjs` recreates it on next startup with all tables and indexes.
- **Env vars**: all via `.env` injected by `docker-compose.yml`. No `VITE_` vars — polling interval hardcoded 15s, Vite proxy target hardcoded `http://localhost:3000`. Port 3000 also exposed on host.
- **`polling.ts`** exists but is dead code (not imported).
- **CollapsibleSection**: `overflow-hidden` only when collapsed — otherwise tooltips on StatusGrid tiles get clipped.
- **Dark mode**: `class` strategy. Inline `<script>` in `index.html` sets `dark` before React renders. Dashboard toggle persists to `localStorage.theme`; `matchMedia` listener keeps in sync. Login page has no toggle.

## Project Structure
- `backend/src/server.ts` — entrypoint, starts definition checker + qB polling
- `backend/src/app.ts` — Express app, registers icon route before auth middleware
- `backend/src/services/indexer.ts` — core logic: `fetchIndexers()`, Prowlarr/Autobrr fetch, history, alerts, icon caching, qB merge
- `backend/src/services/qbittorrent.ts` — qB client, cookie auth, domain cache, background polling
- `backend/src/services/definitions.ts` — GitHub API Autobrr definition fetcher
- `backend/src/services/apprise.ts` — alert dispatcher
- `backend/src/utils/metrics.ts` — Prometheus metric definitions and `/metrics` handler
- `frontend/src/pages/DashboardPage.tsx` — layout with dark toggle, 2-column grid (Overview left, Current Status right)
- `frontend/src/components/StatusGrid.tsx` — color-coded tiles with hover tooltips
- `frontend/src/components/IndexerTable.tsx` — table with icon, clickable name links, Prowlarr/Autobrr/qB columns

## CI/CD (`.github/workflows/ci.yml`)
- `lint-test` job: backend (install→lint→typecheck→test) then frontend (install→lint→test). Runs on all pushes/PRs to main.
- `build-and-publish` (needs lint-test, PRs only on `v*` tags): buildx, push to `ghcr.io/<owner>/<repo>`. `main` → `develop` tag, `v*` → semver + `latest`. `APP_VERSION` passed via build-arg from `steps.meta.outputs.version`.
- **Screenshot** (only on `v*` tags): starts container, waits for :80, runs `scripts/screenshot.mjs` (Playwright chromium with route interception for 10 mock indexers — no real services needed). Merges light+dark screenshots diagonally via `sharp`. Uploads to release.
- `contents: write` permission needed for release upload. Test DB uses `DB_PATH` env var.

## Logging
- `backend/src/utils/logger.ts`: lightweight wrapper with `LOG_LEVEL` env var (`debug`/`info`/`warn`/`error`, default `info`). Uses `[timestamp] [LEVEL]` prefix via native `console.*`.
- `debug`: per-tracker fetch results, favicon discovery/download failures.
- `info`: poll cycle boundaries, Prowlarr/Autobrr counts, DOWN indexer names, Apprise dispatch.
- `warn`: recoverable errors (qB login, Prowlarr health check, missing APPRISE_API_URL).
- `error`: unrecoverable failures and Express error handler stack traces.

## Testing
- **Backend**: Jest with `ts-jest`. Tests: auth (login + validation), normalize utility, indexer API. Needs `DB_PATH` env pointing to a writeable path (CI uses `./test-data/test.db`). `knex migrate:latest` runs in `beforeAll`.
- **Frontend**: Vitest with jsdom + `@testing-library/react`. `matchMedia` mocked in `setup-tests.ts`. Tests: login form, DashboardPage (loading, error, data states).
