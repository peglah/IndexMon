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
});