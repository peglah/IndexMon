import express from 'express';
import { knex } from '../config/database';
import { fetchIndexers } from '../services/indexer';

const router = express.Router();

// Get current indexer status
router.get('/', async (req, res) => {
  try {
    const indexers = await fetchIndexers();
    res.json(indexers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch indexers' });
  }
});

// Get historical downtime data
router.get('/history', async (req, res) => {
  try {
    const history = await knex('indexer_history').select('*');
    res.json(history.map((entry) => ({
      indexerId: entry.indexer_id,
      name: entry.name,
      status: entry.status,
      timestamp: entry.last_checked,
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

export default router;