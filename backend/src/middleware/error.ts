import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const log = res.locals.logger || logger;
  log.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
};