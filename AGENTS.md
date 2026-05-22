# IndexMon

## Commands
- **Docker**: `docker compose up --build` (single container; nginx:80 `/api` → backend:3000)
- **Local Dev**: `cd frontend && npm run dev` (Vite :5173) / `cd backend && npm run dev` (Express :3000 via tsx watch)
- **Test per package**: `cd frontend && npm test` (Vitest) / `cd backend && npm test` (Jest)
- **Lint/Typecheck order**: `cd frontend && npm run lint` (ESLint 9 flat config, `--max-warnings 0`) / `cd backend && npm run lint && npm run typecheck` (ESLint 8 `.eslintrc.json` + `tsc --noEmit`)
- **Frontend build**: `tsc && vite build` (via `npm run build`)
- **Backend build**: `npx tsc -p tsconfig.json` (or `npm run build`)
- **Migrations**: `cd backend && npx knex migrate:make <name>` / `npx knex migrate:latest`
- **Frontend install**: requires `--legacy-peer-deps` (React 19 RC)

## Auth
- Custom session auth. `POST /api/auth/login {"password":"admin"}` → `{"token":"..."}`. Token in `localStorage.token`, auto-attached via `utils/axios.ts` interceptor (`Authorization: Bearer`). Backend validates against `sessions` table (24h expiry).
- Default password `admin`. Override via `ADMIN_PASSWORD_HASH` env var (salted SHA-256 `salt$hash` hex, generate with `backend/scripts/hash.sh`). `init-db.cjs` runs UPDATE on every startup so hash refreshes when env var changes.

## API
| Endpoint | Auth | Notes |
|---|---|---|
| `POST /api/auth/login` | No | Body: `{password}` only |
| `POST /api/auth/logout` | Yes | Deletes session row |
| `GET /api/indexers` | Yes | Fetches Prowlarr + Autobrr inline, writes history, computes downtime + 24h uptime %, fires Apprise alerts |
| `GET /api/indexers/history` | Yes | Maps `indexer_id`→`indexerId`, `last_checked`→`timestamp` |
| `GET /api/indexers/icon/:prowlarrId` | No | Serves cached favicon from `/app/data/icons/` (no auth — `<img>` tags can't send headers). Before auth middleware in `app.ts`. Detects PNG vs ICO via magic bytes. |

## Key Quirks
- **Prowlarr indexer**: uses `enable` (not `enabled`). Header `X-Api-Key`. Checks `status.disabledTill` — future date means Prowlarr auto-disabled (→ `down`).
- **Autobrr**: endpoint `/api/irc` (not `/api/indexers`). Header `X-API-Token`. Health = `channel.monitoring && network.connected` only — `channel.enabled` must NOT be checked (user preference, not error).
- **Name matching**: normalized (lowercased, stripped `(API)`/punctuation/`#`/whitespace). Aliases: `mtv`→`morethantv`, `td`→`torrentday`, `tl`→`torrentleech`.
- **Autobrr absent vs down**: Indexer without Autobrr → green (`—` in table, green tile). With Autobrr but disconnected → yellow tile, red `DOWN`.
- **Favicons**: fetched from each indexer's own domain (`{siteUrl}/favicon.ico`), not Prowlarr media. Cached in `/app/data/icons/`. 24h TTL ±30min jitter; force-downloaded on first poll (container restart). `siteUrl` from Prowlarr `indexerUrls[0]`. No third-party fallback service.
- **Autobrr definitions**: fetched from GitHub API at startup and every 24h (jitter computed **once** at init, not per cycle — stale jitter bug). Used to detect `autobrrMissing` (indexer expected in Prowlarr but absent in Autobrr).
- **Alerts**: Apprise API POST `{urls, body, title}` to `{APPRISE_API_URL}/notify`. `APPRISE_URLS` comma-separated. Skipped if `APPRISE_API_URL` unset. In-memory dedup via `alertedDownIds` Set (resets on restart). On any new down transition, lists ALL currently-down indexers. `(API)` suffix stripped from names.
- **History**: inserted on every `GET /api/indexers`. Downtime from most recent `up` entry per down indexer. Availability = `AVG(CASE WHEN status='up' THEN 100.0 ELSE 0 END)` over 24h.
- **CollapsibleSection**: `overflow-hidden` only when collapsed — otherwise tooltips on StatusGrid tiles get clipped.
- **Dark mode**: `class` strategy. Inline `<script>` in `index.html` sets `dark` before React. Dashboard has Sun/Moon toggle persisting to `localStorage.theme`. Login page has no toggle.
- **`firstPoll`**: seeds `alertedDownIds` with all currently-down indexers on restart; also forces icon re-download for all indexers.
- **DB**: SQLite. Runtime path from `DB_PATH` env (default `/app/data/indexmon.db`). `knexfile.ts` uses `data/db.sqlite` for migration CLI only. Two drivers: `sqlite3` (knex) + `better-sqlite3` (init-db schema setup).
- **Env vars**: all via `.env` injected by `docker-compose.yml`. No `VITE_` vars (polling interval hardcoded 15s, Vite proxy target hardcoded).
- **Port 3000** also exposed on host, not just via nginx.
- **`polling.ts`** exists but is dead code (not imported anywhere).
- **`express-rate-limit`** in deps but NOT wired.

## CI/CD (`.github/workflows/ci.yml`)
- `lint-test` job: lint → typecheck → test (backend), then lint → test (frontend). Runs on all pushes/PRs to main.
- `build-and-publish` (needs lint-test, no PRs): builds Docker image, pushes to `ghcr.io/<owner>/<repo>`. Branches: main → `develop`. Tags `v*` → semver + `latest`.
- **Screenshot** (only on `v*` tags): starts container, waits for :80, runs `scripts/screenshot.mjs` (Playwright with route interception for 10 mock indexers — no real Prowlarr/Autobrr needed), uploads `screenshot.png` to release. README references `releases/latest/download/screenshot.png`.
- Test DB path via `DB_PATH` env var.
- `contents: write` permission needed for release upload.
