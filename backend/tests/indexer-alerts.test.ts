import { knex } from '../src/config/database';
import { handlePollAlerts, isFirstPoll, resetAlertState } from '../src/services/indexer-alerts';
import { Indexer } from '../src/services/indexer-types';

jest.mock('../src/services/apprise', () => ({
  sendAlert: jest.fn(),
}));

import { sendAlert } from '../src/services/apprise';

const mockedSendAlert = sendAlert as jest.MockedFunction<typeof sendAlert>;

beforeAll(async () => {
  await knex.migrate.latest();
});

afterAll(async () => {
  await knex.destroy();
});

beforeEach(() => {
  resetAlertState();
});

afterEach(async () => {
  await knex('indexer_history').del();
  await knex('alert_state').del();
  mockedSendAlert.mockClear();
});

const makeIndexer = (overrides: Partial<Indexer> = {}): Indexer => ({
  id: 'prowlarr-1',
  name: 'Test Indexer',
  status: 'up',
  lastChecked: new Date().toISOString(),
  ...overrides,
});

describe('indexer-alerts', () => {
  describe('isFirstPoll', () => {
    it('returns true before first handlePollAlerts call', () => {
      expect(isFirstPoll()).toBe(true);
    });

    it('returns false after first handlePollAlerts call', async () => {
      await handlePollAlerts([]);
      expect(isFirstPoll()).toBe(false);
    });
  });

  describe('first poll', () => {
    it('loads persisted alert state from database', async () => {
      const pastTs = Date.now() - 60000;
      await knex('alert_state').insert({
        key: 'prowlarr:prowlarr-1',
        down_since: pastTs,
        alerted: 1,
      });

      await handlePollAlerts([]);

      const rows = await knex('alert_state').select();
      expect(rows).toHaveLength(1);
      expect(rows[0].key).toBe('prowlarr:prowlarr-1');
    });

    it('pre-seeds currently-down indexers into memory', async () => {
      const merged = [makeIndexer({ status: 'down' })];
      await handlePollAlerts(merged);

      const rows = await knex('alert_state').select();
      expect(rows).toHaveLength(0);
    });

    it('does not fire alerts on first poll', async () => {
      const merged = [makeIndexer({ status: 'down' })];
      await handlePollAlerts(merged);

      expect(mockedSendAlert).not.toHaveBeenCalled();
    });
  });

  describe('subsequent polls', () => {
    beforeEach(async () => {
      await handlePollAlerts([]);
    });

    it('fires alert when indexer goes down', async () => {
      const merged = [makeIndexer({ status: 'down' })];
      await handlePollAlerts(merged);

      expect(mockedSendAlert).toHaveBeenCalledWith('Test Indexer down in Prowlarr!');
    });

    it('fires alert when autobrr channel goes down', async () => {
      const merged = [makeIndexer({
        autobrr: { enabled: true, connected: false, monitoring: false, lastAnnounce: null },
      })];
      await handlePollAlerts(merged);

      expect(mockedSendAlert).toHaveBeenCalledWith('Test Indexer down in Autobrr!');
    });

    it('fires combined alert for multiple down indexers', async () => {
      const merged = [
        makeIndexer({ id: 'prowlarr-1', name: 'Indexer A', status: 'down' }),
        makeIndexer({ id: 'prowlarr-2', name: 'Indexer B', status: 'down' }),
      ];
      await handlePollAlerts(merged);

      expect(mockedSendAlert).toHaveBeenCalledWith('Indexer A down in Prowlarr!\nIndexer B down in Prowlarr!');
    });

    it('clears alert state when indexer recovers', async () => {
      const down = [makeIndexer({ status: 'down' })];
      await handlePollAlerts(down);

      const up = [makeIndexer({ status: 'up' })];
      await handlePollAlerts(up);

      const rows = await knex('alert_state').select();
      expect(rows).toHaveLength(0);
    });

    it('does not re-alert for already-alerted indexer', async () => {
      const down = [makeIndexer({ status: 'down' })];
      await handlePollAlerts(down);
      expect(mockedSendAlert).toHaveBeenCalledTimes(1);

      mockedSendAlert.mockClear();
      await handlePollAlerts(down);
      expect(mockedSendAlert).not.toHaveBeenCalled();
    });
  });
});
