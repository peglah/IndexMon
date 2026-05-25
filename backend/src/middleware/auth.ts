import { Request, Response, NextFunction } from 'express';
import { createHash, randomBytes } from 'crypto';

let storedPasswordHash: string | null = null;

export const setPasswordHash = (hash: string) => {
  storedPasswordHash = hash;
};

interface Session {
  userId: number;
  expiresAt: Date;
}

const sessions = new Map<string, Session>();

setInterval(() => {
  const now = new Date();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(token);
    }
  }
}, 15 * 60 * 1000);

const verifyPassword = (input: string, stored: string): boolean => {
  let salt = '';
  let expected = stored;
  if (stored.includes('$')) {
    [salt, expected] = stored.split('$');
  }
  const computed = createHash('sha256').update(salt + input).digest('hex');
  return computed === expected;
};

const login = async (req: Request, res: Response) => {
  const { password } = req.body;

  if (!storedPasswordHash || !verifyPassword(password, storedPasswordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const sessionToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

  sessions.set(sessionToken, { userId: 1, expiresAt });

  res.json({ token: sessionToken });
};

const logout = async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  sessions.delete(token);
  res.json({ message: 'Logged out' });
};

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const session = sessions.get(token);
  if (!session || session.expiresAt < new Date()) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  next();
};

export { login, logout, authMiddleware };