import express from 'express';
import { sendTestNotification } from '../services/apprise';
import { logger } from '../utils/logger';

const router = express.Router();

router.post('/test', async (req, res) => {
  const log = res.locals.logger || logger;
  try {
    await sendTestNotification();
    log.info('Apprise test notification sent');
    res.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('Apprise test notification failed:', msg);
    if (msg.includes('not configured') || msg.includes('ENOENT')) {
      res.status(400).json({ error: msg });
    } else {
      res.status(502).json({ error: msg });
    }
  }
});

export default router;
