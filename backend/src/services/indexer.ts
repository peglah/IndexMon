import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import fs from 'fs';
import path from 'path';
import { knex } from '../config/database';
import { sendAlert } from './apprise';
import { logger } from '../utils/logger';
import { hasDefinition } from './definitions';
import { normalize } from '../utils/normalize';
import { pollDuration, pollTotal, upstreamReachable, historyRows as historyRowsGauge, indexerUp, indexerUptimePercentage, announceAgeSeconds, trackerBufferBytes, trackerRatio, circuitBreakerOpen } from '../utils/metrics';
import { getQbitStatus, getQbitGlobalStatus, QbitStatus } from './qbittorrent';
import { getTrackerStats, TrackerStats as TrackerStatsType } from './tracker-stats';

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastCleanup = 0;

async function fetchWithRetry<T>(url: string, config: AxiosRequestConfig, retries = 1): Promise<AxiosResponse<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, config);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
  }
  throw lastError;
}

interface AutobrrChannel {
  id: number;
  enabled: boolean;
  name: string;
  monitoring: boolean;
  detached: boolean;
  last_announce: string;
}

interface AutobrrNetwork {
  id: number;
  name: string;
  enabled: boolean;
  connected: boolean;
  channels: AutobrrChannel[];
}

interface AutobrrStatus {
  enabled: boolean;
  connected: boolean;
  monitoring: boolean;
  lastAnnounce: string | null;
}

interface Indexer {
  id: string;
  name: string;
  status: 'up' | 'down';
  lastChecked: string;
  downtimeMinutes?: number;
  autobrrDowntimeMinutes?: number;
  qbDowntimeMinutes?: number;
  uptimePercentage?: number;
  autobrrUptimePercentage?: number;
  qbUptimePercentage?: number;
  autobrr?: AutobrrStatus | null;
  autobrrMissing?: boolean;
  siteUrl?: string;
  qbittorrent?: QbitStatus | null;
  stats?: TrackerStatsType;
}

interface ProwlarrResponse {
  records?: unknown[];
}

export interface ServiceStatus {
  ok: boolean;
  configured?: boolean;
  connectionStatus?: string;
  portOpen?: boolean | null;
}

export interface ServiceStatuses {
  prowlarr: ServiceStatus;
  autobrr: ServiceStatus;
  qbittorrent: ServiceStatus;
}

let prowlarrReachable = true;
let autobrrReachable = true;

interface BreakerState {
  failures: number;
  lastFailure: number;
}

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
const breakers: Record<string, BreakerState> = {
  prowlarr: { failures: 0, lastFailure: 0 },
  autobrr: { failures: 0, lastFailure: 0 },
};

const breakerIsOpen = (name: string): boolean => {
  const b = breakers[name];
  return b.failures >= BREAKER_THRESHOLD && Date.now() - b.lastFailure < BREAKER_COOLDOWN_MS;
};

const breakerOnSuccess = (name: string) => { breakers[name].failures = 0; };
const breakerOnFailure = (name: string) => {
  breakers[name].failures++;
  breakers[name].lastFailure = Date.now();
};

const CHANNEL_ALIASES: Record<string, string> = {
  mtv: 'morethantv',
  td: 'torrentday',
  tl: 'torrentleech',
};

const extractAutobrrIndexerName = (channel: AutobrrChannel, network: AutobrrNetwork): string => {
  const chName = channel.name.toLowerCase().replace('#', '');
  const isGeneric = chName === 'announce' || chName === 'autodl';
  const raw = isGeneric ? normalize(network.name) : chName.replace(/[-.]?(announce|autodl)s?$/gi, '').trim();
  return CHANNEL_ALIASES[raw] || raw;
};

const buildAutobrrMap = (networks: AutobrrNetwork[]): Map<string, AutobrrStatus> => {
  const map = new Map<string, AutobrrStatus>();
  for (const network of networks) {
    if (!network.channels) continue;
    for (const channel of network.channels) {
      const key = normalize(extractAutobrrIndexerName(channel, network));
      const existing = map.get(key);
      const candidate = {
        enabled: channel.enabled,
        connected: network.connected,
        monitoring: channel.monitoring,
        lastAnnounce: channel.last_announce && channel.last_announce !== '0001-01-01T00:00:00Z' ? channel.last_announce : null,
      };
      if (!existing || isChannelUp(candidate)) {
        map.set(key, candidate);
      }
    }
  }
  return map;
};

const isChannelUp = (a: AutobrrStatus): boolean => a.connected && a.monitoring;

const fetchProwlarrHealth = async (healthUrl: string, apiKey: string | undefined): Promise<Set<string>> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await fetchWithRetry<any>(healthUrl, { headers: { 'X-Api-Key': apiKey }, timeout: 10000 });
    if (!Array.isArray(response.data)) return new Set();
    for (const entry of response.data) {
      if (entry.source === 'IndexerStatusCheck' && entry.message) {
        const match = entry.message.match(/Indexers unavailable due to failures:\s*(.*)/);
        if (match) {
          const names = match[1].split(',').map((n: string) => normalize(n.trim()));
          return new Set(names);
        }
      }
    }
    return new Set();
  } catch {
    logger.warn('Prowlarr health check failed');
    return new Set();
  }
};

const fetchProwlarr = async (): Promise<Indexer[]> => {
  if (breakerIsOpen('prowlarr')) {
    logger.debug('Circuit breaker open for Prowlarr, skipping');
    prowlarrReachable = false;
    return [];
  }
  try {
    const baseUrl = process.env.PROWLARR_BASE_URL || 'http://prowlarr:9696';
    const apiKey = process.env.PROWLARR_API_KEY;
    const [indexerRes, healthRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchWithRetry<any>(`${baseUrl}/api/v1/indexer`, { headers: { 'X-Api-Key': apiKey }, timeout: 10000 }),
      fetchProwlarrHealth(`${baseUrl}/api/v1/health`, apiKey),
    ]);
    const records = Array.isArray(indexerRes.data) ? indexerRes.data : (indexerRes.data as ProwlarrResponse)?.records ?? [];
    if (!Array.isArray(records)) {
      logger.error('Unexpected Prowlarr response format:', typeof indexerRes.data);
      return [];
    }
    breakerOnSuccess('prowlarr');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return records.map((indexer: any) => ({
      id: `prowlarr-${indexer.id}`,
      name: indexer.name,
      status: (indexer.enable === false || healthRes.has(normalize(indexer.name))) ? 'down' : 'up',
      lastChecked: new Date().toISOString(),
      siteUrl: indexer.indexerUrls?.[0] as string | undefined,
    }));
  } catch (error) {
    logger.error('Failed to fetch indexers from Prowlarr:', error);
    prowlarrReachable = false;
    breakerOnFailure('prowlarr');
    return [];
  }
};

const fetchAutobrrNetworks = async (): Promise<AutobrrNetwork[]> => {
  if (breakerIsOpen('autobrr')) {
    logger.debug('Circuit breaker open for Autobrr, skipping');
    autobrrReachable = false;
    return [];
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await fetchWithRetry<any>(`${process.env.AUTOBRR_BASE_URL || 'http://autobrr:7474'}/api/irc`, {
      headers: { 'X-API-Token': process.env.AUTOBRR_API_KEY },
      timeout: 10000,
    });
    breakerOnSuccess('autobrr');
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch IRC networks from Autobrr:', error);
    autobrrReachable = false;
    breakerOnFailure('autobrr');
    return [];
  }
};

const alertedDownIds = new Set<string>();
const downSince = new Map<string, number>();
const ALERT_DELAY_MS = (parseInt(process.env.ALERT_DELAY_MINUTES || '0', 10) || 0) * 60_000;
let firstPoll = true;

const persistAlertState = async (key: string, downSinceTs: number, alerted: boolean) => {
  try {
    await knex('alert_state').insert({ key, down_since: downSinceTs, alerted: alerted ? 1 : 0 })
      .onConflict('key')
      .merge();
  } catch { /* non-critical */ }
};

const deleteAlertState = async (key: string) => {
  try {
    await knex('alert_state').where({ key }).delete();
  } catch { /* non-critical */ }
};

const ICONS_DIR = path.join(
  path.dirname(process.env.DB_PATH || '/app/data/indexmon.db'),
  'icons',
);
const ICON_TTL_MS = 24 * 60 * 60 * 1000;

const fetchFaviconUrl = async (siteUrl: string): Promise<string | null> => {
  try {
    const base = siteUrl.replace(/\/+$/, '');
    const resp = await axios.get(base + '/', { timeout: 5000, responseType: 'text', maxBodyLength: 500000 });
    const html = String(resp.data);
    const match = html.match(/<link[^>]*\brel=["'](?:shortcut\s+)?icon["'][^>]*\bhref=["']([^"']+)["']/i);
    if (match) {
      return new URL(match[1], base + '/').href;
    }
  } catch {
    logger.debug(`Favicon URL discovery failed for ${siteUrl}`);
  }
  return null;
};

const pendingIconCaches = new Set<Promise<void>>();

const cacheIcons = async (indexers: Indexer[]): Promise<void> => {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  await Promise.all(
    indexers.map(async (indexer) => {
      const prowlarrId = indexer.id.replace('prowlarr-', '');
      const cachePath = path.join(ICONS_DIR, `${prowlarrId}.png`);
      try {
        const stat = fs.statSync(cachePath);
        const jitterMs = (Math.random() - 0.5) * 60 * 60 * 1000;
        if (!firstPoll && Date.now() - stat.mtimeMs < ICON_TTL_MS + jitterMs) return;
      } catch {
        logger.debug(`Icon cache stat failed for ${indexer.name}, will download`);
      }
      if (!indexer.siteUrl) return;
      try {
        const faviconUrl = (await fetchFaviconUrl(indexer.siteUrl)) || `${indexer.siteUrl.replace(/\/+$/, '')}/favicon.ico`;
        const resp = await axios.get(faviconUrl, { responseType: 'arraybuffer', timeout: 5000 });
        if (resp.data && resp.data.byteLength > 0) {
          fs.writeFileSync(cachePath, resp.data);
        }
      } catch {
        logger.debug(`Icon download failed for ${indexer.name}`);
      }
    }),
  );
};

export const drainIconCaches = async (): Promise<void> => {
  if (pendingIconCaches.size === 0) return;
  logger.info(`Waiting for ${pendingIconCaches.size} pending icon cache(s)...`);
  await Promise.allSettled([...pendingIconCaches]);
  pendingIconCaches.clear();
};

export const fetchIndexers = async (): Promise<{ indexers: Indexer[]; services: ServiceStatuses }> => {
  logger.info('Fetching indexers...');
  prowlarrReachable = true;
  autobrrReachable = true;
  const endTimer = pollDuration.startTimer();
  try {
    const [prowlarrIndexers, networks] = await Promise.all([
      fetchProwlarr(),
      fetchAutobrrNetworks(),
    ]);

    const autobrrMap = buildAutobrrMap(networks);

    const merged: Indexer[] = prowlarrIndexers.map((pi) => {
      const key = normalize(pi.name);
      const ab = autobrrMap.get(key) || null;
      const qbit = getQbitStatus(pi.siteUrl);
      const stats = getTrackerStats().get(pi.name);
      return { ...pi, autobrr: ab, autobrrMissing: !ab && hasDefinition(pi.name), qbittorrent: qbit, stats };
    });
    logger.info(`Fetched ${prowlarrIndexers.length} indexers from Prowlarr, ${networks.length} IRC networks from Autobrr`);
    const downCount = merged.filter((i) => i.status === 'down').length;
    if (downCount > 0) {
      const downNames = merged.filter((i) => i.status === 'down').map((i) => i.name).join(', ');
      logger.info(`DOWN indexers: ${downNames}`);
    }

    const qbGlobal = getQbitGlobalStatus();
    const services: ServiceStatuses = {
      prowlarr: { ok: prowlarrReachable },
      autobrr: { ok: autobrrReachable, configured: !!process.env.AUTOBRR_API_KEY },
      qbittorrent: { ok: qbGlobal.connectionStatus !== null && qbGlobal.connectionStatus !== 'disconnected', configured: !!process.env.QBITTORRENT_USERNAME, connectionStatus: qbGlobal.connectionStatus ?? undefined, portOpen: qbGlobal.portOpen },
    };

    if (merged.length === 0) {
      return { indexers: [], services };
    }

    const dbRows = merged.flatMap((indexer) => {
      const base = { indexer_id: indexer.id, name: indexer.name, last_checked: indexer.lastChecked };
      const abUp = indexer.autobrr ? isChannelUp(indexer.autobrr) : false;
      const rows: Array<{ indexer_id: string; name: string; last_checked: string; source: string; status: string }> = [
        { ...base, source: 'prowlarr', status: indexer.status },
        { ...base, source: 'autobrr', status: abUp ? 'up' : 'down' },
      ];
      if (indexer.qbittorrent) {
        rows.push({ ...base, source: 'qbittorrent', status: indexer.qbittorrent.working ? 'up' : 'down' });
      }
      return rows;
    });

    const allIds = [...new Set(dbRows.map(r => r.indexer_id))];
    const lastRows = await knex('indexer_history')
      .select('indexer_id', 'source', 'status')
      .whereIn('indexer_id', allIds)
      .orderBy('last_checked', 'desc');
    const lastStatusMap = new Map<string, string>();
    for (const r of lastRows) {
      const key = `${r.indexer_id}:${r.source}`;
      if (!lastStatusMap.has(key)) lastStatusMap.set(key, r.status);
    }
    const toInsert = dbRows.filter(r => lastStatusMap.get(`${r.indexer_id}:${r.source}`) !== r.status);
    if (toInsert.length > 0) await knex('indexer_history').insert(toInsert);

    // Single query for all sources' downtime (was 3 separate queries)
    const downIdsProwlarr = merged.filter((i) => i.status === 'down').map((i) => i.id);
    const downIdsAutobrr = merged.filter((i) => i.autobrr && !isChannelUp(i.autobrr)).map((i) => i.id);
    const downIdsQb = merged.filter((i) => i.qbittorrent && !i.qbittorrent.working).map((i) => i.id);
    const allDownIds = [...new Set([...downIdsProwlarr, ...downIdsAutobrr, ...downIdsQb])];

    const prowlarrDowntimeMap = new Map<string, number>();
    const autobrrDowntimeMap = new Map<string, number>();
    const qbDowntimeMap = new Map<string, number>();
    if (allDownIds.length > 0) {
      const downtimeRows = await knex('indexer_history')
        .select('indexer_id', 'source')
        .max('last_checked as last_up')
        .whereIn('indexer_id', allDownIds)
        .where('status', 'down')
        .whereIn('source', ['prowlarr', 'autobrr', 'qbittorrent'])
        .groupBy('indexer_id', 'source');
      const now = Date.now();
      for (const row of downtimeRows) {
        const minutes = Math.floor((now - new Date(row.last_up as string).getTime()) / 60000);
        if (row.source === 'prowlarr') prowlarrDowntimeMap.set(row.indexer_id as string, minutes);
        else if (row.source === 'autobrr') autobrrDowntimeMap.set(row.indexer_id as string, minutes);
        else if (row.source === 'qbittorrent') qbDowntimeMap.set(row.indexer_id as string, minutes);
      }
    }

    // Single pass for all sources' uptime (2 queries instead of 6)
    const windowAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [allTransitions, allBoundaries] = await Promise.all([
      knex('indexer_history')
        .select('indexer_id', 'source', 'status', 'last_checked')
        .whereIn('indexer_id', allIds)
        .whereIn('source', ['prowlarr', 'autobrr', 'qbittorrent'])
        .where('last_checked', '>=', windowAgo)
        .orderBy('indexer_id', 'asc')
        .orderBy('source', 'asc')
        .orderBy('last_checked', 'asc'),
      knex('indexer_history')
        .select('indexer_id', 'source', 'status')
        .whereIn('indexer_id', allIds)
        .whereIn('source', ['prowlarr', 'autobrr', 'qbittorrent'])
        .where('last_checked', '<', windowAgo)
        .orderBy('indexer_id', 'asc')
        .orderBy('source', 'asc')
        .orderBy('last_checked', 'desc'),
    ]);

    const computeUptimeForSource = (source: string): Map<string, number> => {
      const boundaryMap = new Map<string, string>();
      const seen = new Set<string>();
      for (const r of allBoundaries) {
        if (r.source !== source) continue;
        const key = `${r.indexer_id}`;
        if (!seen.has(key)) {
          seen.add(key);
          boundaryMap.set(r.indexer_id, r.status);
        }
      }

      const groups = new Map<string, Array<{ status: string; time: number }>>();
      for (const r of allTransitions) {
        if (r.source !== source) continue;
        if (!groups.has(r.indexer_id)) groups.set(r.indexer_id, []);
        groups.get(r.indexer_id)!.push({ status: r.status, time: new Date(r.last_checked as string).getTime() });
      }

      const now = Date.now();
      const windowStartTime = new Date(windowAgo).getTime();
      const windowMs = now - windowStartTime;
      const result = new Map<string, number>();
      for (const id of allIds) {
        const tlist = groups.get(id) || [];
        let upMs = 0;
        let cursorTime = windowStartTime;
        let cursorStatus = boundaryMap.get(id) || 'up';
        for (const t of tlist) {
          const segmentMs = t.time - cursorTime;
          if (segmentMs > 0 && cursorStatus === 'up') upMs += segmentMs;
          cursorTime = t.time;
          cursorStatus = t.status;
        }
        const lastSegment = now - cursorTime;
        if (lastSegment > 0 && cursorStatus === 'up') upMs += lastSegment;
        result.set(id, Math.round((upMs / windowMs) * 10000) / 100);
      }
      return result;
    };

    const prowlarrUptimeMap = computeUptimeForSource('prowlarr');
    const autobrrUptimeMap = computeUptimeForSource('autobrr');
    const qbUptimeMap = computeUptimeForSource('qbittorrent');

    for (const indexer of merged) {
      const pct = prowlarrUptimeMap.get(indexer.id);
      if (pct !== undefined) indexer.uptimePercentage = pct;
      const abPct = autobrrUptimeMap.get(indexer.id);
      if (abPct !== undefined) indexer.autobrrUptimePercentage = abPct;
      const qbPct = qbUptimeMap.get(indexer.id);
      if (qbPct !== undefined) indexer.qbUptimePercentage = qbPct;

      const pd = prowlarrDowntimeMap.get(indexer.id);
      if (pd !== undefined) indexer.downtimeMinutes = pd;
      const ad = autobrrDowntimeMap.get(indexer.id);
      if (ad !== undefined) indexer.autobrrDowntimeMinutes = ad;
      const qd = qbDowntimeMap.get(indexer.id);
      if (qd !== undefined) indexer.qbDowntimeMinutes = qd;
    }

    if (firstPoll) {
      // Load persisted alert state so restarts don't re-alert
      try {
        const rows = await knex('alert_state').select('*');
        for (const row of rows) {
          alertedDownIds.add(row.key);
          downSince.set(row.key, row.down_since);
        }
      } catch { /* no persisted state */ }

      // Pre-seed currently-down indexers not already tracked in persisted state
      for (const indexer of merged) {
        if (indexer.status === 'down') {
          const pk = `prowlarr:${indexer.id}`;
          if (!downSince.has(pk)) {
            alertedDownIds.add(pk);
            downSince.set(pk, Date.now());
          }
        }
        if (indexer.autobrr && !isChannelUp(indexer.autobrr)) {
          const ak = `autobrr:${indexer.id}`;
          if (!downSince.has(ak)) {
            alertedDownIds.add(ak);
            downSince.set(ak, Date.now());
          }
        }
      }
      firstPoll = false;
    } else {
      let hasNewDown = false;
      for (const indexer of merged) {
        const prowlarrKey = `prowlarr:${indexer.id}`;
        if (indexer.status === 'down') {
          if (!alertedDownIds.has(prowlarrKey)) {
            if (!downSince.has(prowlarrKey)) {
              downSince.set(prowlarrKey, Date.now());
              await persistAlertState(prowlarrKey, Date.now(), false);
            }
            if (Date.now() - (downSince.get(prowlarrKey) || 0) >= ALERT_DELAY_MS) {
              hasNewDown = true;
              alertedDownIds.add(prowlarrKey);
              await persistAlertState(prowlarrKey, downSince.get(prowlarrKey)!, true);
            }
          }
        } else {
          if (alertedDownIds.has(prowlarrKey) || downSince.has(prowlarrKey)) {
            alertedDownIds.delete(prowlarrKey);
            downSince.delete(prowlarrKey);
            await deleteAlertState(prowlarrKey);
          }
        }

        const autobrrKey = `autobrr:${indexer.id}`;
        if (indexer.autobrr && !isChannelUp(indexer.autobrr)) {
          if (!alertedDownIds.has(autobrrKey)) {
            if (!downSince.has(autobrrKey)) {
              downSince.set(autobrrKey, Date.now());
              await persistAlertState(autobrrKey, Date.now(), false);
            }
            if (Date.now() - (downSince.get(autobrrKey) || 0) >= ALERT_DELAY_MS) {
              hasNewDown = true;
              alertedDownIds.add(autobrrKey);
              await persistAlertState(autobrrKey, downSince.get(autobrrKey)!, true);
            }
          }
        } else if (indexer.autobrr) {
          if (alertedDownIds.has(autobrrKey) || downSince.has(autobrrKey)) {
            alertedDownIds.delete(autobrrKey);
            downSince.delete(autobrrKey);
            await deleteAlertState(autobrrKey);
          }
        }
      }

      if (hasNewDown) {
        const messages: string[] = [];
        for (const indexer of merged) {
          const name = indexer.name.replace(/\s*\(API\)/gi, '');
          if (indexer.status === 'down') {
            messages.push(`${name} down in Prowlarr!`);
          }
          if (indexer.autobrr && !isChannelUp(indexer.autobrr)) {
            messages.push(`${name} down in Autobrr!`);
          }
        }
        sendAlert(messages.join('\n'));
      }
    }

    if (Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
      lastCleanup = Date.now();
      const threshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      await knex('indexer_history').where('last_checked', '<', threshold).delete();
    }

    const cachePromise = cacheIcons(merged);
    pendingIconCaches.add(cachePromise);
    cachePromise.finally(() => pendingIconCaches.delete(cachePromise));

    pollTotal.inc({ result: 'success' });
    endTimer();
    upstreamReachable.set({ service: 'prowlarr' }, services.prowlarr.ok ? 1 : 0);
    upstreamReachable.set({ service: 'autobrr' }, services.autobrr.ok ? 1 : 0);
    upstreamReachable.set({ service: 'qbittorrent' }, services.qbittorrent.ok ? 1 : 0);
    try {
      const [{ count }] = await knex('indexer_history').count('* as count');
      historyRowsGauge.set(Number(count));
    } catch {
      logger.debug('Failed to count history rows');
    }

    for (const indexer of merged) {
      indexerUp.set({ indexer: indexer.name, source: 'prowlarr' }, indexer.status === 'up' ? 1 : 0);
      if (indexer.uptimePercentage !== undefined) {
        indexerUptimePercentage.set({ indexer: indexer.name, source: 'prowlarr' }, indexer.uptimePercentage);
      }
      if (indexer.autobrr) {
        indexerUp.set({ indexer: indexer.name, source: 'autobrr' }, isChannelUp(indexer.autobrr) ? 1 : 0);
        if (indexer.autobrrUptimePercentage !== undefined) {
          indexerUptimePercentage.set({ indexer: indexer.name, source: 'autobrr' }, indexer.autobrrUptimePercentage);
        }
        if (indexer.autobrr.lastAnnounce) {
          announceAgeSeconds.set({ indexer: indexer.name }, Math.floor((Date.now() - new Date(indexer.autobrr.lastAnnounce).getTime()) / 1000));
        }
      }
      if (indexer.qbittorrent?.hasTorrents) {
        indexerUp.set({ indexer: indexer.name, source: 'qbittorrent' }, indexer.qbittorrent.working ? 1 : 0);
        if (indexer.qbUptimePercentage !== undefined) {
          indexerUptimePercentage.set({ indexer: indexer.name, source: 'qbittorrent' }, indexer.qbUptimePercentage);
        }
      }
      if (indexer.stats) {
        trackerBufferBytes.set({ indexer: indexer.name }, indexer.stats.buffer);
        if (isFinite(indexer.stats.ratio)) {
          trackerRatio.set({ indexer: indexer.name }, indexer.stats.ratio);
        }
      }
    }
    circuitBreakerOpen.set({ service: 'prowlarr' }, breakerIsOpen('prowlarr') ? 1 : 0);
    circuitBreakerOpen.set({ service: 'autobrr' }, breakerIsOpen('autobrr') ? 1 : 0);

    return { indexers: merged, services };
  } catch (error) {
    logger.error('Failed to fetch indexers:', error);
    pollTotal.inc({ result: 'failure' });
    endTimer();
    throw error;
  }
};
