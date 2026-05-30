import express from 'express';
import { z } from 'zod';
import { sendTestNotification } from '../services/apprise';
import { logger } from '../utils/logger';

const router = express.Router();

const testBodySchema = z.object({}).strict();

router.post('/test', async (req, res) => {
  const parsed = testBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  const log = res.locals.logger || logger;
  try {
    await sendTestNotification();
    log.info('Apprise test notification sent');
    res.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn('Apprise test notification failed:', msg);
    if (msg.includes('not configured')) {
      res.status(400).json({ error: 'Apprise not configured' });
    } else if (msg.includes('ENOENT')) {
      res.status(500).json({ error: 'Notification service unavailable' });
    } else {
      res.status(502).json({ error: 'Failed to send notification' });
    }
  }
});

export default router;
