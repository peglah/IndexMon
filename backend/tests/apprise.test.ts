import request from 'supertest';
import { createHash } from 'crypto';
import axios from 'axios';
import app from '../src/app';
import { knex } from '../src/config/database';
import { setPasswordHash, stopSessionCleanup } from '../src/middleware/auth';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const successResponse = { status: 200, statusText: 'OK', headers: {}, config: {} };

const testPassword = 'test-pass';
const testHash = createHash('sha256').update(testPassword).digest('hex');

let token = '';

beforeAll(async () => {
  await knex.migrate.latest();
  setPasswordHash(testHash);
  const res = await request(app).post('/api/auth/login').send({ password: testPassword });
  token = res.body.token;
});

afterAll(async () => {
  stopSessionCleanup();
  await knex.destroy();
});

beforeEach(() => {
  mockedAxios.post.mockReset();
  delete process.env.APPRISE_API_URL;
  delete process.env.APPRISE_URLS;
});

describe('POST /api/apprise/test', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).post('/api/apprise/test');
    expect(res.status).toBe(401);
  });

  it('should return 400 when APPRISE_URLS not set', async () => {
    process.env.APPRISE_API_URL = 'http://apprise:8000';
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('APPRISE_URLS');
  });

  it('should return 400 when APPRISE_API_URL not set', async () => {
    process.env.APPRISE_URLS = 'slack://token/chan';
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('APPRISE_API_URL');
  });

  it('should return 502 when Apprise POST fails', async () => {
    process.env.APPRISE_API_URL = 'http://apprise:8000';
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockedAxios.post.mockRejectedValue(new Error('Connection refused'));
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Connection refused');
  });

  it('should return 200 on success', async () => {
    process.env.APPRISE_API_URL = 'http://apprise:8000';
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockedAxios.post.mockResolvedValue(successResponse);
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://apprise:8000/notify',
      expect.objectContaining({ body: 'Test notification from IndexMon' }),
      expect.any(Object),
    );
  });
});
