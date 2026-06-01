# IndexMon

Single-container Docker dashboard (nginx:80 → Express:3000) that polls Prowlarr + Autobrr for indexer health, plus qBittorrent tracker status.

## Commands
- **Docker**: `docker compose up --build` (single container from root `Dockerfile`)
- **Local dev**: `cd frontend && npm run dev` (Vite :5173 proxies `/api` → :3000) / `cd backend && npm run dev` (tsx watch, :3000)
- **Lint→typecheck→test order**: `cd frontend && npm run lint && npm test` (ESLint 10 flat config, `--max-warnings 0`; Vitest+jsdom) / `cd backend && npm run lint && npm run typecheck && npm test` (ESLint 10 flat config `eslint.config.mjs`; Jest+supertest, needs `DB_PATH` for test DB or defaults `:memory:`)
- **Frontend install**: `cd frontend && npm ci`
- **Migrations**: `cd backend && npm run migrate:make <name>` / `npm run migrate` (uses `knexfile.ts` → `data/db.sqlite`, separate from runtime DB)

## Auth
- Cookie-based (httpOnly, `SameSite=strict`). Login returns `{ ok: true }` and sets a session cookie. Sessions stored in-memory Map, 24h expiry, cleaned every 15min.
- Random 24-char hex password generated on every startup and printed to logs (`=== Generated admin password: ${password} ===`). Override via `ADMIN_PASSWORD_HASH` env var (bcrypt hash, generate with `scripts/hash.sh` or `node scripts/hash-password.js`). When setting in `.env`, enclose the value in single quotes to prevent Docker Compose from interpreting `$` signs as variable expansion (e.g. `ADMIN_PASSWORD_HASH='$2a$10$...'`).
- `express-rate-limit` on `POST /api/auth/login` only (10 req/15min), NOT globally.
- Frontend uses `AuthContext` + `ProtectedRoute` component. Axios instance (`utils/axios.ts`) uses `withCredentials: true` for cookie forwarding, auto-redirects to `/login` on 401.
- `GET /api/auth/me` validates session (used on app mount).

## API
| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/login` | No | Rate-limited, returns `{ ok: true }` + sets httpOnly cookie |
| `POST /api/auth/logout` | Yes | Removes session from in-memory Map |
| `GET /api/auth/me` | Yes | Validates current session, used by AuthContext on mount |
| `GET /api/indexers` | Yes | Fetches Prowlarr + Autobrr inline, writes history, computes downtime + 24h uptime % (time-weighted), fires Apprise alerts, merges qB + tracker stats |
| `GET /api/indexers/history` | Yes | `?limit=1000&offset=0` (clamped 1–5000). Maps `indexer_id`→`indexerId`, `last_checked`→`timestamp` |
| `GET /api/indexers/icon/:prowlarrId` | No | Before auth middleware — `<img>` tags can't send cookies. Rate-limited (100/15min). Detects PNG/ICO/SVG via magic bytes |
| `POST /api/apprise/test` | Yes | Tests Apprise notification config with a test message |
| `GET /health` | No | Returns `{ ok: true }` for Docker HEALTHCHECK |
| `GET /metrics` | No | Prometheus metrics (OpenMetrics format) |

## StatusGrid Tile Colors

Composite "worst wins" — first matching priority determines tile color (defined in `frontend/src/components/StatusGrid.tsx:18-25`):

| Priority | Color | Condition | Source |
|----------|-------|-----------|--------|
| 1 | `bg-red-500` | `indexer.status === 'down'` | Prowlarr disabled/health failure |
| 2 | `bg-orange-500` | `qbittorrent.hasTorrents && !qbittorrent.working` | qB tracker errors |
| 3 | `bg-yellow-400` | Autobrr exists but not `connected && monitoring` | IRC not healthy |
| 4 | `bg-gray-400` | `autobrrMissing` | No Autobrr entry (definition exists) |
| 5 | `bg-amber-400` | `stats.ratio < 0.8` | Low buffer ratio |
| 6 | `bg-green-500` | Default | All good |

Animates `alert-pulse` on transitions to red/orange, `recover` on transitions away.

## Quirks
- **Prowlarr 2.x** drops `status` from `GET /api/v1/indexer`. Auto-disabled indexers detected via `GET /api/v1/health` → `IndexerStatusCheck` warning (comma-separated names). Manually-disabled via `enable` field. Header: `X-Api-Key`.
- **Autobrr**: endpoint `/api/irc`. Header `X-API-Token`. Health = `channel.monitoring && network.connected` — `channel.enabled` is user preference, NOT checked.
- **Name matching**: `normalize()` = lowercase, strip `(API)`, strip `[\s_-]+`. Channel aliases (mtv→morethantv, td→torrentday, tl→torrentleech) defined in `backend/src/services/indexer-fetcher.ts:62-66`.
- **Autobrr absent vs down**: No Autobrr entry → green (`—`), grey tile if `autobrrMissing`. With Autobrr but disconnected → yellow tile, red `DOWN`.
- **qBittorrent**: cookie-based auth (`POST /api/v2/auth/login`, re-auth on 403). Background `setInterval` polling (`QBITTORRENT_POLL_INTERVAL_S`, default 300s). Domain suffix matching with `DOMAIN_OVERRIDES` map (`backend/src/services/qbittorrent.ts:36-40`).
- **Favicons**: discovers `<link rel="icon">` from each indexer's `siteUrl` (Prowlarr `indexerUrls[0]`), falls back to `/favicon.ico`. Cached in `/app/data/icons/` (alongside DB). 24h TTL; force-downloaded on container restart. SSRF-protected via `isPrivateUrl()`.
- **Autobrr definitions**: fetched from GitHub API at startup and every 24h (±30min jitter) with 3 retries + exponential backoff. Used to detect `autobrrMissing`.
- **Apprise alerts**: `APPRISE_URLS` comma-separated. Skipped if unset. Two delivery paths: `ntfy://` URLs sent via direct HTTP API (axios) with `Icon` header from GitHub raw favicon; all others dispatched via bundled `apprise-go` binary (`--attach` with favicon SVG). In-memory + DB-persisted dedup via `alertedDownIds` Set + `alert_state` table (resets on container restart). `ALERT_DELAY_M` (default `0`) delays alert until indexer has been continuously down for that duration.
- **History**: transition-only inserts (only on up↔down state change per source: prowlarr/autobrr/qbittorrent). Downtime from most recent `up` entry per source. 24h uptime = time-weighted percentage from transition edges. Cleanup after 14 days (runs at most once per 24h).
- **DB**: SQLite. Runtime path from `DB_PATH` env (default `/app/data/indexmon.db`). Knex runtime + `init-db.cjs` use `better-sqlite3`. `knexfile.ts` uses `data/db.sqlite` for migration CLI only. WAL mode + 5000ms busy timeout.
- **`init-db.cjs`** creates `indexer_history` and `alert_state` tables at container startup (same schemas as knex migrations). Auth is in-memory Map, not DB-backed.
- **Version**: from `process.env.APP_VERSION` (Docker build arg), NOT `package.json`. Shows `dev` locally.
- **Logger**: structured JSON via `console.log`/`console.warn`. `LOG_LEVEL` env (debug/info/warn/error, default info). `requestIdMiddleware` attaches UUID per request for log correlation (`logger.child(id)`).
- **Env vars**: all via `.env` injected by `docker-compose.yml`. No `VITE_` vars — frontend polling interval hardcoded 15s, Vite proxy target hardcoded `http://localhost:3000`. `TRACKER_STATS_TTL_M` (default `1440`, `0` to disable) controls per-indexer stats refresh.
- **Tracker stats**: Fetches per-indexer stats from UNIT3D API (`/api/user`) using API keys extracted from Prowlarr indexer fields. Platform cache avoids re-probing non-UNIT3D indexers. Handles Prowlarr-masked apiKey values (`********`). SSRF protection via `isPrivateUrl()`. Runs on startup + every `TRACKER_STATS_TTL_M`.
- **10s timeouts** on all upstream `axios.get` calls (Prowlarr health, Prowlarr indexers, Autobrr IRC). 1 retry with 1s→2s backoff (exponential, capped at 10s).
- **Circuit breaker**: 3 consecutive Prowlarr/Autobrr failures → 60s cooldown before retrying. Implemented in `backend/src/services/indexer-fetcher.ts:33-49`.
- **Dark mode**: `class` strategy. Inline `<script>` in `index.html` sets `dark` before React renders. Dashboard toggle persists to `localStorage.theme`; `matchMedia` listener in `DashboardPage.tsx` stays in sync. Login page has no toggle.
- **CollapsibleSection**: uses CSS grid `grid-rows-[0fr]`/`grid-rows-[1fr]` transition with `overflow-hidden` only when collapsed. State persisted per-section in `localStorage`.
- **Graceful shutdown**: SIGTERM drains icon caches, closes server, stops qB/definition/tracker intervals, destroys knex. 10s forced exit timeout.
- **`/api/indexers` endpoint** returns `{ indexers, services }` structure. `services` includes reachability flags for prowlarr/autobrr/qbittorrent + `appriseConfigured` boolean.

## Project Structure (key files)
- `backend/src/server.ts` — entrypoint: sets password (env or random), inits definition checker + qB polling + tracker stats, graceful shutdown
- `backend/src/app.ts` — Express app: helmet, cookie-parser, requestId, httpMetrics middlewares; routes: auth (unprotected) → health/metrics/icon (unprotected but icon rate-limited) → indexers/apprise (behind auth)
- `backend/src/services/indexer.ts` — orchestrates `fetchIndexers()`: calls fetcher, merges data, records history, computes downtime/uptime, fires alerts, caches icons, records Prometheus metrics
- `backend/src/services/indexer-fetcher.ts` — Prowlarr + Autobrr HTTP fetching with retry, circuit breaker, channel alias resolution
- `backend/src/services/indexer-history.ts` — transition-only inserts, 24h time-weighted uptime, per-source downtime, 14d cleanup
- `backend/src/services/indexer-alerts.ts` — Apprise alert dispatch with in-memory + DB-persisted dedup, `ALERT_DELAY_M` support
- `backend/src/services/indexer-icons.ts` — favicon discovery, caching, SSRF protection
- `backend/src/services/qbittorrent.ts` — qB client: cookie auth with 403 re-auth, domain overrides, background polling
- `backend/src/services/definitions.ts` — GitHub API Autobrr definition fetcher (startup + every 24h with jitter)
- `backend/src/services/apprise.ts` — ntfy HTTP + apprise-go binary dispatcher
- `backend/src/services/tracker-stats.ts` — per-indexer UNIT3D stats with platform cache, Prowlarr field API key extraction
- `backend/src/middleware/auth.ts` — cookie-based session Map, Zod login validation, warn-logging on failure
- `backend/src/middleware/requestId.ts` — UUID per request, `res.locals.logger` for correlation
- `backend/src/middleware/httpMetrics.ts` — Prometheus HTTP metrics
- `backend/src/middleware/error.ts` — centralized error handler
- `backend/src/utils/normalize.ts` — indexer name string normalization
- `backend/src/utils/ssrf.ts` — private IP/host check for outbound requests
- `frontend/src/context/AuthContext.tsx` — provides `login`/`logout`/`isAuthenticated`/`loading`
- `frontend/src/components/ProtectedRoute.tsx` — redirects to `/login` if unauthenticated
- `frontend/src/components/StatusGrid.tsx` — color-coded tiles with hover tooltips + transition animations
- `frontend/src/components/IndexerTable.tsx` — responsive table with icon, clickable name, Prowlarr/Autobrr/qB + Buffer columns
- `frontend/src/components/CollapsibleSection.tsx` — collapsible card with localStorage-persisted state
- `frontend/src/components/ErrorBoundary.tsx` — class component wrapping router in `main.tsx`

## CI/CD (`.github/workflows/ci.yml`)
- **lint-test job**: Backend (install→lint→typecheck→test) then Frontend (install→lint→test) then Docker build (no push). Runs on all pushes/PRs to main. Node 22.
- **build-and-publish** (needs lint-test, push to main + `v*` tags): buildx, push to `ghcr.io/<owner>/<repo>`. `main` → `develop` tag, `v*` → semver + `latest`. `APP_VERSION` from metadata output.
- **Screenshot** (only on `v*` tags): starts container, runs `scripts/screenshot.mjs` (Playwright chromium, 10 mock indexers via route interception). Desktop 1280×900 full-page + mobile 412×915 Android phone frame. Uploads light+dark to release.
- Requires `contents: write` and `packages: write` permissions.

## Testing
- **Backend**: Jest + `ts-jest`. 8 test files: `auth.test.ts`, `apprise.test.ts`, `normalize.test.ts`, `indexers.test.ts` (route-level), `fetchIndexers.test.ts` (service-level), `indexer-alerts.test.ts`, `indexer-fetcher.test.ts`, `indexer-history.test.ts`. DB defaults to `:memory:` via `jest.config.js`; CI overrides with `DB_PATH=./test-data/test.db`. `knex.migrate.latest()` runs in `beforeAll`.
- **Frontend**: Vitest + jsdom + `@testing-library/react`. `matchMedia` mocked in `setup-tests.ts`. Tests: `frontend/tests/LoginPage.test.tsx`, `frontend/src/components/DashboardPage.test.tsx`, `frontend/src/components/IndexerTable.test.tsx`.
