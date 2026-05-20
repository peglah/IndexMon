import request from 'supertest';
import app from '../src/app';
import { knex } from '../src/config/database';
import fs from 'fs';

describe('Indexer API', () => {
  beforeAll(async () => {
    fs.mkdirSync('./test-data', { recursive: true });
    await knex.migrate.latest();
  });

  afterAll(async () => {
    await knex.destroy();
    fs.rmSync('./test-data', { recursive: true, force: true });
  });

  it('should return 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/indexers');
    expect(res.status).toBe(401);
  });
});