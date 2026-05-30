import { Request, Response, NextFunction } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { logger } from '../utils/logger';

const loginSchema = z.object({ password: z.string().min(1) });

const COOKIE_NAME = 'session';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;

let storedPasswordHash: string | null = null;

export const setPasswordHash = (hash: string) => {
  storedPasswordHash = hash;
};

interface Session {
  userId: number;
  expiresAt: Date;
}

const sessions = new Map<string, Session>();

const cleanupInterval = setInterval(() => {
  const now = new Date();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}, 15 * 60 * 1000);

export const stopSessionCleanup = () => clearInterval(cleanupInterval);

const verifyPassword = (input: string, stored: string): boolean => {
  let salt = '';
  let expected = stored;
  if (stored.includes(':')) {
    [salt, expected] = stored.split(':');
  }
  const computed = createHash('sha256').update(salt + input).digest('hex');
  const computedBuf = Buffer.from(computed, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (computedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(computedBuf, expectedBuf);
};

const login = async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  const { password } = parsed.data;

  if (!storedPasswordHash || !verifyPassword(password, storedPasswordHash)) {
    logger.warn('Login failed', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const sessionToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + COOKIE_MAX_AGE);

  sessions.set(sessionToken, { userId: 1, expiresAt });

  res.cookie(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });

  res.json({ ok: true });
};

const logoutSchema = z.object({}).strict();

const logout = async (req: Request, res: Response) => {
  const parsed = logoutSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const token = req.cookies[COOKIE_NAME];
  if (token) {
    sessions.delete(token);
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ message: 'Logged out' });
};

const me = async (req: Request, res: Response) => {
  res.json({ ok: true });
};

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    logger.warn('Invalid/expired token');
    return res.status(401).json({ error: 'No token provided' });
  }

  const session = sessions.get(token);
  if (!session || session.expiresAt < new Date()) {
    logger.warn('Invalid/expired token');
    sessions.delete(token);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  next();
};

export { login, logout, me, authMiddleware };