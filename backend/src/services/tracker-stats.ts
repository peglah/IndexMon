import axios from 'axios';
import { logger } from '../utils/logger';

export interface TrackerStats {
  uploaded: number;
  downloaded: number;
  ratio: number;
  buffer: number;
}

const statsCache = new Map<string, TrackerStats>();
const platformCache = new Map<string, 'gazelle' | 'unit3d' | 'none'>();
let intervalId: ReturnType<typeof setInterval> | null = null;

const getBaseUrl = () => process.env.PROWLARR_BASE_URL || 'http://prowlarr:9696';
const getApiKey = () => process.env.PROWLARR_API_KEY;

interface ProwlarrField {
  name: string;
  value: unknown;
}

interface ProwlarrIndexerDetail {
  id: number;
  name: string;
  implementation: string;
  implementationName: string;
  fields: ProwlarrField[];
  indexerUrls?: string[];
}

const fetchIndexerDetail = async (id: number): Promise<ProwlarrIndexerDetail | null> => {
  try {
    const resp = await axios.get(`${getBaseUrl()}/api/v1/indexer/${id}`, {
      headers: { 'X-Api-Key': getApiKey() },
      timeout: 10000,
    });
    return resp.data;
  } catch {
    logger.debug(`Failed to fetch Prowlarr indexer detail for id ${id}`);
    return null;
  }
};

const extractApiKey = (fields: ProwlarrField[], indexerName: string): string | null => {
  const keyNames = ['apiKey', 'apikey', 'api_key', 'rssKey', 'passkey'];
  for (const name of keyNames) {
    const field = fields.find((f) => f.name === name);
    if (field && typeof field.value === 'string' && field.value.length > 0) {
      // Prowlarr sometimes masks sensitive values with "********"
      if (field.value === '********') {
        logger.info(`Tracker stats: ${indexerName} has masked apiKey field "${name}" — cannot use`);
        continue;
      }
      return field.value;
    }
  }
  // Log available field names for debugging
  const names = fields.map((f) => f.name).join(', ');
  logger.info(`Tracker stats: ${indexerName} — no apiKey found in fields: [${names}]`);
  return null;
};

const fetchGazelleStats = async (siteUrl: string, apiKey: string): Promise<TrackerStats | null> => {
  const base = siteUrl.replace(/\/+$/, '');
  const authAttempts = [
    { headers: { Authorization: `Bearer ${apiKey}` } },
    { headers: { Authorization: `token ${apiKey}` } },
    { params: { auth: apiKey } },
  ];
  for (let i = 0; i < authAttempts.length; i++) {
    try {
      const resp = await axios.get(`${base}/ajax.php?action=user`, {
        ...authAttempts[i],
        timeout: 10000,
      });
      const data = resp.data;
      if (data?.status !== 'success' || !data?.response?.stats) continue;
      const stats = data.response.stats;
      const uploaded = Number(stats.uploaded);
      const downloaded = Number(stats.downloaded);
      if (isNaN(uploaded) || isNaN(downloaded)) continue;
      return {
        uploaded,
        downloaded,
        ratio: downloaded > 0 ? uploaded / downloaded : uploaded > 0 ? Infinity : 1,
        buffer: uploaded - downloaded,
      };
    } catch {
      logger.debug(`Gazelle stats fetch failed for ${siteUrl}, trying next auth method`);
    }
  }
  return null;
};

const parseBytes = (value: string): number => {
  const match = value.trim().match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|PiB)?$/i);
  if (!match) return NaN;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toLowerCase();
  const units: Record<string, number> = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, pib: 1024 ** 5 };
  return num * (units[unit] || 1);
};

const parseStats = (raw: Record<string, unknown>): TrackerStats | null => {
  const uploaded = typeof raw.uploaded === 'string' ? parseBytes(raw.uploaded) : Number(raw.uploaded);
  const downloaded = typeof raw.downloaded === 'string' ? parseBytes(raw.downloaded) : Number(raw.downloaded);
  if (isNaN(uploaded) || isNaN(downloaded)) return null;
  return {
    uploaded,
    downloaded,
    ratio: downloaded > 0 ? uploaded / downloaded : uploaded > 0 ? Infinity : 1,
    buffer: uploaded - downloaded,
  };
};

const fetchUnit3dStats = async (siteUrl: string, apiKey: string): Promise<TrackerStats | null> => {
  const base = siteUrl.replace(/\/+$/, '');
  const url = `${base}/api/user`;
  // Try Bearer header first, then api_token query param
  const authAttempts = [
    { headers: { Authorization: `Bearer ${apiKey}` } },
    { params: { api_token: apiKey } },
  ];
  for (const opts of authAttempts) {
    try {
      const resp = await axios.get(url, { ...opts, timeout: 10000 });
      const raw = resp.data?.data || resp.data;
      const result = parseStats(raw as Record<string, unknown>);
      if (result) return result;
    } catch {
      logger.debug(`UNIT3D stats fetch failed for ${siteUrl}, trying next auth method`);
    }
  }
  return null;
};

const fetchAllStats = async (): Promise<void> => {
  try {
    const prowlarrKey = getApiKey();
    if (!prowlarrKey) return;

    const listResp = await axios.get(`${getBaseUrl()}/api/v1/indexer`, {
      headers: { 'X-Api-Key': prowlarrKey },
      timeout: 10000,
    });
    const indexers = Array.isArray(listResp.data) ? listResp.data as Array<{ id: number; name: string; indexerUrls?: string[] }> : [];

    logger.info(`Tracker stats: checking ${indexers.length} Prowlarr indexers`);

    const results = await Promise.all(
      indexers.map(async (indexer) => {
        const siteUrl = indexer.indexerUrls?.[0];
        if (!siteUrl) {
          logger.debug(`Tracker stats: no siteUrl for ${indexer.name}, skipping`);
          return null;
        }

        const cachedPlatform = platformCache.get(indexer.name);
        if (cachedPlatform === 'none') {
          logger.debug(`Tracker stats: ${indexer.name} previously failed, skipping`);
          return null;
        }

        let fieldApiKey: string | null = null;
        if (cachedPlatform) {
          // Use cached platform — just need the apiKey from detail
          const detail = await fetchIndexerDetail(indexer.id);
          if (!detail) return null;
          fieldApiKey = extractApiKey(detail.fields, indexer.name);
          if (!fieldApiKey) {
            platformCache.set(indexer.name, 'none');
            return null;
          }
        } else {
          // First time: fetch detail to get fields
          const detail = await fetchIndexerDetail(indexer.id);
          if (!detail) {
            logger.info(`Tracker stats: ${indexer.name} — failed to fetch detail from Prowlarr`);
            return null;
          }

          logger.info(`Tracker stats: ${indexer.name} — impl=${detail.implementation} implName=${detail.implementationName}`);

          fieldApiKey = extractApiKey(detail.fields, indexer.name);
          if (!fieldApiKey) {
            platformCache.set(indexer.name, 'none');
            return null;
          }

          logger.info(`Tracker stats: ${indexer.name} — found apiKey, trying Gazelle at ${siteUrl}`);
          let stats = await fetchGazelleStats(siteUrl, fieldApiKey);
          if (stats) {
            platformCache.set(indexer.name, 'gazelle');
            logger.info(`Tracker stats: ${indexer.name} → Gazelle, buffer=${stats.buffer}`);
            return { name: indexer.name, stats };
          }

          logger.info(`Tracker stats: ${indexer.name} — Gazelle failed, trying UNIT3D`);
          stats = await fetchUnit3dStats(siteUrl, fieldApiKey);
          if (stats) {
            platformCache.set(indexer.name, 'unit3d');
            logger.info(`Tracker stats: ${indexer.name} → UNIT3D, buffer=${stats.buffer}`);
            return { name: indexer.name, stats };
          }

          logger.info(`Tracker stats: ${indexer.name} — both Gazelle and UNIT3D failed`);
          platformCache.set(indexer.name, 'none');
          return null;
        }

        // Cached platform: use the known adapter
        const stats = cachedPlatform === 'gazelle'
          ? await fetchGazelleStats(siteUrl, fieldApiKey)
          : await fetchUnit3dStats(siteUrl, fieldApiKey);

        if (stats) {
          logger.debug(`Tracker stats: ${indexer.name} ${cachedPlatform}, buffer=${stats.buffer}`);
          return { name: indexer.name, stats };
        }

        logger.debug(`Tracker stats: ${indexer.name} ${cachedPlatform} fetch failed, clearing cache`);
        platformCache.set(indexer.name, 'none');
        return null;
      }),
    );

    const newCache = new Map<string, TrackerStats>();
    for (const result of results) {
      if (result) {
        newCache.set(result.name, result.stats);
      }
    }
    statsCache.clear();
    for (const [key, val] of newCache) {
      statsCache.set(key, val);
    }
    logger.info(`Tracker stats fetched for ${statsCache.size} indexers`);
  } catch (error) {
    logger.error('Tracker stats poll failed:', error);
  }
};

export const getTrackerStats = (): Map<string, TrackerStats> => statsCache;

export const initTrackerStats = async (): Promise<void> => {
  const ttlM = parseInt(process.env.TRACKER_STATS_TTL_M || '1440', 10);
  if (ttlM <= 0) {
    logger.info('Tracker stats disabled (TRACKER_STATS_TTL_M <= 0)');
    return;
  }
  await fetchAllStats();
  intervalId = setInterval(fetchAllStats, ttlM * 60 * 1000);
};

export const stopTrackerStats = (): void => {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
};
