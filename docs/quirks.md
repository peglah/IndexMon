# Quirks

## Prowlarr 2.x health API

Prowlarr 2.x drops `status` from `GET /api/v1/indexer`. Auto-disabled indexers are detected via `GET /api/v1/health` → `IndexerStatusCheck` / `IndexerLongTermStatusCheck` warning entries (comma-separated names in the message text). Manually-disabled indexers are detected via the `enable` field being `false`. Auth header: `X-Api-Key`.

## Autobrr: `channel.enabled` vs `channel.monitoring`

Endpoint: `/api/irc`. Auth header: `X-API-Token`. Health is determined by `channel.monitoring && network.connected`. The `channel.enabled` field is a user preference and is NOT checked — a disabled channel that is still monitoring counts as healthy.

## Autobrr absent vs down

No Autobrr entry for an indexer → green (`—`), with a grey tile if the indexer is missing from Autobrr definitions (`autobrrMissing`). With Autobrr present but disconnected → yellow tile, red `DOWN` text.

## `DOMAIN_OVERRIDES` (qBittorrent tracker matching)

qBittorrent reports tracker domains that may not match the indexer's canonical Prowlarr URL. The `DOMAIN_OVERRIDES` map in `backend/src/services/qbittorrent.ts:36-40` maps canonical domains to alternative tracker domains:

- `hd-space.org` → `hd-space.pw`
- `rutracker.org` → `t-ru.org`
- `tday.love` → `td-peers.com`

The `www.` prefix is stripped before matching.

## `init-db.cjs` schema duplication

The `backend/scripts/init-db.cjs` script creates `indexer_history` and `alert_state` tables at container startup using raw SQL. These schemas duplicate what knex migrations define. Auth is in-memory (Map), not DB-backed.

## Tracker stats: Prowlarr-masked `apiKey`

Prowlarr sometimes returns `"********"` as the value for sensitive fields like `apiKey`/`apikey`/`api_key`/`rssKey`/`passkey`. Tracker stats (`backend/src/services/tracker-stats.ts:60-77`) skips these masked values during field extraction, so indexers that arrive masked at runtime will not get UNIT3D stats. A platform cache avoids re-probing non-UNIT3D indexers.

## Name matching & channel aliases

`normalize()` = lowercase, strip `(API)`, strip `[\s_-]+`. Channel aliases (mtv→morethantv, td→torrentday, tl→torrentleech) are defined in `backend/src/services/indexer-fetcher.ts:63-67`.

## Favicon caching & SSRF

Favicons are discovered via `<link rel="icon">` from each indexer's `siteUrl` (Prowlarr `indexerUrls[0]`), falling back to `/favicon.ico`. Cached in `/app/data/icons/` with a 24h TTL; force-downloaded on container restart. All outbound requests are SSRF-protected via `isPrivateUrl()`.
