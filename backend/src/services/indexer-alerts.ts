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

const persistAlertState = async (key: string, downSinceTs: number, alerted: boolean) => {
  try {
    await knex('alert_state').insert({ key, down_since: downSinceTs, alerted: alerted ? 1 : 0 })
      .onConflict('key')
      .merge();
  } catch { logger.warn('Failed to persist alert state'); }
};

const deleteAlertState = async (key: string) => {
  try {
    await knex('alert_state').where({ key }).delete();
  } catch { logger.warn('Failed to delete alert state'); }
};

const processAlert = async (key: string, isDown: boolean): Promise<boolean> => {
  if (isDown) {
    if (!alertedDownIds.has(key)) {
      if (!downSince.has(key)) {
        downSince.set(key, Date.now());
        await persistAlertState(key, Date.now(), false);
      }
      if (Date.now() - (downSince.get(key) || 0) >= ALERT_DELAY_MS) {
        alertedDownIds.add(key);
        await persistAlertState(key, downSince.get(key)!, true);
        return true;
      }
    }
  } else {
    if (alertedDownIds.has(key) || downSince.has(key)) {
      alertedDownIds.delete(key);
      downSince.delete(key);
      await deleteAlertState(key);
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
    } catch { logger.warn('Failed to load persisted alert state'); }

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
    let hasNewDown = false;
    for (const indexer of merged) {
      if (await processAlert(`prowlarr:${indexer.id}`, indexer.status === 'down')) hasNewDown = true;
      if (indexer.autobrr) {
        if (await processAlert(`autobrr:${indexer.id}`, !isChannelUp(indexer.autobrr))) hasNewDown = true;
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
};
