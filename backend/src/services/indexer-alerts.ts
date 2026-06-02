import { knex } from '../config/database';
import { logger } from '../utils/logger';
import { sendAlert } from './apprise';
import { Indexer } from './indexer-types';
import { isChannelUp } from './indexer-fetcher';

const alertedDownIds = new Set<string>();
const downSince = new Map<string, number>();
const ALERT_DELAY_MS = (parseInt(process.env.ALERT_DELAY_M || '0', 10) || 0) * 60_000;
let firstPoll = true;

export const isFirstPoll = (): boolean => firstPoll;

export const resetAlertState = (): void => {
  alertedDownIds.clear();
  downSince.clear();
  firstPoll = true;
};

const CHUNK_SIZE = 300;

const processKey = (
  key: string, isDown: boolean, now: number,
  toUpsert: Array<{ key: string; down_since: number; alerted: number }>,
  toDelete: string[],
): boolean => {
  if (isDown) {
    if (!alertedDownIds.has(key)) {
      if (!downSince.has(key)) {
        downSince.set(key, now);
        toUpsert.push({ key, down_since: now, alerted: 0 });
      }
      if (now - (downSince.get(key) || 0) >= ALERT_DELAY_MS) {
        alertedDownIds.add(key);
        toUpsert.push({ key, down_since: downSince.get(key)!, alerted: 1 });
        return true;
      }
    }
  } else {
    if (alertedDownIds.has(key) || downSince.has(key)) {
      alertedDownIds.delete(key);
      downSince.delete(key);
      toDelete.push(key);
    }
  }
  return false;
};

export const handlePollAlerts = async (merged: Indexer[]): Promise<void> => {
  if (firstPoll) {
    try {
      const rows = await knex('alert_state').select('*');
      for (const row of rows) {
        alertedDownIds.add(row.key);
        downSince.set(row.key, row.down_since);
      }
    } catch (e) { logger.warn('Failed to load persisted alert state', e); }

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
    const now = Date.now();
    const toUpsert: Array<{ key: string; down_since: number; alerted: number }> = [];
    const toDelete: string[] = [];
    let hasNewDown = false;

    for (const indexer of merged) {
      if (processKey(`prowlarr:${indexer.id}`, indexer.status === 'down', now, toUpsert, toDelete)) hasNewDown = true;
      if (indexer.autobrr) {
        if (processKey(`autobrr:${indexer.id}`, !isChannelUp(indexer.autobrr), now, toUpsert, toDelete)) hasNewDown = true;
      }
    }

    if (toDelete.length > 0) {
      try {
        await knex('alert_state').whereIn('key', toDelete).delete();
      } catch (e) { logger.warn('Failed to delete alert states', e); }
    }
    if (toUpsert.length > 0) {
      try {
        const chunks: typeof toUpsert[] = [];
        for (let i = 0; i < toUpsert.length; i += CHUNK_SIZE) {
          chunks.push(toUpsert.slice(i, i + CHUNK_SIZE));
        }
        await Promise.all(chunks.map(chunk =>
          knex('alert_state').insert(chunk).onConflict('key').merge()
        ));
      } catch (e) { logger.warn('Failed to persist alert states', e); }
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
      sendAlert(messages.join('\n')).catch(err => logger.error('Unhandled sendAlert rejection:', err));
    }
  }
};
