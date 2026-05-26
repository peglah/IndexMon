import request from 'supertest';
import { createHash } from 'crypto';
import app from '../src/app';
import { knex } from '../src/config/database';
import { setPasswordHash, stopSessionCleanup } from '../src/middleware/auth';

describe('Auth API', () => {
  const testPassword = 'correct-password';
  const testHash = createHash('sha256').update(testPassword).digest('hex');

  beforeAll(async () => {
    await knex.migrate.latest();
    setPasswordHash(testHash);
  });

  afterAll(async () => {
    stopSessionCleanup();
    await knex.destroy();
  });

  it('should return 400 for empty body', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('should return 400 for non-string password', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: null });
    expect(res.status).toBe(400);
  });

  it('should return 401 for wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('should return 200 and a token for valid password', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: testPassword });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });
});
