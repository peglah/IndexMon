import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { normalize } from '../utils/normalize';
import { hasDefinition } from './definitions';
import { pollDuration, pollTotal, upstreamReachable, historyRows as historyRowsGauge, indexerUp, indexerUptimePercentage, announceAgeSeconds, trackerBufferBytes, trackerRatio, circuitBreakerOpen } from '../utils/metrics';
import { getQbitStatus, getQbitGlobalStatus, isBreakerOpen as isQbitBreakerOpen } from './qbittorrent';
import { getTrackerStats } from './tracker-stats';
import { knex, dbPath } from '../config/database';
import { Indexer, ServiceStatuses } from './indexer-types';
import { fetchProwlarr, fetchAutobrrNetworks, buildAutobrrMap, isChannelUp, breakerIsOpen, resetReachabilityFlags, getProwlarrReachable, getAutobrrReachable } from './indexer-fetcher';
import { insertTransitions, computeDowntime, computeUptime, attachDowntimeUptime, cleanupOldHistory } from './indexer-history';
import { handlePollAlerts, isFirstPoll } from './indexer-alerts';
import { scheduleIconCache } from './indexer-icons';

export type { Indexer, ServiceStatus, ServiceStatuses, AutobrrStatus } from './indexer-types';
export { drainIconCaches } from './indexer-icons';

const mergeIndexers = (prowlarrIndexers: Indexer[], autobrrMap: Map<string, import('./indexer-types').AutobrrStatus>): Indexer[] => {
  return prowlarrIndexers.map((pi) => {
    const key = normalize(pi.name);
    const ab = autobrrMap.get(key) || null;
    const qbit = getQbitStatus(pi.siteUrl);
    const stats = getTrackerStats().get(pi.name);
    return { ...pi, autobrr: ab, autobrrMissing: !ab && hasDefinition(pi.name), qbittorrent: qbit, stats };
  });
};

const buildServiceStatuses = (): ServiceStatuses => {
  const qbGlobal = getQbitGlobalStatus();
  return {
    prowlarr: { ok: getProwlarrReachable() },
    autobrr: { ok: getAutobrrReachable(), configured: !!process.env.AUTOBRR_API_KEY },
    qbittorrent: { ok: qbGlobal.connectionStatus !== null && qbGlobal.connectionStatus !== 'disconnected', configured: !!process.env.QBITTORRENT_USERNAME, connectionStatus: qbGlobal.connectionStatus ?? undefined, portOpen: qbGlobal.portOpen },
    appriseConfigured: !!process.env.APPRISE_URLS,
  };
};

const recordMetrics = async (merged: Indexer[], services: ServiceStatuses, endTimer: () => void): Promise<void> => {
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
  circuitBreakerOpen.set({ service: 'qbittorrent' }, isQbitBreakerOpen() ? 1 : 0);
};

const CACHE_FILE_PATH = dbPath === ':memory:' ? '' : path.join(path.dirname(dbPath), 'last-indexers.json');
let lastDiskSerialized: string | null = null;

const readCacheFromDisk = (): { indexers: Indexer[]; services: ServiceStatuses } | null => {
  if (!CACHE_FILE_PATH) return null;
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const data = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    logger.warn('Failed to read indexer cache from disk:', e);
  }
  return null;
};

let cachedResult: { indexers: Indexer[]; services: ServiceStatuses } | null = null;
let backgroundPromise: Promise<void> | null = null;

const doFetch = async (): Promise<{ indexers: Indexer[]; services: ServiceStatuses }> => {
  logger.info('Fetching indexers...');
  resetReachabilityFlags();
  const endTimer = pollDuration.startTimer();
  try {
    const [prowlarrIndexers, networks] = await Promise.all([
      fetchProwlarr(),
      fetchAutobrrNetworks(),
    ]);

    const autobrrMap = buildAutobrrMap(networks);
    const merged = mergeIndexers(prowlarrIndexers, autobrrMap);

    logger.info(`Fetched ${prowlarrIndexers.length} indexers from Prowlarr, ${networks.length} IRC networks from Autobrr`);
    const downCount = merged.filter((i) => i.status === 'down').length;
    if (downCount > 0) {
      const downNames = merged.filter((i) => i.status === 'down').map((i) => i.name).join(', ');
      logger.info(`DOWN indexers: ${downNames}`);
    }

    const services = buildServiceStatuses();

    if (merged.length > 0) {
      await insertTransitions(merged);
      const [downtime, uptime] = await Promise.all([
        computeDowntime(merged),
        computeUptime(merged),
      ]);
      attachDowntimeUptime(merged, downtime, uptime);

      const wasFirstPoll = isFirstPoll();
      await handlePollAlerts(merged);
      await cleanupOldHistory();
      scheduleIconCache(merged, wasFirstPoll);
    }

    await recordMetrics(merged, services, endTimer);

    return { indexers: merged, services };
  } catch (error) {
    logger.error('Failed to fetch indexers:', error);
    pollTotal.inc({ result: 'failure' });
    endTimer();
    throw error;
  }
};

const triggerBackgroundFetch = (): void => {
  if (backgroundPromise) return;
  backgroundPromise = doFetch()
    .then(async (result) => {
      backgroundPromise = null;
      if (result.indexers.length === 0) {
        logger.warn('Background fetch returned empty indexer list — keeping previous cache');
        return;
      }
      cachedResult = result;
      const serialized = JSON.stringify(result);
      if (CACHE_FILE_PATH && serialized !== lastDiskSerialized) {
        try {
          await fs.promises.writeFile(CACHE_FILE_PATH, serialized);
          lastDiskSerialized = serialized;
        } catch (e) {
          logger.warn('Failed to write indexer cache to disk:', e);
        }
      }
    })
    .catch(err => {
      logger.error('Background fetch failed:', err);
      backgroundPromise = null;
    });
};

// For testing: clear in-memory cache between test runs
export const resetIndexerCache = (): void => {
  cachedResult = null;
  backgroundPromise = null;
};

// For testing: bypass cache and fetch synchronously (fresh data)
export const fetchIndexersFresh = doFetch;

export const fetchIndexers = async (): Promise<{ indexers: Indexer[]; services: ServiceStatuses }> => {
  if (!cachedResult) {
    cachedResult = readCacheFromDisk() || { indexers: [], services: buildServiceStatuses() };
  }

  triggerBackgroundFetch();
  return cachedResult;
};
