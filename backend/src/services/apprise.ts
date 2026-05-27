import axios from 'axios';
import { logger } from '../utils/logger';

const appriseBaseUrl = () =>
  (process.env.APPRISE_API_URL || '').replace(/\/$/, '');

const appriseUrls = () =>
  process.env.APPRISE_URLS?.split(',').filter(Boolean) || [];

export const sendAlert = async (message: string) => {
  const urls = appriseUrls();
  if (!urls.length) return;

  const apiUrl = appriseBaseUrl();
  if (!apiUrl) {
    logger.warn('APPRISE_API_URL not set — skipping alert(s)');
    return;
  }

  try {
    await axios.post(`${apiUrl}/notify`, {
      urls: urls.join(','),
      body: message,
      title: 'Indexer Alert',
    });
    logger.info(`Apprise alert sent to ${urls.length} URL(s)`);
  } catch (error) {
    logger.error('Failed to send alert:', error);
  }
};

export const sendTestNotification = async (): Promise<{ ok: true }> => {
  const urls = appriseUrls();
  if (!urls.length) throw new Error('APPRISE_URLS not configured');
  const apiUrl = appriseBaseUrl();
  if (!apiUrl) throw new Error('APPRISE_API_URL not configured');

  await axios.post(`${apiUrl}/notify`, {
    urls: urls.join(','),
    body: 'Test notification from IndexMon',
    title: 'Indexer Alert',
  }, { timeout: 10000 });

  return { ok: true };
};
