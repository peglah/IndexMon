import { execFile } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);
const APPRISE_BIN = '/usr/local/bin/apprise-go';
const FAVICON_URL = 'https://raw.githubusercontent.com/peglah/IndexMon/refs/heads/main/frontend/public/favicon.png';
const DELAY_MS = [1_000, 2_000];

interface NtfyConfig {
  baseUrl: string;
  topic: string;
  token: string;
  tags: string[];
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const withRetry = <T>(label: string, fn: () => Promise<T>): Promise<T> =>
  (async () => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= DELAY_MS.length + 1; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt <= DELAY_MS.length) {
          logger.warn(`Apprise: ${label} failed (attempt ${attempt}/${DELAY_MS.length + 1}), retrying in ${DELAY_MS[attempt - 1]}ms:`, err);
          await delay(DELAY_MS[attempt - 1]);
        }
      }
    }
    throw lastErr;
  })();

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

type SendFn = () => Promise<void>;

const buildSenders = (message: string, title: string, retry: boolean): SendFn[] => {
  const urls = process.env.APPRISE_URLS?.split(',').filter(Boolean) || [];
  if (!urls.length) return [];

  const { ntfy, other } = partitionUrls(urls);
  const senders: SendFn[] = [];

  for (const u of ntfy) {
    const cfg = parseNtfyUrl(u);
    if (!cfg) continue;
    const label = `ntfy://${cfg.baseUrl}/${cfg.topic}`;
    const send = () => sendNtfy(cfg, message, title);
    senders.push(retry ? () => withRetry(label, send) : send);
  }

  if (other.length > 0) {
    const label = `apprise-go (${other.length} URL(s))`;
    const send = () => sendViaApprise(other, message, title);
    senders.push(retry ? () => withRetry(label, send) : send);
  }

  return senders;
};

export const sendAlert = async (message: string) => {
  const senders = buildSenders(message, 'Indexer Alert', true);
  if (!senders.length) return;

  const results = await Promise.allSettled(senders.map(s => s()));

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  if (failed === 0) {
    logger.info(`Apprise alert sent to all channels`);
  } else if (succeeded > 0) {
    logger.info(`Apprise alert sent to ${succeeded} channel(s), ${failed} failed — see errors above`);
  } else {
    logger.error(`Apprise alert failed on all ${failed} channel(s) — see errors above`);
  }
};

export const sendTestNotification = async (): Promise<{ ok: true }> => {
  const senders = buildSenders('Test notification from IndexMon', 'Indexer Alert', false);
  if (!senders.length) throw new Error('APPRISE_URLS not configured');

  await Promise.all(senders.map(s => s()));

  return { ok: true };
};
