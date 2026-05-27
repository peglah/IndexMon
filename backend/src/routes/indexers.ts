import express from 'express';
import { knex } from '../config/database';
import { fetchIndexers } from '../services/indexer';
import { logger } from '../utils/logger';

const router = express.Router();

// Get current indexer status
router.get('/', async (req, res) => {
  const log = res.locals.logger || logger;
  try {
    const indexers = await fetchIndexers();
    res.json(indexers);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.error('Failed to fetch indexers:', detail);
    res.status(500).json({ error: 'Failed to fetch indexers', detail });
  }
});

// Get historical downtime data
router.get('/history', async (req, res) => {
  const log = res.locals.logger || logger;
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 1000, 1), 5000);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
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
    res.status(500).json({ error: 'Failed to fetch history', detail });
  }
});

export default router;