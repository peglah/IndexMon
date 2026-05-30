import { knex } from '../src/config/database';
import { insertTransitions, computeDowntime, computeUptime, attachDowntimeUptime, cleanupOldHistory, resetCleanupTimer } from '../src/services/indexer-history';
import { Indexer } from '../src/services/indexer-types';

beforeAll(async () => {
  await knex.migrate.latest();
});

afterAll(async () => {
  await knex.destroy();
});

afterEach(async () => {
  await knex('indexer_history').del();
  resetCleanupTimer();
});

const makeIndexer = (overrides: Partial<Indexer> = {}): Indexer => ({
  id: 'prowlarr-1',
  name: 'Test Indexer',
  status: 'up',
  lastChecked: new Date().toISOString(),
  ...overrides,
});

describe('indexer-history', () => {
  describe('insertTransitions', () => {
    it('inserts prowlarr and autobrr rows for new indexer', async () => {
      const merged = [makeIndexer()];
      await insertTransitions(merged);

      const rows = await knex('indexer_history').select();
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.source).sort()).toEqual(['autobrr', 'prowlarr']);
    });

    it('inserts qbittorrent row when present', async () => {
      const merged = [makeIndexer({ qbittorrent: { working: true, hasTorrents: true, statuses: [], lastChecked: new Date().toISOString() } })];
      await insertTransitions(merged);

      const rows = await knex('indexer_history').select();
      expect(rows).toHaveLength(3);
      expect(rows.map(r => r.source).sort()).toEqual(['autobrr', 'prowlarr', 'qbittorrent']);
    });

    it('skips insert when status unchanged', async () => {
      const merged = [makeIndexer()];
      await insertTransitions(merged);
      await insertTransitions(merged);

      const rows = await knex('indexer_history').select();
      expect(rows).toHaveLength(2);
    });

    it('inserts new row on status change', async () => {
      const up = makeIndexer({ status: 'up' });
      await insertTransitions([up]);

      const down = makeIndexer({ status: 'down' });
      await insertTransitions([down]);

      const rows = await knex('indexer_history').select('source', 'status').orderBy('last_checked', 'asc');
      expect(rows).toHaveLength(3);
      expect(rows[0].source).toBe('prowlarr');
      expect(rows[0].status).toBe('up');
      expect(rows[2].source).toBe('prowlarr');
      expect(rows[2].status).toBe('down');
    });
  });

  describe('computeDowntime', () => {
    it('returns empty maps when no down indexers', async () => {
      const merged = [makeIndexer({ status: 'up' })];
      const result = await computeDowntime(merged);

      expect(result.prowlarr.size).toBe(0);
      expect(result.autobrr.size).toBe(0);
      expect(result.qb.size).toBe(0);
    });

    it('computes minutes since most recent down row', async () => {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await knex('indexer_history').insert({
        indexer_id: 'prowlarr-1',
        name: 'Test Indexer',
        source: 'prowlarr',
        status: 'down',
        last_checked: thirtyMinAgo,
      });

      const merged = [makeIndexer({ status: 'down' })];
      const result = await computeDowntime(merged);

      expect(result.prowlarr.get('prowlarr-1')).toBeGreaterThanOrEqual(28);
      expect(result.prowlarr.get('prowlarr-1')).toBeLessThanOrEqual(32);
    });

    it('computes downtime for all three sources', async () => {
      const past = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      await knex('indexer_history').insert([
        { indexer_id: 'prowlarr-1', name: 'Test', source: 'prowlarr', status: 'down', last_checked: past },
        { indexer_id: 'prowlarr-1', name: 'Test', source: 'autobrr', status: 'down', last_checked: past },
        { indexer_id: 'prowlarr-1', name: 'Test', source: 'qbittorrent', status: 'down', last_checked: past },
      ]);

      const merged = [makeIndexer({
        status: 'down',
        autobrr: { enabled: true, connected: false, monitoring: false, lastAnnounce: null },
        qbittorrent: { working: false, hasTorrents: true, statuses: [], lastChecked: new Date().toISOString() },
      })];
      const result = await computeDowntime(merged);

      expect(result.prowlarr.get('prowlarr-1')).toBeGreaterThanOrEqual(13);
      expect(result.autobrr.get('prowlarr-1')).toBeGreaterThanOrEqual(13);
      expect(result.qb.get('prowlarr-1')).toBeGreaterThanOrEqual(13);
    });
  });

  describe('computeUptime', () => {
    it('returns 100% when no history exists (defaults to up)', async () => {
      const merged = [makeIndexer()];
      const result = await computeUptime(merged);

      expect(result.prowlarr.get('prowlarr-1')).toBe(100);
    });

    it('computes 50% for 12h up / 12h down', async () => {
      const now = Date.now();
      const twelveHoursAgo = new Date(now - 12 * 60 * 60 * 1000).toISOString();
      const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

      await knex('indexer_history').insert([
        { indexer_id: 'prowlarr-1', name: 'Test', source: 'prowlarr', status: 'up', last_checked: twentyFourHoursAgo },
        { indexer_id: 'prowlarr-1', name: 'Test', source: 'prowlarr', status: 'down', last_checked: twelveHoursAgo },
      ]);

      const merged = [makeIndexer({ status: 'down' })];
      const result = await computeUptime(merged);

      expect(result.prowlarr.get('prowlarr-1')).toBeGreaterThanOrEqual(48);
      expect(result.prowlarr.get('prowlarr-1')).toBeLessThanOrEqual(52);
    });

    it('computes 0% when down for entire 24h window', async () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await knex('indexer_history').insert({
        indexer_id: 'prowlarr-1',
        name: 'Test',
        source: 'prowlarr',
        status: 'down',
        last_checked: twentyFiveHoursAgo,
      });

      const merged = [makeIndexer({ status: 'down' })];
      const result = await computeUptime(merged);

      expect(result.prowlarr.get('prowlarr-1')).toBe(0);
    });
  });

  describe('attachDowntimeUptime', () => {
    it('mutates indexers in place', () => {
      const merged = [makeIndexer()];
      const downtime = {
        prowlarr: new Map([['prowlarr-1', 45]]),
        autobrr: new Map<string, number>(),
        qb: new Map<string, number>(),
      };
      const uptime = {
        prowlarr: new Map([['prowlarr-1', 99.5]]),
        autobrr: new Map<string, number>(),
        qb: new Map<string, number>(),
      };

      attachDowntimeUptime(merged, downtime, uptime);

      expect(merged[0].downtimeMinutes).toBe(45);
      expect(merged[0].uptimePercentage).toBe(99.5);
    });

    it('attaches all three sources', () => {
      const merged = [makeIndexer()];
      const downtime = {
        prowlarr: new Map([['prowlarr-1', 10]]),
        autobrr: new Map([['prowlarr-1', 20]]),
        qb: new Map([['prowlarr-1', 30]]),
      };
      const uptime = {
        prowlarr: new Map([['prowlarr-1', 90]]),
        autobrr: new Map([['prowlarr-1', 80]]),
        qb: new Map([['prowlarr-1', 70]]),
      };

      attachDowntimeUptime(merged, downtime, uptime);

      expect(merged[0].downtimeMinutes).toBe(10);
      expect(merged[0].autobrrDowntimeMinutes).toBe(20);
      expect(merged[0].qbDowntimeMinutes).toBe(30);
      expect(merged[0].uptimePercentage).toBe(90);
      expect(merged[0].autobrrUptimePercentage).toBe(80);
      expect(merged[0].qbUptimePercentage).toBe(70);
    });
  });

  describe('cleanupOldHistory', () => {
    it('deletes rows older than 14 days', async () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const today = new Date().toISOString();

      await knex('indexer_history').insert([
        { indexer_id: 'prowlarr-1', name: 'Test', source: 'prowlarr', status: 'up', last_checked: fifteenDaysAgo },
        { indexer_id: 'prowlarr-1', name: 'Test', source: 'prowlarr', status: 'up', last_checked: today },
      ]);

      await cleanupOldHistory();

      const rows = await knex('indexer_history').select();
      expect(rows).toHaveLength(1);
      expect(rows[0].last_checked).toBe(today);
    });

    it('skips cleanup if called too soon', async () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      await knex('indexer_history').insert({
        indexer_id: 'prowlarr-1',
        name: 'Test',
        source: 'prowlarr',
        status: 'up',
        last_checked: fifteenDaysAgo,
      });

      await cleanupOldHistory();
      const rows1 = await knex('indexer_history').select();
      expect(rows1).toHaveLength(0);

      await knex('indexer_history').insert({
        indexer_id: 'prowlarr-1',
        name: 'Test',
        source: 'prowlarr',
        status: 'up',
        last_checked: fifteenDaysAgo,
      });

      await cleanupOldHistory();
      const rows2 = await knex('indexer_history').select();
      expect(rows2).toHaveLength(1);
    });
  });
});
