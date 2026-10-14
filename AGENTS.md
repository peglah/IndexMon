# IndexMon

Single-container Docker dashboard (nginx:80 → Express:3000) that polls Prowlarr + Autobrr for indexer health, plus qBittorrent tracker status.

## Commands

- **Node**: required `^22.22.2 || ^24.15.0 || >=26.0.0` (declared in both `package.json` `engines`; pinned to `26` in root `.nvmrc`). `engine-strict=true` in `backend/.npmrc` + `frontend/.npmrc` makes `npm ci` fail fast on a wrong Node instead of crashing at test runtime.
- **Docker**: `docker compose up --build` (single container from root `Dockerfile`)
- **Local dev**: `cd frontend && npm run dev` (Vite :5173 proxies `/api` → :3000) / `cd backend && npm run dev` (tsx watch, :3000)
- **Lint→typecheck→test order**: `cd frontend && npm run lint && npm test` (ESLint 10 flat config, `--max-warnings 0`; Vitest+jsdom, CI sets `NODE_OPTIONS=--no-webstorage`) / `cd backend && npm run lint && npm run typecheck && npm test` (ESLint 10 flat config `eslint.config.mjs`; Jest+supertest, `NODE_OPTIONS=--experimental-vm-modules` in npm script, DB defaults `:memory:` via `jest.config.js`)
- **Frontend install**: `cd frontend && npm ci`
- **Migrations**: `cd backend && npm run migrate:make <name>` / `npm run migrate` (uses `knexfile.ts` → `data/db.sqlite`, separate from runtime DB)

## Auth

- Cookie-based (httpOnly, `SameSite=strict`). Login returns `{ ok: true }` and sets a session cookie. Sessions stored in-memory Map, 24h expiry, cleaned every 15min.
- Random 24-char hex password generated on every startup and printed to logs (`=== Generated admin password: ${password} ===`). Override via `ADMIN_PASSWORD_HASH` env var (bcrypt hash, generate with `scripts/hash.sh` or `node scripts/hash-password.js`). When setting in `.env`, enclose the value in single quotes to prevent Docker Compose from interpreting `$` signs as variable expansion (e.g. `ADMIN_PASSWORD_HASH='$2a$10$...'`).
- `express-rate-limit` on `POST /api/auth/login` only (10 req/15min), NOT globally.
- Frontend uses `AuthContext` + `ProtectedRoute` component. Axios instance (`utils/axios.ts`) uses `withCredentials: true` for cookie forwarding, auto-redirects to `/login` on 401.
- `GET /api/auth/me` validates session (used on app mount).

## API

| Endpoint                             | Auth | Notes                                                                                                                                                                          |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/auth/login`               | No   | Rate-limited, returns `{ ok: true }` + sets httpOnly cookie                                                                                                                    |
| `POST /api/auth/logout`              | Yes  | Removes session from in-memory Map                                                                                                                                             |
| `GET /api/auth/me`                   | Yes  | Validates current session, used by AuthContext on mount                                                                                                                        |
| `GET /api/indexers`                  | Yes  | Rate-limited (900/15min). Fetches Prowlarr + Autobrr inline, writes history, computes downtime + 24h uptime % (time-weighted), fires Apprise alerts, merges qB + tracker stats |
| `GET /api/indexers/history`          | Yes  | `?limit=1000&offset=0` (clamped 1–5000). Maps `indexer_id`→`indexerId`, `last_checked`→`timestamp`                                                                             |
| `GET /api/indexers/icon/:prowlarrId` | No   | Before auth middleware — `<img>` tags can't send cookies. Rate-limited (500/15min). Detects PNG/ICO/SVG via magic bytes                                                        |
| `POST /api/apprise/test`             | Yes  | Tests Apprise notification config with a test message                                                                                                                          |
| `GET /health`                        | No   | Returns `{ ok: true }` for Docker HEALTHCHECK                                                                                                                                  |
| `GET /metrics`                       | No   | Prometheus metrics (OpenMetrics format)                                                                                                                                        |

## StatusGrid Tile Colors

Composite "worst wins" — first matching priority determines tile color. See `CODING_STANDARDS.md` (Tile Color Priority table) for the authoritative priority list. Defined in code at `frontend/src/components/StatusGrid.tsx:18-25`.

Animates `alert-pulse` on transitions to red/orange, `recover` on transitions away.

## Quirks

See `docs/quirks.md` for Prowlarr/Autobrr/qBittorrent edge cases.

## Project Structure (key files)

- `backend/src/server.ts` — entrypoint: sets password (env or random), inits definition checker + qB polling + tracker stats, graceful shutdown
- `backend/src/app.ts` — Express app: helmet, cookie-parser, requestId, httpMetrics middlewares; routes: auth (unprotected) → health/metrics/icon (unprotected but icon rate-limited) → indexers/apprise (behind auth)
- `backend/src/services/indexer.ts` — orchestrates `fetchIndexers()`: calls fetcher, merges data, records history, computes downtime/uptime, fires alerts, caches icons, records Prometheus metrics. Also hosts the autonomous poller (`startIndexerPolling`/`stopIndexerPolling`).
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

- **lint-test job**: Backend (install→lint→typecheck→test) then Frontend (install→lint→test) then Docker build (no push). Runs on all pushes/PRs to main. Node from root `.nvmrc` (`node-version-file`).
- Frontend tests run with `NODE_OPTIONS=--no-webstorage` (localStorage not available).
- **build-and-publish** (needs lint-test, push to main + `v*` tags): buildx, push to `ghcr.io/<owner>/<repo>`. `main` → `develop` tag, `v*` → semver + `latest`. `APP_VERSION` from metadata output.
- **Screenshot** (only on `v*` tags): starts container, runs `scripts/screenshot.mjs` (Playwright chromium, 10 mock indexers via route interception). Desktop 1280×900 full-page + mobile 412×915 Android phone frame. Uploads light+dark to release.
- Requires `contents: write` and `packages: write` permissions.

## Testing

- **Backend**: Jest + `ts-jest`. 8 test files: `auth.test.ts`, `apprise.test.ts`, `normalize.test.ts`, `indexers.test.ts` (route-level), `fetchIndexers.test.ts` (service-level), `indexer-alerts.test.ts`, `indexer-fetcher.test.ts`, `indexer-history.test.ts`. DB defaults to `:memory:` via `jest.config.js`; CI overrides with `DB_PATH=./test-data/test.db`. `knex.migrate.latest()` runs in `beforeAll`. Known accepted audit finding: `js-yaml@3` high (CVE-2026-59870, not backported) via `@istanbuljs/load-nyc-config` (jest coverage config parsing, dev-only) — cannot fix without a breaking v4 override.
- **Frontend**: Vitest + jsdom + `@testing-library/react`. `matchMedia` mocked in `setup-tests.ts`. Tests: `frontend/tests/LoginPage.test.tsx`, `frontend/src/components/DashboardPage.test.tsx`, `frontend/src/components/IndexerTable.test.tsx`. CI sets `NODE_OPTIONS=--no-webstorage`.
