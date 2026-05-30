import { execFile } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);
const APPRISE_BIN = 'apprise';
const FAVICON_URL = 'https://raw.githubusercontent.com/peglah/IndexMon/refs/heads/main/frontend/public/favicon.png';

interface NtfyConfig {
  baseUrl: string;
  topic: string;
  token: string;
  tags: string[];
}

const parseNtfyUrl = (raw: string): NtfyConfig | null => {
  try {
    const rest = raw.replace('ntfy://', '');
    const slashIdx = rest.indexOf('/');
    if (slashIdx === -1) return null;
    const authority = rest.slice(0, slashIdx);
    const afterAuth = rest.slice(slashIdx + 1);
    const qIdx = afterAuth.indexOf('?');
    const topic = qIdx === -1 ? afterAuth : afterAuth.slice(0, qIdx);
    const qs = qIdx === -1 ? '' : afterAuth.slice(qIdx + 1);
    const params = new URLSearchParams(qs);
    return {
      baseUrl: authority.includes(':') ? `http://${authority}` : `http://${authority}:80`,
      topic,
      token: params.get('token') || '',
      tags: (params.get('tags') || '').split(',').filter(Boolean),
    };
  } catch {
    return null;
  }
};

const sendNtfy = async (cfg: NtfyConfig, message: string, title: string) => {
  const headers: Record<string, string> = {
    'Title': title,
    'Icon': FAVICON_URL,
  };
  if (cfg.tags.length) headers['Tags'] = cfg.tags.join(',');
  if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`;

  await axios.post(`${cfg.baseUrl}/${cfg.topic}`, message, { headers, timeout: 15000 });
};

const partitionUrls = (urls: string[]) => {
  const ntfy: string[] = [];
  const other: string[] = [];
  for (const url of urls) {
    (url.startsWith('ntfy://') ? ntfy : other).push(url);
  }
  return { ntfy, other };
};

const sendViaApprise = async (urls: string[], message: string, title: string) => {
  if (!urls.length) return;
  await execFileAsync(APPRISE_BIN, ['-t', title, '-b', message, '-a', '/usr/share/nginx/html/favicon.svg', ...urls], { timeout: 15000 });
};

export const sendAlert = async (message: string) => {
  const urls = process.env.APPRISE_URLS?.split(',').filter(Boolean) || [];
  if (!urls.length) return;

  const { ntfy, other } = partitionUrls(urls);

  try {
    await Promise.all([
      sendViaApprise(other, message, 'Indexer Alert'),
      ...ntfy.map(u => {
        const cfg = parseNtfyUrl(u);
        return cfg ? sendNtfy(cfg, message, 'Indexer Alert') : Promise.resolve();
      }),
    ]);

    logger.info(`Apprise alert sent to ${urls.length} URL(s)`);
  } catch (error) {
    logger.error('Failed to send alert:', error);
  }
};

export const sendTestNotification = async (): Promise<{ ok: true }> => {
  const urls = process.env.APPRISE_URLS?.split(',').filter(Boolean) || [];
  if (!urls.length) throw new Error('APPRISE_URLS not configured');

  const { ntfy, other } = partitionUrls(urls);

  await Promise.all([
    sendViaApprise(other, 'Test notification from IndexMon', 'Indexer Alert'),
    ...ntfy.map(u => {
      const cfg = parseNtfyUrl(u);
      return cfg ? sendNtfy(cfg, 'Test notification from IndexMon', 'Indexer Alert') : Promise.resolve();
    }),
  ]);

  return { ok: true };
};
