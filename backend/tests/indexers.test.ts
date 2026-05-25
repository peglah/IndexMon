import request from 'supertest';
import app from '../src/app';
import { knex } from '../src/config/database';
import { stopSessionCleanup } from '../src/middleware/auth';

describe('Indexer API', () => {
  beforeAll(async () => {
    await knex.migrate.latest();
  });

  afterAll(async () => {
    stopSessionCleanup();
    await knex.destroy();
  });

  it('should return 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/indexers');
    expect(res.status).toBe(401);
  });

  describe('GET /api/indexers/icon/:prowlarrId', () => {
    it('should return 400 for path traversal attempts', async () => {
      const res = await request(app).get('/api/indexers/icon/..%2F..%2F..%2Fetc%2Fpasswd');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should still serve non-numeric IDs if within icons directory', async () => {
      // Path traversal check only blocks paths that escape iconsDir,
      // non-numeric but safe paths return 404 if not found on disk
      const res = await request(app).get('/api/indexers/icon/abc');
      expect(res.status).toBe(404);
    });

    it('should return 404 for valid numeric IDs that do not exist', async () => {
      const res = await request(app).get('/api/indexers/icon/99999');
      expect(res.status).toBe(404);
    });
  });
});