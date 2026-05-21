import { Request, Response, NextFunction } from 'express';
import { knex } from '../config/database';
import { createHash, randomBytes } from 'crypto';

const verifyPassword = (input: string, stored: string): boolean => {
  let salt = '';
  let expected = stored;
  if (stored.includes('$')) {
    [salt, expected] = stored.split('$');
  }
  const computed = createHash('sha256').update(salt + input).digest('hex');
  return computed === expected;
};

// Login a user
const login = async (req: Request, res: Response) => {
  const { password } = req.body;
  const user = await knex('users').first();

  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Create a session token (simplified for demo)
  const sessionToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

  await knex('sessions').insert({
    session_token: sessionToken,
    user_id: user.id,
    expires_at: expiresAt,
  });

  res.json({ token: sessionToken });
};

// Logout a user
const logout = async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  await knex('sessions').where({ session_token: token }).del();
  res.json({ message: 'Logged out' });
};

// Middleware to validate session
const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const session = await knex('sessions').where({ session_token: token }).first();
  if (!session || new Date(session.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  next();
};

export { login, logout, authMiddleware };