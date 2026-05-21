import axios from 'axios';
import { knex } from '../config/database';
import { sendAlert } from './apprise';
import { hasDefinition } from './definitions';

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
      if (!map.has(key)) {
        map.set(key, {
          enabled: channel.enabled,
          connected: network.connected,
          monitoring: channel.monitoring,
          lastAnnounce: channel.last_announce && channel.last_announce !== '0001-01-01T00:00:00Z' ? channel.last_announce : null,
        });
      }
    }
  }
  return map;
};

const isChannelUp = (a: AutobrrStatus): boolean => a.enabled && a.connected && a.monitoring;

const fetchProwlarr = async (): Promise<Indexer[]> => {
  try {
    const response = await axios.get(`${process.env.PROWLARR_BASE_URL || 'http://prowlarr:9696'}/api/v1/indexer`, {
      headers: { 'X-Api-Key': process.env.PROWLARR_API_KEY },
    });
    return response.data.map((indexer: any) => ({
      id: `prowlarr-${indexer.id}`,
      name: indexer.name,
      status: indexer.enable ? 'up' : 'down',
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

    const messages: string[] = [];
    for (const indexer of merged) {
      const prowlarrKey = `prowlarr:${indexer.id}`;
      if (indexer.status === 'down') {
        if (!alertedDownIds.has(prowlarrKey)) {
          messages.push(`Indexer ${indexer.name} is down in Prowlarr!`);
          alertedDownIds.add(prowlarrKey);
        }
      } else {
        alertedDownIds.delete(prowlarrKey);
      }

      const autobrrKey = `autobrr:${indexer.id}`;
      if (indexer.autobrr && !isChannelUp(indexer.autobrr)) {
        if (!alertedDownIds.has(autobrrKey)) {
          messages.push(`Indexer ${indexer.name}: Autobrr channel is down!`);
          alertedDownIds.add(autobrrKey);
        }
      } else if (indexer.autobrr) {
        alertedDownIds.delete(autobrrKey);
      }
    }
    if (messages.length > 0) {
      sendAlert(messages.join('\n'));
    }

    return merged;
  } catch (error) {
    console.error('Failed to fetch indexers:', error);
    throw error;
  }
};
