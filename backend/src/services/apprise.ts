import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);
const APPRISE_BIN = '/usr/local/bin/apprise-go';

const appriseUrls = () =>
  process.env.APPRISE_URLS?.split(',').filter(Boolean) || [];

export const sendAlert = async (message: string) => {
  const urls = appriseUrls();
  if (!urls.length) return;

  try {
    await execFileAsync(APPRISE_BIN, ['-t', 'Indexer Alert', '-b', message, ...urls], { timeout: 15000 });
    logger.info(`Apprise alert sent to ${urls.length} URL(s)`);
  } catch (error) {
    logger.error('Failed to send alert:', error);
  }
};

export const sendTestNotification = async (): Promise<{ ok: true }> => {
  const urls = appriseUrls();
  if (!urls.length) throw new Error('APPRISE_URLS not configured');

  await execFileAsync(APPRISE_BIN, ['-t', 'Indexer Alert', '-b', 'Test notification from IndexMon', ...urls], { timeout: 15000 });

  return { ok: true };
};
