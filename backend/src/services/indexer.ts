import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { knex } from '../config/database';
import { sendAlert } from './apprise';
import { logger } from '../utils/logger';
import { hasDefinition } from './definitions';
import { getQbitStatus, QbitStatus } from './qbittorrent';

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastCleanup = 0;

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
}

interface ProwlarrResponse {
  records?: unknown[];
}

const CHANNEL_ALIASES: Record<string, string> = {
  mtv: 'morethantv',
  td: 'torrentday',
  tl: 'torrentleech',
};

const normalize = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s*\(api\)\s*/g, '')
    .replace(/[\s_-]+/g, '')
    .replace(/^#/, '')
    .trim();

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
    const response = await axios.get(healthUrl, { headers: { 'X-Api-Key': apiKey } });
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
  try {
    const baseUrl = process.env.PROWLARR_BASE_URL || 'http://prowlarr:9696';
    const apiKey = process.env.PROWLARR_API_KEY;
    const [indexerRes, healthRes] = await Promise.all([
      axios.get(`${baseUrl}/api/v1/indexer`, { headers: { 'X-Api-Key': apiKey } }),
      fetchProwlarrHealth(`${baseUrl}/api/v1/health`, apiKey),
    ]);
    const records = Array.isArray(indexerRes.data) ? indexerRes.data : (indexerRes.data as ProwlarrResponse)?.records ?? [];
    if (!Array.isArray(records)) {
      logger.error('Unexpected Prowlarr response format:', typeof indexerRes.data);
      return [];
    }
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
    return [];
  }
};

const fetchAutobrrNetworks = async (): Promise<AutobrrNetwork[]> => {
  try {
    const response = await axios.get(`${process.env.AUTOBRR_BASE_URL || 'http://autobrr:7474'}/api/irc`, {
      headers: { 'X-API-Token': process.env.AUTOBRR_API_KEY },
    });
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch IRC networks from Autobrr:', error);
    return [];
  }
};

const alertedDownIds = new Set<string>();
const downSince = new Map<string, number>();
const ALERT_DELAY_MS = (parseInt(process.env.ALERT_DELAY_MINUTES || '0', 10) || 0) * 60_000;
let firstPoll = true;

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
        // missing, will download
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

export const fetchIndexers = async (): Promise<Indexer[]> => {
  logger.info('Fetching indexers...');
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
      return { ...pi, autobrr: ab, autobrrMissing: !ab && hasDefinition(pi.name), qbittorrent: qbit };
    });
    logger.info(`Fetched ${prowlarrIndexers.length} indexers from Prowlarr, ${networks.length} IRC networks from Autobrr`);
    const downCount = merged.filter((i) => i.status === 'down').length;
    if (downCount > 0) {
      const downNames = merged.filter((i) => i.status === 'down').map((i) => i.name).join(', ');
      logger.info(`DOWN indexers: ${downNames}`);
    }

    if (merged.length === 0) {
      return [];
    }

    const historyRows = merged.flatMap((indexer) => {
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
    await knex('indexer_history').insert(historyRows);

    const computeDowntimeForSource = async (source: string, downIds: string[]): Promise<Map<string, number>> => {
      if (downIds.length === 0) return new Map();
      const rows = await knex('indexer_history')
        .select('indexer_id')
        .max('last_checked as last_up')
        .whereIn('indexer_id', downIds)
        .where('status', 'up')
        .where('source', source)
        .whereExists(function () {
          this.select('*')
            .from('indexer_history as ih2')
            .whereRaw('ih2.indexer_id = indexer_history.indexer_id')
            .whereRaw('ih2.last_checked > indexer_history.last_checked')
            .whereRaw('(julianday(ih2.last_checked) - julianday(indexer_history.last_checked)) * 1440 <= 5');
        })
        .groupBy('indexer_id');
      const result = new Map<string, number>();
      for (const row of rows) {
        const lastUpTime = new Date(row.last_up as string).getTime();
        result.set(row.indexer_id as string, Math.floor((Date.now() - lastUpTime) / 60000));
      }
      return result;
    };

    const [prowlarrDowntimeMap, autobrrDowntimeMap, qbDowntimeMap] = await Promise.all([
      computeDowntimeForSource('prowlarr', merged.filter((i) => i.status === 'down').map((i) => i.id)),
      computeDowntimeForSource('autobrr', merged.filter((i) => i.autobrr && !isChannelUp(i.autobrr)).map((i) => i.id)),
      computeDowntimeForSource('qbittorrent', merged.filter((i) => i.qbittorrent && !i.qbittorrent.working).map((i) => i.id)),
    ]);

    const windowAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const computeUptimeForSource = async (source: string): Promise<Map<string, number>> => {
      const uptimeRows = await knex('indexer_history')
        .select('indexer_id')
        .select(knex.raw('ROUND(AVG(CASE WHEN status = ? THEN 100.0 ELSE 0 END), 2) as uptime_pct', ['up']))
        .whereIn('indexer_id', merged.map((i) => i.id))
        .where('source', source)
        .where('last_checked', '>=', windowAgo)
        .groupBy('indexer_id');
      return new Map(uptimeRows.map((r) => [r.indexer_id, r.uptime_pct as number]));
    };

    const [prowlarrUptimeMap, autobrrUptimeMap, qbUptimeMap] = await Promise.all([
      computeUptimeForSource('prowlarr'),
      computeUptimeForSource('autobrr'),
      computeUptimeForSource('qbittorrent'),
    ]);

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
      for (const indexer of merged) {
        if (indexer.status === 'down') {
          const pk = `prowlarr:${indexer.id}`;
          alertedDownIds.add(pk);
          downSince.set(pk, Date.now());
        }
        if (indexer.autobrr && !isChannelUp(indexer.autobrr)) {
          const ak = `autobrr:${indexer.id}`;
          alertedDownIds.add(ak);
          downSince.set(ak, Date.now());
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
            }
            if (Date.now() - (downSince.get(prowlarrKey) || 0) >= ALERT_DELAY_MS) {
              hasNewDown = true;
              alertedDownIds.add(prowlarrKey);
            }
          }
        } else {
          alertedDownIds.delete(prowlarrKey);
          downSince.delete(prowlarrKey);
        }

        const autobrrKey = `autobrr:${indexer.id}`;
        if (indexer.autobrr && !isChannelUp(indexer.autobrr)) {
          if (!alertedDownIds.has(autobrrKey)) {
            if (!downSince.has(autobrrKey)) {
              downSince.set(autobrrKey, Date.now());
            }
            if (Date.now() - (downSince.get(autobrrKey) || 0) >= ALERT_DELAY_MS) {
              hasNewDown = true;
              alertedDownIds.add(autobrrKey);
            }
          }
        } else if (indexer.autobrr) {
          alertedDownIds.delete(autobrrKey);
          downSince.delete(autobrrKey);
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
      const lastUps = await knex('indexer_history')
        .select('indexer_id')
        .max('last_checked as last_up')
        .where('status', 'up')
        .groupBy('indexer_id');
      const protectIds: number[] = [];
      for (const row of lastUps) {
        const lu = row.last_up as string;
        const keep = await knex('indexer_history')
          .select('id')
          .where('indexer_id', row.indexer_id)
          .where('last_checked', '>=', lu)
          .whereRaw('(julianday(last_checked) - julianday(?)) * 1440 <= 5', [lu]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        protectIds.push(...keep.map((r: any) => r.id));
      }
      if (protectIds.length > 0) {
        await knex('indexer_history').where('last_checked', '<', threshold).whereNotIn('id', protectIds).delete();
      } else {
        await knex('indexer_history').where('last_checked', '<', threshold).delete();
      }
    }

    cacheIcons(merged);

    return merged;
  } catch (error) {
    logger.error('Failed to fetch indexers:', error);
    throw error;
  }
};
