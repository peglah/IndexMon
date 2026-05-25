import axios from 'axios';
import { logger } from '../utils/logger';

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
let intervalId: ReturnType<typeof setInterval> | null = null;
let cookie = '';

let connectionStatus: string | null = null;
let portOpen: boolean | null = null;

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
  } catch {
    logger.warn('qBittorrent login failed');
    return false;
  }
};

const ensureAuth = async (): Promise<boolean> => {
  if (!cookie) return login();
  return true;
};

const fetchTorrents = async (): Promise<QbitTorrent[]> => {
  const resp = await axios.get(`${getBaseUrl()}/api/v2/torrents/info`, {
    headers: { Cookie: cookie },
    timeout: 30000,
  });
  return resp.data;
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
  } catch {
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
  } catch {
    connectionStatus = 'disconnected';
  }

  try {
    const portResp = await axios.get(`${getBaseUrl()}/api/v2/app/portTest`, {
      headers: { Cookie: cookie },
      timeout: 10000,
    });
    portOpen = portResp.data === true;
  } catch {
    portOpen = null;
  }
};

const refreshCache = async (): Promise<void> => {
  try {
    if (!(await ensureAuth())) {
      connectionStatus = 'disconnected';
      portOpen = null;
      return;
    }

    const torrents = await fetchTorrents();
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
          } catch {
            logger.debug(`qB tracker fetch failed for ${domain}`);
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
    logger.info(`qB poll complete — ${cache.size} tracker domains cached`);
    await fetchGlobalStatus();
  } catch (error) {
    logger.error('qBittorrent poll failed:', error);
    connectionStatus = 'disconnected';
    portOpen = null;
  }
};

export const startQbitPolling = (intervalS: number): void => {
  refreshCache();
  intervalId = setInterval(refreshCache, intervalS * 1000);
};

export const stopQbitPolling = (): void => {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
};

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
  } catch {
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
  } catch {
    // bad URL
  }

  return null;
};

export const getQbitGlobalStatus = (): { connectionStatus: string | null; portOpen: boolean | null } => ({
  connectionStatus,
  portOpen,
});
