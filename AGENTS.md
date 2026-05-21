# IndexMon Agent Guidance

## Commands
- **Docker**: `docker compose up --build` (single container, nginx:80 → frontend; `/api` → backend:3000)
- **Local Dev**:
  ```bash
  cd frontend && npm run dev    # Vite on :5173
  cd backend && npm run dev     # Express on :3000 via tsx watch
  ```
- **Test**: `cd frontend && npm test` (Vitest) / `cd backend && npm test` (Jest)
- **Lint/Typecheck**:
  ```bash
  cd frontend && npm run lint            # ESLint 9 flat config
  cd backend && npm run lint && npm run typecheck   # ESLint 8 (.eslintrc.json) + tsc --noEmit
  ```
  Command order: lint → typecheck → test (backend). Frontend build runs `tsc && vite build`.
- **Build backend**: `npx tsc -p tsconfig.json` (or `npm run build`)
- **Migrations**: `cd backend && npx knex migrate:make <name>` / `npx knex migrate:latest`
- **Frontend install**: `npm install --legacy-peer-deps` (required due to React 19 RC)

## Auth
- **Custom session auth**. `POST /api/auth/login` `{"password":"admin"}` → `{"token":"..."}`
- Token: random string stored in `sessions` table (24h expiry). Frontend keeps in `localStorage.token`, auto-attached via `utils/axios.ts` interceptor `Authorization: Bearer`. Backend validates against `sessions`.

## Alerts
- Alerts are routed through an **Apprise API** container (e.g. `caronc/apprise-api` or `lscr.io/linuxserver/apprise-api`).
- `APPRISE_API_URL` → the HTTP endpoint of the Apprise API (e.g. `http://192.168.41.4:8084`).
- `APPRISE_URLS` → Apprise-format notification URLs (e.g. `ntfy://host/topic?token=...`, `slack://...`).
- The backend POSTs `{urls, body, title}` to `{APPRISE_API_URL}/notify`. The Apprise API handles protocol translation.
- If `APPRISE_API_URL` is unset, alerts are skipped with a warning.

## API
| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/login` | No | SHA-256 (salted) validate against `users` table. Body: `{password}` only. |
| `POST /api/auth/logout` | Yes | Deletes session row |
| `GET /api/indexers` | Yes | Fetches Prowlarr + Autobrr inline, writes history, computes downtime + 24h uptime %, fires Apprise alerts |
| `GET /api/indexers/history` | Yes | Maps `indexer_id`→`indexerId`, `last_checked`→`timestamp` |

## Architecture
- **Frontend**: React 19 RC + React Router + TanStack Query + Tailwind (CSS vars for light/dark). **No Chart.js.**
  - `DashboardPage.tsx`: two-column grid — `IndexerTable` (left) + `StatusGrid` (right). "Last checked" footer in `YYYY-MM-DD hh:mm:ss`.
  - `StatusGrid.tsx`: 5-column grid of colored `aspect-square` tiles. Red (Prowlarr down) → Yellow (Autobrr down) → Green. Hover tooltip shows name.
  - `IndexerTable.tsx`: Prowlarr column (green `UP` / red duration pill), Autobrr column (green `UP` / red `DOWN` / `—` when absent), Availability (no decimals, 24h window).
  - **Dark mode**: `class` strategy. Inline `<script>` in `index.html` sets `dark` class before React. Dashboard has Sun/Moon toggle persisting to `localStorage.theme`. Listens to `prefers-color-scheme` when no manual override. Login page has no toggle.
  - `(API)` suffix stripped from indexer names in all displays.
  - Frontend polling via TanStack Query `refetchInterval` (hardcoded 15s). No backend polling — `polling.ts` exists but is dead code (not imported).
- **Backend**: Express + Knex + Zod + helmet. **No express-rate-limit wired up** (in deps but unused).
  - **DB**: SQLite. Runtime path from `DB_PATH` env var, default `/app/data/indexmon.db`. `knexfile.ts` uses `data/db.sqlite` — only used for migration CLI, not runtime.
  - **Two sqlite drivers**: `sqlite3` (used by knex) and `better-sqlite3` (used directly by `init-db.cjs`). Both are dependencies.
  - **Schema** (from `backend/scripts/init-db.cjs`): `users`, `sessions`, `indexer_history`
  - Backend dev uses `tsx watch` for hot reload.

## Quirks
- **Prowlarr field**: `enable` (not `enabled`). Header: `X-Api-Key`.
- **Autobrr**: Endpoint `/api/irc` (not `/api/indexers`). Header: `X-API-Token` (not `X-Api-Key`). Status = `channel.monitoring && network.connected`.
- **Name matching**: Normalized (lowercased, stripped punctuation/`#`/`(api)`/whitespace). Aliases: `mtv`→`morethantv`, `td`→`torrentday`, `tl`→`torrentleech`.
- **Autobrr absent vs down**: Indexer without Autobrr → green (`—` in table, green tile). Indexer with Autobrr that's disconnected/unmonitored → yellow tile, red `DOWN` in table.
- **History**: Inserted on every `GET /api/indexers` call. Downtime computed by querying most recent `up` entry per down indexer. Availability via `AVG(CASE WHEN status='up' THEN 100.0 ELSE 0 END)` over 24h window.
- **`APPRISE_API_URL`**: HTTP endpoint of the Apprise API. If unset, alerts are skipped with a warning.
- **`APPRISE_URLS`**: Comma-separated. Empty entries filtered via `.filter(Boolean)` at `apprise.ts:4`.
- **`ADMIN_PASSWORD_HASH`**: Salted SHA-256 hash (`salt$hash` hex). Generated via `backend/scripts/hash.sh yourpassword`. Unset → defaults to SHA-256 of `admin` (no salt). Checked in `init-db.cjs` on every startup; `UPDATE` after `INSERT OR IGNORE` ensures hash refreshes when env var changes.
- **Env vars**: All config via `.env` injected by `docker-compose.yml`. No `VITE_` vars (polling interval hardcoded, Vite proxy target hardcoded).
- **Port 3000 also exposed** on host (not just via nginx proxy), matching `docker-compose.yml`.
- **CI/CD**: GitHub Actions (`.github/workflows/ci.yml`). Push to main → `develop` image. Tag `v*` → semver + `latest` image. Both pushed to `ghcr.io/<owner>/<repo>`. Lint/typecheck/test run on all pushes and PRs. Test DB path via `DB_PATH` env var.
