# IndexMon Coding Standards

This file documents conventions that **override or supplement** the standard code-review baseline (Fowler ch.3 code smells, ESLint rules). Mechanical rules enforced by ESLint or TypeScript belong in `eslint.config.*`, not here.

## Tile Color Priority ("Worst Wins")

Composite rule: first matching priority determines tile color. To add a new priority, insert it at the correct level and bump downstream priorities.

| Priority | Color           | Condition                                         | Source                               |
| -------- | --------------- | ------------------------------------------------- | ------------------------------------ |
| 1        | `bg-red-500`    | `indexer.status === 'down'`                       | Prowlarr disabled/health failure     |
| 2        | `bg-orange-500` | `qbittorrent.hasTorrents && !qbittorrent.working` | qB tracker errors                    |
| 3        | `bg-yellow-400` | Autobrr exists but not `connected && monitoring`  | IRC not healthy                      |
| 4        | `bg-gray-400`   | `autobrrMissing`                                  | No Autobrr entry (definition exists) |
| 5        | `bg-amber-400`  | `stats.ratio < 0.8`                               | Low buffer ratio                     |
| 6        | `bg-green-500`  | Default                                           | All good                             |

Animates `alert-pulse` on transitions to red/orange, `recover` on transitions away.

**Implementation:** `frontend/src/components/StatusGrid.tsx:18-25` (`classify()` function). This table is the single authoritative source; `AGENTS.md` points here.

## Service File Conventions (`backend/src/services/`)

- Each service module gets its own file, one export per file.
- Export a named function matching the file's role (e.g. `indexer-alerts.ts` exports `sendIndexerAlerts`, `indexer-history.ts` exports `recordHistory`).
- Asynchronous operations use `async`/`await`, errors propagate to the caller.

## Test File Conventions

- **Backend (`backend/tests/`):** one `.test.ts` file per service module. Route-level tests use supertest with `app` (not `server`). `beforeAll` calls `knex.migrate.latest()`. DB defaults to `:memory:`.
- **Frontend (`frontend/src/components/` or `frontend/tests/`):** one `.test.tsx` per component. Uses Vitest + jsdom + `@testing-library/react`. `matchMedia` mocked in `setup-tests.ts`.

## Frontend Component Conventions

- One component per file in `frontend/src/components/`, using named exports (no `export default`).
- Tailwind classes for styling. Dark mode via `class` strategy (not media-query).
- State persistence via `localStorage` where needed, not a state management library.

## API Response Shape

- Successful responses from auth endpoints and health checks return `{ ok: true }`.
- All other endpoints return data directly (e.g. `{ indexers, services }`).
- Errors go through `backend/src/middleware/error.ts` and return `{ error: string }` with appropriate HTTP status.
- Non-ok error responses are handled by the centralized `errorHandler`.

## Environment Configuration

- All configuration goes through `process.env`, injected via `.env`.
- Every env var must have a documented entry in `.env.example`.
- No hardcoded defaults in source code beyond what's in `.env.example`.
- `APP_VERSION` comes from a Docker build arg, not `package.json`.

## What Belongs in ESLint / TypeScript Config

The following are **not** documented here because they are enforced by tooling:

- Naming conventions (camelCase, PascalCase)
- Import ordering
- Unused variable detection
- Type annotations
- Any other rule enforceable via `eslint.config.*` or `tsconfig.json`

If it can be a lint rule, make it a lint rule.
