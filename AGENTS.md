# IndexMon

Single-container Docker dashboard (nginx:80 → Express:3000) that polls Prowlarr + Autobrr for indexer health, plus qBittorrent tracker status.

## Commands
- **Docker**: `docker compose up --build` (single container from root `Dockerfile`)
- **Local dev**: `cd frontend && npm run dev` (Vite :5173 proxies `/api` → :3000) / `cd backend && npm run dev` (tsx watch, :3000)
- **Lint→typecheck→test order**: `cd frontend && npm run lint && npm test` (ESLint 9, `--max-warnings 0`; Vitest+jsdom) / `cd backend && npm run lint && npm run typecheck && npm test` (ESLint 8 `.eslintrc.json`; Jest+supertest, needs `DB_PATH` for test DB)
- **Frontend install** requires `--legacy-peer-deps` (React 19 RC)
- **Migrations**: `cd backend && npx knex migrate:make <name>` / `npx knex migrate:latest` (uses `knexfile.ts` → `data/db.sqlite`, separate from runtime DB)

## Auth
- In-memory Map (not DB-backed). `POST /api/auth/login {"password":"..."}` → `{"token":"..."}`. Stored in `localStorage.token`, auto-attached via `utils/axios.ts` interceptor as `Authorization: Bearer`. 24h expiry. Expired sessions cleaned every 15min.
- Random 24-char hex password generated on every startup and printed to logs (`=== Generated admin password: ${password} ===`). Override via `ADMIN_PASSWORD_HASH` env var (salted SHA-256 `salt:hash` hex, generate with `backend/scripts/hash.sh`). Password hash kept in-memory.
- `express-rate-limit` on `/api/auth/login` only (10 req/15min), NOT globally.

## API
| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/login` | No | Rate-limited |
| `POST /api/auth/logout` | Yes | Removes session from in-memory Map |
| `GET /api/indexers` | Yes | Fetches Prowlarr + Autobrr inline, writes history, computes downtime + 24h uptime % (time-weighted), fires Apprise alerts, merges qB data |
| `GET /api/indexers/history` | Yes | `?limit=1000&offset=0` (clamped 1–5000). Maps `indexer_id`→`indexerId`, `last_checked`→`timestamp` |
| `GET /api/indexers/icon/:prowlarrId` | No | Before auth middleware — `<img>` tags can't send headers. Detects PNG/ICO/SVG via magic bytes |
| `POST /api/apprise/test` | Yes | Tests Apprise notification config with a test message |
| `GET /health` | No | Returns `{ ok: true }` for Docker HEALTHCHECK |
| `GET /metrics` | No | Prometheus metrics (OpenMetrics format) |

## StatusGrid Tile Colors

Composite "worst wins" — first matching priority determines tile color:

| Priority | Color | Condition | Source |
|----------|-------|-----------|--------|
| 1 | `bg-red-500` | `indexer.status === 'down'` | Prowlarr disabled/health failure |
| 2 | `bg-orange-500` | `qbittorrent.hasTorrents && !qbittorrent.working` | qB tracker errors |
| 3 | `bg-yellow-400` | Autobrr exists but not `connected && monitoring` | IRC not healthy |
| 4 | `bg-amber-400` | `stats.ratio < 0.8` | Low buffer ratio |
| 5 | `bg-gray-400` | `autobrrMissing` | No Autobrr entry (definition exists) |
| 6 | `bg-green-500` | Default | All good |

Defined in `frontend/src/components/StatusGrid.tsx:19-26`. Animates `alert-pulse` on transitions to red/orange, `recover` on transitions away.

## Quirks
- **Prowlarr 2.x** drops `status` from `GET /api/v1/indexer`. Auto-disabled indexers detected via `GET /api/v1/health` → `IndexerStatusCheck` warning (comma-separated names). Manually-disabled via `enable` field. Header: `X-Api-Key`.
- **Autobrr**: endpoint `/api/irc` (not `/api/indexers`). Header `X-API-Token`. Health = `channel.monitoring && network.connected` — `channel.enabled` is user preference, NOT checked.
- **Name matching**: `normalize()` = lowercase, strip `(API)`, strip punctuation/whitespace/hyphens/`#`. Hardcoded aliases: `mtv`→`morethantv`, `td`→`torrentday`, `tl`→`torrentleech`. Defined in `backend/src/utils/normalize.ts`.
- **Autobrr absent vs down**: No Autobrr entry → green (`—`, grey tile if `autobrrMissing`). With Autobrr but disconnected → yellow tile, red `DOWN`.
- **qBittorrent**: cookie-based auth (`POST /api/v2/auth/login`, re-auth on 403 via `fetchTorrentsWithReauth()`). Background `setInterval` polling (`QBITTORRENT_POLL_INTERVAL_S`, default 300s). Domain suffix matching with `DOMAIN_OVERRIDES` map.
- **Favicons**: discovers `<link rel="icon">` from each indexer's `siteUrl` (Prowlarr `indexerUrls[0]`), falls back to `/favicon.ico`. Cached in `/app/data/icons/`. 24h TTL ±30min jitter; force-downloaded on container restart.
- **Autobrr definitions**: fetched from GitHub API at startup and every 24h. Used to detect `autobrrMissing`.
- **Apprise alerts**: Calls bundled `apprise-go` binary (Unraid Go port) via `child_process.execFile`. `APPRISE_URLS` comma-separated. Skipped if `APPRISE_URLS` unset. In-memory dedup via `alertedDownIds` Set (resets on restart). `ALERT_DELAY_M` (default `0`) delays alert until indexer has been continuously down for that duration. For `ntfy://` URLs, the notification is sent via direct HTTP API (axios) with `Icon` header for the favicon. `--attach /usr/share/nginx/html/favicon.svg` sends the SVG as file attachment for non-ntfy services. Binary at `/usr/local/bin/apprise-go`, downloaded in Dockerfile from `github.com/unraid/apprise-go`.
- **History**: transition-only inserts (only on up↔down state change). Downtime from most recent `up` entry. 24h uptime = time-weighted percentage from transition edges. Cleanup after 14 days.
- **DB**: SQLite. Runtime path from `DB_PATH` env (default `/app/data/indexmon.db`). Both knex runtime + `init-db.cjs` use `better-sqlite3`. `knexfile.ts` uses `data/db.sqlite` for migration CLI only. To reset, delete the DB file — `init-db.cjs` recreates tables on next startup.
- **`init-db.cjs`** creates `indexer_history` and `alert_state` tables at container startup (same schemas as knex migrations). Auth is in-memory Map, not DB-backed.
- **Version**: from `process.env.APP_VERSION` (Docker build arg), NOT `package.json`. Shows `dev` locally.
- **Env vars**: all via `.env` injected by `docker-compose.yml`. No `VITE_` vars — frontend polling interval hardcoded 15s, Vite proxy target hardcoded `http://localhost:3000`. `TRACKER_STATS_TTL_M` (default `1440`, `0` to disable) controls per-indexer stats refresh.

## Tracker API Limitations
- **UNIT3D-based trackers** (FearNoPeer, SkipTheCommercials, etc.): 
  - Standard `/api/user` endpoint **excludes** warning status and last login fields
  - Alternative endpoints (`/api/user/warnings`, `/users/{username}`, `/staff/warnings`) either:
    - Return "route not found"
    - Require different authentication
    - Only support POST methods
  - **Root cause**: Many trackers intentionally customize UNIT3D to remove sensitive fields from public API responses
  - **Workaround**: Manual website checks required for warning/login status on these trackers
- **Dark mode**: `class` strategy. Inline `<script>` in `index.html` sets `dark` before React renders. Dashboard toggle persists to `localStorage.theme`; `matchMedia` listener stays in sync. Login page has no toggle.
- **CollapsibleSection**: `overflow-hidden` only when collapsed — otherwise tooltips on StatusGrid tiles get clipped.
- **10s timeouts** on all 3 upstream `axios.get` calls (Prowlarr health, Prowlarr indexers, Autobrr IRC). 1 retry with 1s→2s backoff.
- **Circuit breaker**: 3 consecutive Prowlarr/Autobrr failures → 60s cooldown before retrying.

## Project Structure (key files)
- `backend/src/server.ts` — entrypoint: sets password (env or random), starts definition checker + qB polling + tracker stats, graceful shutdown (SIGTERM stops all intervals + knex.destroy)
- `backend/src/app.ts` — Express app: `/health`, `/metrics`, icon route before auth middleware, then `/api/indexers` + `/api/auth` behind auth
- `backend/src/services/indexer.ts` — core `fetchIndexers()`: Prowlarr/Autobrr fetch, history (transition-only inserts, downtime/uptime compute), alerts, icon caching, qB merge, Prometheus instrumentation
- `backend/src/services/qbittorrent.ts` — qB client: cookie auth with 403 re-auth, domain cache, background polling
- `backend/src/services/definitions.ts` — GitHub API Autobrr definition fetcher (startup + every 24h)
- `backend/src/services/apprise.ts` — alert dispatcher with in-memory dedup
- `backend/src/routes/apprise.ts` — `POST /api/apprise/test` test-notification endpoint behind auth
- `backend/src/services/tracker-stats.ts` — per-indexer stats (UNIT3D API), calls on startup
- `backend/src/middleware/auth.ts` — in-memory session Map, Zod login validation, warn-logging on failure
- `backend/src/config/database.ts` — knex config with WAL mode + 5000ms busy timeout
- `backend/src/utils/metrics.ts` — Prometheus metric definitions + `/metrics` handler
- `backend/src/utils/logger.ts` — `LOG_LEVEL` env (debug/info/warn/error, default info). Native `console.*` with `[timestamp] [LEVEL]` prefix
- `frontend/src/components/ErrorBoundary.tsx` — class component wrapping `<RouterProvider>` in `main.tsx`
- `frontend/src/components/IndexerTable.tsx` — table with icon, clickable name, Prowlarr/Autobrr/qB columns + Buffer
- `frontend/src/components/StatusGrid.tsx` — color-coded tiles with hover tooltips

## CI/CD (`.github/workflows/ci.yml`)
- `lint-test` job: backend (install→lint→typecheck→test) then frontend (install→lint→test). Runs on all pushes/PRs to main.
- `build-and-publish` (needs lint-test, main pushes + `v*` tags): buildx, push to `ghcr.io/<owner>/<repo>`. `main` → `develop` tag, `v*` → semver + `latest`. `APP_VERSION` from `steps.meta.outputs.version`.
- **Screenshot** (only on `v*` tags): starts container, runs `scripts/screenshot.mjs` (Playwright chromium, 10 mock indexers via route interception, no real services needed). Desktop screenshots are raw full-page captures at 1280×900. Mobile screenshots (412×915) are wrapped in an Android phone frame via `frameMobileShot()` — a pure HTML/CSS overlay using inline styles (rounded corners, bezel, inset shadow, centered on contrasting background). No extra npm deps beyond Playwright. Uploads light+dark screenshots (desktop + mobile framed) to release.
- `contents: write` permission needed for release upload.

## Testing
- **Backend**: Jest + `ts-jest`. 5 test files: auth, apprise, normalize, indexers (route-level), fetchIndexers (service-level). DB defaults to `:memory:` via `jest.config.js`; CI overrides with `DB_PATH=./test-data/test.db`. `knex.migrate.latest()` runs in `beforeAll`.
- **Frontend**: Vitest + jsdom + `@testing-library/react`. `matchMedia` mocked in `setup-tests.ts`. Tests: LoginPage, DashboardPage, IndexerTable.
