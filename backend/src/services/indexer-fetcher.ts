import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { logger } from '../utils/logger';
import { normalize } from '../utils/normalize';
import { upstreamErrors } from '../utils/metrics';
import { Indexer, AutobrrStatus } from './indexer-types';

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

interface ProwlarrResponse {
  records?: unknown[];
}

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

export const breakerIsOpen = (name: string): boolean => {
  const b = breakers[name];
  const jitteredCooldown = BREAKER_COOLDOWN_MS * (0.5 + Math.random() * 0.5);
  return b.failures >= BREAKER_THRESHOLD && Date.now() - b.lastFailure < jitteredCooldown;
};

export const breakerOnSuccess = (name: string) => { breakers[name].failures = 0; };
export const breakerOnFailure = (name: string) => {
  breakers[name].failures++;
  breakers[name].lastFailure = Date.now();
};

let prowlarrReachable = true;
let autobrrReachable = true;

export const resetReachabilityFlags = () => {
  prowlarrReachable = true;
  autobrrReachable = true;
};

export const getProwlarrReachable = () => prowlarrReachable;
export const getAutobrrReachable = () => autobrrReachable;

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

export const isChannelUp = (a: AutobrrStatus): boolean => a.connected && a.monitoring;

export const buildAutobrrMap = (networks: AutobrrNetwork[]): Map<string, AutobrrStatus> => {
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

async function fetchWithRetry<T>(url: string, config: AxiosRequestConfig, retries = 1): Promise<AxiosResponse<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, config);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        logger.warn(`Retry attempt ${attempt + 1}/${retries} for ${url}`);
        await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
  }
  throw lastError;
}

const fetchProwlarrHealth = async (healthUrl: string, apiKey: string | undefined): Promise<Set<string>> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await fetchWithRetry<any>(healthUrl, { headers: { 'X-Api-Key': apiKey }, timeout: 10000 }, 1);
    if (!Array.isArray(response.data)) return new Set();
    for (const entry of response.data) {
      if ((entry.source === 'IndexerStatusCheck' || entry.source === 'IndexerLongTermStatusCheck') && entry.message) {
        const match = entry.message.match(/Indexers unavailable due to failures.*?:\s*(.*)/);
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

export const fetchProwlarr = async (): Promise<Indexer[]> => {
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
      fetchWithRetry<any>(`${baseUrl}/api/v1/indexer`, { headers: { 'X-Api-Key': apiKey }, timeout: 10000 }, 1),
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
    upstreamErrors.inc({ service: 'prowlarr' });
    return [];
  }
};

export const fetchAutobrrNetworks = async (): Promise<AutobrrNetwork[]> => {
  if (breakerIsOpen('autobrr')) {
    logger.debug('Circuit breaker open for Autobrr, skipping');
    autobrrReachable = false;
    return [];
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await fetchWithRetry<any>(`${process.env.AUTOBRR_BASE_URL || 'http://autobrr:7474'}/api/irc`, {
      headers: { 'X-API-Token': process.env.AUTOBRR_API_KEY },
      timeout: 5000,
    }, 1);
    breakerOnSuccess('autobrr');
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch IRC networks from Autobrr:', error);
    autobrrReachable = false;
    breakerOnFailure('autobrr');
    upstreamErrors.inc({ service: 'autobrr' });
    return [];
  }
};
