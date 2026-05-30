import request from 'supertest';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import axios from 'axios';
import app from '../src/app';
import { knex } from '../src/config/database';
import { setPasswordHash, stopSessionCleanup } from '../src/middleware/auth';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('axios');

const mockExecFile = execFile as unknown as jest.Mock;
const mockAxiosPost = axios.post as unknown as jest.Mock;

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
  mockAxiosPost.mockReset();
  delete process.env.APPRISE_URLS;
});

afterEach(() => {
  mockExecFile.mockReset();
  mockAxiosPost.mockReset();
});

const mockSuccess = () => {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: object, callback: (err: Error | null, result: object) => void) => {
    callback(null, { stdout: '', stderr: '' });
  });
  mockAxiosPost.mockResolvedValue({ data: {}, status: 200 });
};

const mockError = (message: string) => {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: object, callback: (err: Error, result?: object) => void) => {
    callback(new Error(message));
  });
};

const mockENOENT = () => {
  const err = new Error('spawn apprise ENOENT');
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
    expect(res.body.error).toBe('Apprise not configured');
  });

  it('should return 500 when apprise binary not found', async () => {
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockENOENT();
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Notification service unavailable');
  });

  it('should return 502 when apprise fails', async () => {
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockError('Connection refused');
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Failed to send notification');
  });

  it('should return 200 on success with non-ntfy URL', async () => {
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockSuccess();
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockExecFile).toHaveBeenCalledWith(
      '/usr/local/bin/apprise-go',
      expect.arrayContaining(['-b', 'Test notification from IndexMon']),
      expect.objectContaining({ timeout: 15000 }),
      expect.any(Function),
    );
  });

  it('should return 200 on success with ntfy URL', async () => {
    process.env.APPRISE_URLS = 'ntfy://host/topic?token=abc&tags=warning';
    mockSuccess();
    const res = await request(app).post('/api/apprise/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const args = mockAxiosPost.mock.calls[0];
    expect(args[0]).toBe('http://host:80/topic');
    expect(args[1]).toBe('Test notification from IndexMon');
    expect((args[2] as any).headers['Title']).toBe('Indexer Alert');
    expect((args[2] as any).headers['Icon']).toContain('favicon.png');
    expect((args[2] as any).headers['Tags']).toBe('warning');
    expect((args[2] as any).headers['Authorization']).toBe('Bearer abc');
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
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('should skip alert when APPRISE_URLS is empty string', async () => {
    process.env.APPRISE_URLS = '';
    mockSuccess();
    const { sendAlert } = await import('../src/services/apprise');
    await sendAlert('test message');
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('should send non-ntfy alert via apprise', async () => {
    process.env.APPRISE_URLS = 'slack://token/chan';
    mockSuccess();
    const { sendAlert } = await import('../src/services/apprise');
    await sendAlert('test message');
    expect(mockExecFile).toHaveBeenCalledWith(
      '/usr/local/bin/apprise-go',
      expect.arrayContaining(['-b', 'test message', 'slack://token/chan']),
      expect.objectContaining({ timeout: 15000 }),
      expect.any(Function),
    );
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('should send ntfy alert via axios with icon', async () => {
    process.env.APPRISE_URLS = 'ntfy://myhost:9090/mytopic?token=secret';
    mockSuccess();
    const { sendAlert } = await import('../src/services/apprise');
    await sendAlert('test message');
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const args = mockAxiosPost.mock.calls[0];
    expect(args[0]).toBe('http://myhost:9090/mytopic');
    expect(args[1]).toBe('test message');
    expect((args[2] as any).headers['Title']).toBe('Indexer Alert');
    expect((args[2] as any).headers['Icon']).toContain('favicon.png');
    expect((args[2] as any).headers['Authorization']).toBe('Bearer secret');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('should send both ntfy and non-ntfy URLs', async () => {
    process.env.APPRISE_URLS = 'ntfy://host/topic,slack://token/chan';
    mockSuccess();
    const { sendAlert } = await import('../src/services/apprise');
    await sendAlert('test message');
    expect(mockExecFile).toHaveBeenCalled();
    expect(mockAxiosPost).toHaveBeenCalled();
  });
});
