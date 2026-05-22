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
- **Frontend install**: Requires `--legacy-peer-deps` (React 19 RC)

## Auth
- **Custom session auth**. `POST /api/auth/login` `{"password":"admin"}` → `{"token":"..."}`
- Token in `localStorage.token`, auto-attached via `utils/axios.ts` interceptor `Authorization: Bearer`. Backend validates against `sessions` table (24h expiry).
- Default password is `admin`. Override via `ADMIN_PASSWORD_HASH` env var (salted SHA-256, generate with `backend/scripts/hash.sh`).

## API
| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/login` | No | Body: `{password}` only |
| `POST /api/auth/logout` | Yes | Deletes session row |
| `GET /api/indexers` | Yes | Fetches Prowlarr + Autobrr inline, writes history, computes downtime + 24h uptime %, fires Apprise alerts |
| `GET /api/indexers/history` | Yes | Maps `indexer_id`→`indexerId`, `last_checked`→`timestamp` |
| `GET /api/indexers/icon/:prowlarrId` | No | Serves cached favicon from `/app/data/icons/` (no auth — `<img>` tags can't send headers) |

## Architecture
- **Frontend**: React 19 RC + React Router + TanStack Query + Tailwind (CSS vars for light/dark).
  - `DashboardPage.tsx`: two-column grid — `IndexerTable` (left) + `StatusGrid` (right). "Last checked" footer.
  - `StatusGrid.tsx`: 5-column grid of colored `aspect-square` tiles. Red (Prowlarr down) → Yellow (Autobrr down) → Green → Grey (autobrrMissing). Hover tooltip shows name.
  - `IndexerTable.tsx`: Favicon column (leftmost), Prowlarr column (green `UP` / red duration pill), Autobrr column (green `UP` / red `DOWN` / `—` when absent), Availability (no decimals, 24h window).
  - **Dark mode**: `class` strategy. Inline `<script>` in `index.html` sets `dark` class before React. Dashboard has Sun/Moon toggle persisting to `localStorage.theme`. Login page has no toggle.
  - `(API)` suffix stripped from indexer names in all displays.
  - Frontend polling via TanStack Query `refetchInterval` (15s hardcoded). No backend polling — `polling.ts` exists but is dead code.
- **Backend**: Express + Knex + Zod + helmet. `express-rate-limit` in deps but NOT wired.
  - **DB**: SQLite. Runtime path from `DB_PATH` env var, default `/app/data/indexmon.db`. `knexfile.ts` uses `data/db.sqlite` — only for migration CLI, not runtime.
  - **Two sqlite drivers**: `sqlite3` (knex) and `better-sqlite3` (`init-db.cjs` schema setup). Both are deps.
  - **Schema** (from `backend/scripts/init-db.cjs`): `users`, `sessions`, `indexer_history`
  - Backend dev uses `tsx watch` for hot reload.

## Quirks
- **Prowlarr field**: `enable` (not `enabled`). Header: `X-Api-Key`. Checks `status.disabledTill` — future date means Prowlarr auto-disabled the indexer (falls to `'down'`).
- **Autobrr**: Endpoint `/api/irc` (not `/api/indexers`). Header: `X-API-Token`. Status = `channel.monitoring && network.connected` (not `enabled`).
- **Name matching**: Normalized (lowercased, stripped punctuation/`#`/`(api)`/whitespace). Aliases: `mtv`→`morethantv`, `td`→`torrentday`, `tl`→`torrentleech`.
- **Autobrr absent vs down**: Indexer without Autobrr → green (`—` in table, green tile). Indexer with Autobrr that's disconnected/unmonitored → yellow tile, red `DOWN` in table.
- **Favicons**: Backend fetches `{indexer.siteUrl}/favicon.ico` directly from each indexer's domain (not Prowlarr media). Cached in `/app/data/icons/` with 24h TTL; force-downloaded on first poll after container start. `siteUrl` sourced from Prowlarr's `indexerUrls[0]`. Icon route detects PNG vs ICO via magic bytes. **No third-party fallback service**.
- **`CollapsibleSection`**: Inner wrapper `overflow-hidden` only applies when collapsed — otherwise tooltips clipped on mobile top row.
- **History**: Inserted on every `GET /api/indexers`. Downtime computed by querying most recent `up` entry per down indexer. Availability via `AVG(CASE WHEN status='up' THEN 100.0 ELSE 0 END)` over 24h window.
- **Alerts**: Apprise API. Backend POSTs `{urls, body, title}` to `{APPRISE_API_URL}/notify`. `APPRISE_URLS` comma-separated, empty entries filtered. If `APPRISE_API_URL` unset, alerts skipped. Alert dedup in-memory via `alertedDownIds` Set (reset on restart). On any new down transition, lists ALL currently-down indexers.
- **`ADMIN_PASSWORD_HASH`**: Salted SHA-256 (`salt$hash` hex). Unset → defaults to SHA-256 of `admin` (no salt). `init-db.cjs` runs `UPDATE` after `INSERT OR IGNORE` on every startup so hash refreshes when env var changes.
- **Env vars**: All via `.env` injected by `docker-compose.yml`. No `VITE_` vars (polling interval hardcoded, Vite proxy target hardcoded).
- **Port 3000** also exposed on host (not just via nginx proxy).
- **CI/CD**: GitHub Actions (`.github/workflows/ci.yml`). Push to main → `develop` image. Tag `v*` → semver + `latest`. Both pushed to `ghcr.io/<owner>/<repo>`. Lint/typecheck/test run on all pushes and PRs. Test DB path via `DB_PATH` env var.
