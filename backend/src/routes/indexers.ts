import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { knex } from '../config/database';
import { fetchIndexers } from '../services/indexer';
import { logger } from '../utils/logger';

const router = express.Router();

const indexerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 900,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many requests. Try again later.' },
});

router.use(indexerLimiter);

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
});

// Get current indexer status
router.get('/', async (req, res) => {
  const log = res.locals.logger || logger;
  try {
    const indexers = await fetchIndexers();
    res.json(indexers);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error('Failed to fetch indexers:', detail);
    res.status(500).json({ error: 'Failed to fetch indexers' });
  }
});

// Get historical downtime data
router.get('/history', async (req, res) => {
  const log = res.locals.logger || logger;
  try {
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query parameters' });
    }
    const { limit, offset } = parsed.data;
    const history = await knex('indexer_history').select('*').limit(limit).offset(offset);
    res.json(history.map((entry) => ({
      indexerId: entry.indexer_id,
      name: entry.name,
      status: entry.status,
      timestamp: entry.last_checked,
    })));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error('Failed to fetch history:', detail);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

export default router;