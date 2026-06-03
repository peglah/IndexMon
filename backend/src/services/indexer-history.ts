import { knex } from '../config/database';
import { Indexer } from './indexer-types';
import { isChannelUp } from './indexer-fetcher';

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastCleanup = 0;

export const resetCleanupTimer = (): void => {
  lastCleanup = 0;
};

export const insertTransitions = async (merged: Indexer[]): Promise<void> => {
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
  const latestPerId = knex('indexer_history')
    .select('indexer_id', 'source')
    .max('last_checked as max_checked')
    .whereIn('indexer_id', allIds)
    .groupBy('indexer_id', 'source')
    .as('latest');
  const lastRows = await knex('indexer_history')
    .join(latestPerId, function () {
      this.on('indexer_history.indexer_id', '=', 'latest.indexer_id')
        .on('indexer_history.source', '=', 'latest.source')
        .on('indexer_history.last_checked', '=', 'latest.max_checked');
    })
    .select('indexer_history.indexer_id', 'indexer_history.source', 'indexer_history.status');
  const lastStatusMap = new Map<string, string>();
  for (const r of lastRows) {
    lastStatusMap.set(`${r.indexer_id}:${r.source}`, r.status);
  }
  const toInsert = dbRows.filter(r => lastStatusMap.get(`${r.indexer_id}:${r.source}`) !== r.status);
  if (toInsert.length > 0) await knex('indexer_history').insert(toInsert);
};

export const computeDowntime = async (merged: Indexer[]): Promise<{
  prowlarr: Map<string, number>;
  autobrr: Map<string, number>;
  qb: Map<string, number>;
}> => {
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

  return { prowlarr: prowlarrDowntimeMap, autobrr: autobrrDowntimeMap, qb: qbDowntimeMap };
};

export const computeUptime = async (merged: Indexer[]): Promise<{
  prowlarr: Map<string, number>;
  autobrr: Map<string, number>;
  qb: Map<string, number>;
}> => {
  const allIds = [...new Set(merged.map(i => i.id))];
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

  return {
    prowlarr: computeUptimeForSource('prowlarr'),
    autobrr: computeUptimeForSource('autobrr'),
    qb: computeUptimeForSource('qbittorrent'),
  };
};

export const attachDowntimeUptime = (
  merged: Indexer[],
  downtime: { prowlarr: Map<string, number>; autobrr: Map<string, number>; qb: Map<string, number> },
  uptime: { prowlarr: Map<string, number>; autobrr: Map<string, number>; qb: Map<string, number> },
): void => {
  for (const indexer of merged) {
    const pct = uptime.prowlarr.get(indexer.id);
    if (pct !== undefined) indexer.uptimePercentage = pct;
    const abPct = uptime.autobrr.get(indexer.id);
    if (abPct !== undefined) indexer.autobrrUptimePercentage = abPct;
    const qbPct = uptime.qb.get(indexer.id);
    if (qbPct !== undefined) indexer.qbUptimePercentage = qbPct;

    const pd = downtime.prowlarr.get(indexer.id);
    if (pd !== undefined) indexer.downtimeMinutes = pd;
    const ad = downtime.autobrr.get(indexer.id);
    if (ad !== undefined) indexer.autobrrDowntimeMinutes = ad;
    const qd = downtime.qb.get(indexer.id);
    if (qd !== undefined) indexer.qbDowntimeMinutes = qd;
  }
};

export const cleanupOldHistory = async (): Promise<void> => {
  if (Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
    lastCleanup = Date.now();
    const threshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    await knex('indexer_history').where('last_checked', '<', threshold).delete();
  }
};
