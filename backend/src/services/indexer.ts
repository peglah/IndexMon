import axios from 'axios';
import { knex } from '../config/database';
import { sendAlert } from './apprise';
import { hasDefinition } from './definitions';

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
  uptimePercentage?: number;
  autobrr?: AutobrrStatus | null;
  autobrrMissing?: boolean;
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

const fetchProwlarr = async (): Promise<Indexer[]> => {
  try {
    const response = await axios.get(`${process.env.PROWLARR_BASE_URL || 'http://prowlarr:9696'}/api/v1/indexer`, {
      headers: { 'X-Api-Key': process.env.PROWLARR_API_KEY },
    });
    return response.data.map((indexer: any) => ({
      id: `prowlarr-${indexer.id}`,
      name: indexer.name,
      status: indexer.enable && !(indexer.status?.disabledTill && new Date(indexer.status.disabledTill) > new Date()) ? 'up' : 'down',
      lastChecked: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('Failed to fetch indexers from Prowlarr:', error);
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
    console.error('Failed to fetch IRC networks from Autobrr:', error);
    return [];
  }
};

const alertedDownIds = new Set<string>();
let firstPoll = true;

export const fetchIndexers = async (): Promise<Indexer[]> => {
  try {
    const [prowlarrIndexers, networks] = await Promise.all([
      fetchProwlarr(),
      fetchAutobrrNetworks(),
    ]);

    const autobrrMap = buildAutobrrMap(networks);

    const merged: Indexer[] = prowlarrIndexers.map((pi) => {
      const key = normalize(pi.name);
      const ab = autobrrMap.get(key) || null;
      return { ...pi, autobrr: ab, autobrrMissing: !ab && hasDefinition(pi.name) };
    });

    if (merged.length === 0) {
      return [];
    }

    await knex('indexer_history').insert(
      merged.map((indexer) => ({
        indexer_id: indexer.id,
        name: indexer.name,
        status: indexer.status,
        last_checked: indexer.lastChecked,
      }))
    );

    const downIndexers = merged.filter((i) => i.status === 'down');
    if (downIndexers.length > 0) {
      const downIds = downIndexers.map((i) => i.id);
      const rows = await knex('indexer_history')
        .select('indexer_id')
        .max('last_checked as last_up')
        .whereIn('indexer_id', downIds)
        .where('status', 'up')
        .whereExists(function () {
          this.select('*')
            .from('indexer_history as ih2')
            .whereRaw('ih2.indexer_id = indexer_history.indexer_id')
            .whereRaw('ih2.last_checked > indexer_history.last_checked')
            .whereRaw('(julianday(ih2.last_checked) - julianday(indexer_history.last_checked)) * 1440 <= 5');
        })
        .groupBy('indexer_id');
      const upTimeMap = new Map(rows.map((r) => [r.indexer_id, new Date(r.last_up as string).getTime()]));
      for (const indexer of downIndexers) {
        const lastUpTime = upTimeMap.get(indexer.id);
        if (lastUpTime) {
          indexer.downtimeMinutes = Math.floor((Date.now() - lastUpTime) / 60000);
        }
      }
    }

    const windowAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const uptimeRows = await knex('indexer_history')
      .select('indexer_id')
      .select(knex.raw('ROUND(AVG(CASE WHEN status = ? THEN 100.0 ELSE 0 END), 2) as uptime_pct', ['up']))
      .whereIn('indexer_id', merged.map((i) => i.id))
      .where('last_checked', '>=', windowAgo)
      .groupBy('indexer_id');
    const uptimeMap = new Map(uptimeRows.map((r) => [r.indexer_id, r.uptime_pct as number]));
    for (const indexer of merged) {
      const pct = uptimeMap.get(indexer.id);
      if (pct !== undefined) indexer.uptimePercentage = pct;
    }

    if (firstPoll) {
      for (const indexer of merged) {
        if (indexer.status === 'down') {
          alertedDownIds.add(`prowlarr:${indexer.id}`);
        }
        if (indexer.autobrr && !isChannelUp(indexer.autobrr)) {
          alertedDownIds.add(`autobrr:${indexer.id}`);
        }
      }
      firstPoll = false;
    } else {
      let hasNewDown = false;
      for (const indexer of merged) {
        const prowlarrKey = `prowlarr:${indexer.id}`;
        if (indexer.status === 'down') {
          if (!alertedDownIds.has(prowlarrKey)) {
            hasNewDown = true;
            alertedDownIds.add(prowlarrKey);
          }
        } else {
          alertedDownIds.delete(prowlarrKey);
        }

        const autobrrKey = `autobrr:${indexer.id}`;
        if (indexer.autobrr && !isChannelUp(indexer.autobrr)) {
          if (!alertedDownIds.has(autobrrKey)) {
            hasNewDown = true;
            alertedDownIds.add(autobrrKey);
          }
        } else if (indexer.autobrr) {
          alertedDownIds.delete(autobrrKey);
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
        protectIds.push(...keep.map((r: any) => r.id));
      }
      if (protectIds.length > 0) {
        await knex('indexer_history').where('last_checked', '<', threshold).whereNotIn('id', protectIds).delete();
      } else {
        await knex('indexer_history').where('last_checked', '<', threshold).delete();
      }
    }

    return merged;
  } catch (error) {
    console.error('Failed to fetch indexers:', error);
    throw error;
  }
};
