import { fetchIndexers } from '../src/services/indexer';
import { knex } from '../src/config/database';
import axios from 'axios';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const successResponse = (data: unknown) => ({
  data,
  status: 200, statusText: 'OK', headers: {}, config: {},
});

const healthWarnResponse = (names: string) => successResponse([
  { source: 'IndexerStatusCheck', message: `Indexers unavailable due to failures: ${names}` },
]);

const baseIndexer = { id: 1, name: 'Test Indexer', enable: true, indexerUrls: ['https://test.example.com'] };
const baseChannel = { id: 1, name: 'announce', enabled: true, monitoring: true, detached: false, last_announce: '' };
const baseNetwork = { id: 1, name: 'Test Indexer', enabled: true, connected: true, channels: [baseChannel] };

beforeAll(async () => {
  await knex.migrate.latest();
});

afterAll(async () => {
  await knex.destroy();
});

beforeEach(() => {
  mockedAxios.get.mockReset();
});

afterEach(async () => {
  await knex('indexer_history').del();
  await knex('alert_state').del();
});

describe('fetchIndexers', () => {
  describe('basic fetch', () => {
    it('returns empty indexers when Prowlarr returns empty', async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([]);
        if (url.includes('/api/v1/health')) return successResponse([]);
        if (url.includes('/api/irc')) return successResponse([]);
        return successResponse('');
      });

      const result = await fetchIndexers();
      expect(result.indexers).toHaveLength(0);
      expect(result.services.prowlarr.ok).toBe(true);
      expect(result.services.autobrr.ok).toBe(true);
    });

    it('returns indexer with up status when Prowlarr and Autobrr are healthy', async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return successResponse([]);
        if (url.includes('/api/irc')) return successResponse([{ ...baseNetwork, channels: [{ ...baseChannel }] }]);
        return successResponse('');
      });

      const result = await fetchIndexers();
      expect(result.indexers).toHaveLength(1);
      expect(result.indexers[0].name).toBe('Test Indexer');
      expect(result.indexers[0].status).toBe('up');
    });

    it('marks indexer down via Prowlarr health check warning', async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return healthWarnResponse('Test Indexer');
        if (url.includes('/api/irc')) return successResponse([]);
        return successResponse('');
      });

      const result = await fetchIndexers();
      expect(result.indexers[0].status).toBe('down');
    });

    it('marks indexer down when enable is false in Prowlarr', async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer, enable: false }]);
        if (url.includes('/api/v1/health')) return successResponse([]);
        if (url.includes('/api/irc')) return successResponse([]);
        return successResponse('');
      });

      const result = await fetchIndexers();
      expect(result.indexers[0].status).toBe('down');
    });
  });

  describe('Autobrr matching', () => {
    it('matches indexer to Autobrr channel and reports channel up', async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return successResponse([]);
        if (url.includes('/api/irc')) return successResponse([{
          ...baseNetwork, channels: [{
            ...baseChannel, last_announce: new Date().toISOString(),
          }],
        }]);
        return successResponse('');
      });

      const result = await fetchIndexers();
      expect(result.indexers[0].autobrr).not.toBeNull();
      expect(result.indexers[0].autobrr!.connected).toBe(true);
      expect(result.indexers[0].autobrr!.monitoring).toBe(true);
    });

    it('reports Autobrr channel down when not monitoring', async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return successResponse([]);
        if (url.includes('/api/irc')) return successResponse([{
          ...baseNetwork, channels: [{ ...baseChannel, monitoring: false }],
        }]);
        return successResponse('');
      });

      const result = await fetchIndexers();
      expect(result.indexers[0].autobrr).not.toBeNull();
      expect(result.indexers[0].autobrr!.monitoring).toBe(false);
    });

    it('reports Autobrr channel down when network disconnected', async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return successResponse([]);
        if (url.includes('/api/irc')) return successResponse([{
          ...baseNetwork, connected: false, channels: [{ ...baseChannel }],
        }]);
        return successResponse('');
      });

      const result = await fetchIndexers();
      expect(result.indexers[0].autobrr).not.toBeNull();
      expect(result.indexers[0].autobrr!.connected).toBe(false);
    });
  });

  describe('history transitions', () => {
    it('inserts no duplicate history rows on unchanged status', async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return successResponse([]);
        if (url.includes('/api/irc')) return successResponse([]);
        return successResponse('');
      });

      await fetchIndexers();
      const rows1 = await knex('indexer_history').select();
      expect(rows1).toHaveLength(2); // prowlarr + autobrr

      await fetchIndexers();
      const rows2 = await knex('indexer_history').select();
      expect(rows2).toHaveLength(2); // no duplicate inserts
    });

    it('inserts new history row on status change', async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return successResponse([]);
        if (url.includes('/api/irc')) return successResponse([]);
        return successResponse('');
      });

      await fetchIndexers();
      const rows1 = await knex('indexer_history').select('source', 'status');
      expect(rows1).toHaveLength(2);
      const autobrrRow = rows1.find(r => r.source === 'autobrr');
      expect(autobrrRow).toBeDefined();
      expect(autobrrRow!.status).toBe('down');

      // Now make the indexer down via health check
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return healthWarnResponse('Test Indexer');
        if (url.includes('/api/irc')) return successResponse([]);
        return successResponse('');
      });

      await fetchIndexers();
      const rows2 = await knex('indexer_history').select('source', 'status');
      expect(rows2).toHaveLength(3); // 2 existing + 1 new (prowlarr up→down, autobrr still down→no change)
    });
  });

  describe('downtime and uptime computation', () => {
    it('computes downtime minutes from most recent down row', async () => {
      const id = 'prowlarr-1';
      const past = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await knex('indexer_history').insert([
        { indexer_id: id, name: 'Test Indexer', source: 'prowlarr', status: 'down', last_checked: past },
        { indexer_id: id, name: 'Test Indexer', source: 'autobrr', status: 'down', last_checked: past },
      ]);

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return healthWarnResponse('Test Indexer');
        if (url.includes('/api/irc')) return successResponse([]);
        return successResponse('');
      });

      const result = await fetchIndexers();
      expect(result.indexers[0].downtimeMinutes).toBeGreaterThanOrEqual(28);
      expect(result.indexers[0].downtimeMinutes).toBeLessThanOrEqual(32);
    });

    it('computes uptime percentage from 24h window', async () => {
      const id = 'prowlarr-1';
      const now = Date.now();
      // Up for the first 12h, down for the last 12h
      const twelveHoursAgo = new Date(now - 12 * 60 * 60 * 1000).toISOString();
      const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      await knex('indexer_history').insert([
        { indexer_id: id, name: 'Test Indexer', source: 'prowlarr', status: 'up', last_checked: twentyFourHoursAgo },
        { indexer_id: id, name: 'Test Indexer', source: 'prowlarr', status: 'down', last_checked: twelveHoursAgo },
        { indexer_id: id, name: 'Test Indexer', source: 'autobrr', status: 'up', last_checked: twentyFourHoursAgo },
        { indexer_id: id, name: 'Test Indexer', source: 'autobrr', status: 'down', last_checked: twelveHoursAgo },
      ]);

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/indexer')) return successResponse([{ ...baseIndexer }]);
        if (url.includes('/api/v1/health')) return healthWarnResponse('Test Indexer');
        if (url.includes('/api/irc')) return successResponse([]);
        return successResponse('');
      });

      const result = await fetchIndexers();
      // 12h up / 24h window = 50%
      expect(result.indexers[0].uptimePercentage).toBeGreaterThanOrEqual(48);
      expect(result.indexers[0].uptimePercentage).toBeLessThanOrEqual(52);
    });
  });
});
