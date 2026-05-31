import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { knex } from '../src/config/database';
import { setPasswordHash, stopSessionCleanup } from '../src/middleware/auth';

describe('Auth API', () => {
  const testPassword = 'correct-password';
  const testHash = bcrypt.hashSync(testPassword, 10);

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

  it('should return 200 and set session cookie for valid password', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: testPassword });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const sessionCookie = Array.isArray(cookies) ? cookies.find((c: string) => c.startsWith('session=')) : cookies;
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Strict/i);
  });

  it('should return 200 on /api/auth/me with valid session', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ password: testPassword });
    const cookies = loginRes.headers['set-cookie'];
    const res = await request(app).get('/api/auth/me').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('should return 401 on /api/auth/me without session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('should clear cookie on logout', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ password: testPassword });
    const cookies = loginRes.headers['set-cookie'];
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookies);
    expect(res.status).toBe(200);
    const clearCookies = res.headers['set-cookie'];
    expect(clearCookies).toBeDefined();
  });
});
