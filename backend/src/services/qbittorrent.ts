import axios from 'axios';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { upstreamErrors } from '../utils/metrics';

interface QbitTorrent {
  hash: string;
  name: string;
  tracker: string;
  trackers_count: number;
  state: string;
}

interface QbitTracker {
  url: string;
  status: number;
  msg: string;
  num_seeds?: number;
  num_peers?: number;
  num_leeches?: number;
}

export interface QbitTorrentStatus {
  code: number;
  msg?: string;
  seeds?: number;
}

export interface QbitStatus {
  working: boolean;
  hasTorrents: boolean;
  statuses: QbitTorrentStatus[];
  lastChecked: string;
}

const DOMAIN_OVERRIDES: Record<string, string[]> = {
  'hd-space.org':  ['hd-space.pw'],
  'rutracker.org': ['t-ru.org'],
  'tday.love':     ['td-peers.com'],
};

const stripWww = (domain: string): string => domain.replace(/^www\./, '');

let cache = new Map<string, QbitStatus>();
let cookie = '';

let connectionStatus: string | null = null;
let portOpen: boolean | null = null;

interface BreakerState {
  failures: number;
  lastFailure: number;
}

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
const PROBE_INTERVAL_MS = 60_000;
const breaker: BreakerState = { failures: 0, lastFailure: 0 };

let baseIntervalMs = 300_000;
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
let policing = false;
let stopped = false;

const isBreakerOpen = (): boolean => {
  if (breaker.failures < BREAKER_THRESHOLD) return false;
  const jitteredCooldown = BREAKER_COOLDOWN_MS * (0.5 + Math.random() * 0.5);
  return Date.now() - breaker.lastFailure < jitteredCooldown;
};

const closeBreaker = (): void => {
  breaker.failures = 0;
};

const openBreaker = (): void => {
  breaker.failures++;
  breaker.lastFailure = Date.now();
};

const getBaseUrl = () => process.env.QBITTORRENT_BASE_URL || 'http://qbittorrent:8080';

const login = async (): Promise<boolean> => {
  const baseUrl = getBaseUrl();
  const username = process.env.QBITTORRENT_USERNAME;
  const password = process.env.QBITTORRENT_PASSWORD;

  if (!username || !password) return false;

  try {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    const resp = await axios.post(`${baseUrl}/api/v2/auth/login`, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });

    const setCookie = resp.headers['set-cookie'];
    if (setCookie) {
      cookie = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
    }
    return true;
  } catch (e) {
    logger.warn('qBittorrent login failed', e);
    return false;
  }
};

const ensureAuth = async (): Promise<boolean> => {
  if (!cookie) return login();
  return true;
};

const probeQbit = async (): Promise<boolean> => {
  try {
    if (!(await ensureAuth())) return false;
    try {
      await axios.get(`${getBaseUrl()}/api/v2/app/webapiVersion`, {
        headers: { Cookie: cookie },
        timeout: 10000,
      });
      return true;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        cookie = '';
        if (await login()) {
          await axios.get(`${getBaseUrl()}/api/v2/app/webapiVersion`, {
            headers: { Cookie: cookie },
            timeout: 10000,
          });
          return true;
        }
      }
      return false;
    }
  } catch {
    return false;
  }
};

const fetchTorrents = async (): Promise<QbitTorrent[]> => {
  const resp = await axios.get(`${getBaseUrl()}/api/v2/torrents/info`, {
    headers: { Cookie: cookie },
    timeout: 30000,
  });
  return resp.data;
};

const fetchTorrentsWithRetry = async (retries = 2): Promise<QbitTorrent[]> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchTorrents();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        throw error;
      }
      lastError = error;
      if (attempt < retries) {
        logger.warn(`qB torrent fetch retry ${attempt + 1}/${retries}`);
        await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 5000)));
      }
    }
  }
  throw lastError;
};

const fetchTorrentsWithReauth = async (): Promise<QbitTorrent[]> => {
  try {
    return await fetchTorrentsWithRetry(2);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      cookie = '';
      if (await login()) {
        return await fetchTorrentsWithRetry(2);
      }
    }
    throw error;
  }
};

const fetchTrackers = async (hash: string): Promise<QbitTracker[]> => {
  const resp = await axios.get(`${getBaseUrl()}/api/v2/torrents/trackers`, {
    params: { hash },
    headers: { Cookie: cookie },
    timeout: 10000,
  });
  return (resp.data || []).filter((t: QbitTracker) => t.status !== 0);
};

const extractDomain = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    logger.debug(`qB: failed to extract domain from URL: ${url}`, e);
    return null;
  }
};

const fetchGlobalStatus = async (): Promise<void> => {
  try {
    const resp = await axios.get(`${getBaseUrl()}/api/v2/transfer/info`, {
      headers: { Cookie: cookie },
      timeout: 10000,
    });
    connectionStatus = resp.data.connection_status;
  } catch (e) {
    logger.warn('qB: failed to fetch connection status', e);
    connectionStatus = 'disconnected';
  }

  try {
    const portResp = await axios.get(`${getBaseUrl()}/api/v2/app/portTest`, {
      headers: { Cookie: cookie },
      timeout: 10000,
    });
    portOpen = portResp.data === true;
  } catch (e) {
    logger.warn('qB: port test failed', e);
    portOpen = null;
  }
};

const fullPoll = async (): Promise<void> => {
  const log = logger.child(randomUUID());
  if (!(await ensureAuth())) {
    connectionStatus = 'disconnected';
    portOpen = null;
    return;
  }

  const torrents = await fetchTorrentsWithReauth();
  if (!Array.isArray(torrents)) {
    connectionStatus = 'disconnected';
    portOpen = null;
    return;
  }

  const domainToHash = new Map<string, string>();
  for (const t of torrents) {
    if (!t.tracker) continue;
    const domain = extractDomain(t.tracker);
    if (domain && !domainToHash.has(domain)) {
      domainToHash.set(domain, t.hash);
    }
  }

  if (domainToHash.size === 0) return;

  const entries = Array.from(domainToHash.entries());
  const results: Array<[string, QbitTracker[] | null]> = [];

  for (let i = 0; i < entries.length; i += 10) {
    const batch = entries.slice(i, i + 10);
    const batchResults = await Promise.all(
      batch.map(async ([domain, hash]) => {
        try {
          const trackers = await fetchTrackers(hash);
          return [domain, trackers] as [string, QbitTracker[]];
        } catch (e) {
          log.debug(`qB tracker fetch failed for ${domain}`, e);
          return [domain, null] as [string, null];
        }
      }),
    );
    results.push(...batchResults);
  }

  const newCache = new Map<string, QbitStatus>();
  for (const [domain, trackers] of results) {
    if (!trackers || trackers.length === 0) continue;

    const matching = trackers.filter((t) => {
      const td = extractDomain(t.url);
      return td === domain || (td != null && td.endsWith('.' + domain));
    });

    const relevant = matching.length > 0 ? matching : trackers;

    const statuses = relevant.map((t) => ({
      code: t.status,
      msg: t.msg || undefined,
      seeds: t.num_seeds,
    }));

    newCache.set(domain, {
      working: relevant.some((t) => t.status === 2),
      hasTorrents: true,
      statuses,
      lastChecked: new Date().toISOString(),
    });
  }

  cache = newCache;
  log.info(`qB poll complete — ${cache.size} tracker domains cached`);
  await fetchGlobalStatus();
  closeBreaker();
};

const refreshCache = async (): Promise<void> => {
  try {
    if (isBreakerOpen()) {
      logger.debug('Circuit breaker open for qBittorrent, running probe');
      connectionStatus = 'disconnected';
      portOpen = null;
      if (await probeQbit()) {
        logger.info('qBittorrent probe succeeded, closing breaker');
        closeBreaker();
        await fullPoll();
      }
      return;
    }

    await fullPoll();
  } catch (error) {
    logger.error('qBittorrent poll failed:', error);
    upstreamErrors.inc({ service: 'qbittorrent' });
    openBreaker();
    connectionStatus = 'disconnected';
    portOpen = null;
  }
};

const runPoll = async (): Promise<void> => {
  if (policing) return;
  policing = true;
  try {
    await refreshCache();
  } finally {
    policing = false;
    scheduleNext();
  }
};

const scheduleNext = (): void => {
  if (stopped) return;
  const baseDelay = isBreakerOpen() ? PROBE_INTERVAL_MS : baseIntervalMs;
  const jitter = (Math.random() - 0.5) * baseDelay * 0.2;
  pollTimeoutId = setTimeout(runPoll, baseDelay + jitter);
};

export const startQbitPolling = (intervalS: number): void => {
  stopQbitPolling();
  stopped = false;
  baseIntervalMs = intervalS * 1000;
  runPoll();
};

export const stopQbitPolling = (): void => {
  stopped = true;
  if (pollTimeoutId !== null) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
};

export { isBreakerOpen };

export const getQbitStatus = (siteUrl: string | undefined): QbitStatus | null => {
  if (!siteUrl || cache.size === 0) return null;

  try {
    const indexerDomain = stripWww(new URL(siteUrl).hostname.toLowerCase());

    // 1. Direct + suffix match (www-stripped)
    for (const [domain, status] of cache) {
      const d = stripWww(domain);
      if (d === indexerDomain || d.endsWith('.' + indexerDomain)) {
        return status;
      }
    }
  } catch (e) {
    logger.debug(`qB: failed to parse siteUrl: ${siteUrl}`, e);
    return null;
  }

  // 2. Override lookup
  try {
    const siteKey = stripWww(new URL(siteUrl).hostname.toLowerCase());
    const aliases = DOMAIN_OVERRIDES[siteKey];
    if (aliases) {
      for (const alias of aliases) {
        const direct = cache.get(alias);
        if (direct) return direct;
        for (const [domain, status] of cache) {
          const d = stripWww(domain);
          if (d === alias || d.endsWith('.' + alias)) return status;
        }
      }
    }
  } catch (e) {
    logger.debug(`qB: override lookup failed for siteUrl: ${siteUrl}`, e);
  }

  return null;
};

export const getQbitGlobalStatus = (): { connectionStatus: string | null; portOpen: boolean | null } => ({
  connectionStatus,
  portOpen,
});
