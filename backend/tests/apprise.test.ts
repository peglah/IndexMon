import request from 'supertest';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import app from '../src/app';
import { knex } from '../src/config/database';
import { setPasswordHash, stopSessionCleanup } from '../src/middleware/auth';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const mockExecFile = execFile as unknown as jest.Mock;

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
  mockExecFile.mockReset();
  delete process.env.APPRISE_URLS;
});

afterEach(() => {
  mockExecFile.mockReset();
});

const mockSuccess = () => {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: object, callback: (err: Error | null, result: object) => void) => {
    callback(null, { stdout: '', stderr: '' });
  });
};

const mockError = (message: string) => {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: object, callback: (err: Error, result?: object) => void) => {
    callback(new Error(message));
  });
};

const mockENOENT = () => {
  const err = new Error('spawn apprise-go ENOENT');
  (err as NodeJS.ErrnoException).code = 'ENOENT';
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: object, callback: (err: Error, result?: object) => void) => {
    callback(err);
  });
};

describe('POST /api/apprise/test', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).post('/api/apprise/test');
    expect(res.status).toBe(401);
  });

  it('should return 400 when APPRISE_URLS not set', async () => {
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('APPRISE_URLS');
  });

  it('should return 400 when apprise-go binary not found', async () => {
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockENOENT();
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('ENOENT');
  });

  it('should return 502 when apprise-go fails', async () => {
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockError('Connection refused');
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Connection refused');
  });

  it('should return 200 on success', async () => {
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockSuccess();
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockExecFile).toHaveBeenCalledWith(
      '/usr/local/bin/apprise-go',
      expect.arrayContaining(['-i', 'markdown']),
      expect.objectContaining({ timeout: 15000 }),
      expect.any(Function),
    );
  });
});

describe('sendAlert', () => {
  beforeEach(() => {
    delete process.env.APPRISE_URLS;
  });

  it('should skip alert when APPRISE_URLS not set', async () => {
    mockSuccess();
    const { sendAlert } = await import('../src/services/apprise');
    await sendAlert('test message');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('should skip alert when APPRISE_URLS is empty string', async () => {
    process.env.APPRISE_URLS = '';
    mockSuccess();
    const { sendAlert } = await import('../src/services/apprise');
    await sendAlert('test message');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('should send alert when APPRISE_URLS is set', async () => {
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockSuccess();
    const { sendAlert } = await import('../src/services/apprise');
    await sendAlert('test message');
    expect(mockExecFile).toHaveBeenCalledWith(
      '/usr/local/bin/apprise-go',
      expect.arrayContaining(['-i', 'markdown']),
      expect.objectContaining({ timeout: 15000 }),
      expect.any(Function),
    );
  });
});
