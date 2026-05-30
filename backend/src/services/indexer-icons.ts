import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { Indexer } from './indexer-types';

const ICONS_DIR = path.join(
  path.dirname(process.env.DB_PATH || '/app/data/indexmon.db'),
  'icons',
);
const ICON_TTL_MS = 24 * 60 * 60 * 1000;

const fetchFaviconUrl = async (siteUrl: string): Promise<string | null> => {
  try {
    const base = siteUrl.replace(/\/+$/, '');
    const resp = await axios.get(base + '/', { timeout: 5000, responseType: 'text', maxBodyLength: 500000 });
    const html = String(resp.data);
    const match = html.match(/<link[^>]*\brel=["'](?:shortcut\s+)?icon["'][^>]*\bhref=["']([^"']+)["']/i);
    if (match) {
      return new URL(match[1], base + '/').href;
    }
  } catch {
    logger.debug(`Favicon URL discovery failed for ${siteUrl}`);
  }
  return null;
};

const pendingIconCaches = new Set<Promise<void>>();

export const cacheIcons = async (indexers: Indexer[], isFirstPoll: boolean): Promise<void> => {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  await Promise.all(
    indexers.map(async (indexer) => {
      const prowlarrId = indexer.id.replace('prowlarr-', '');
      const cachePath = path.resolve(ICONS_DIR, `${prowlarrId}.png`);
      if (!cachePath.startsWith(ICONS_DIR + path.sep)) return;
      try {
        const stat = fs.statSync(cachePath);
        const jitterMs = (Math.random() - 0.5) * 60 * 60 * 1000;
        if (!isFirstPoll && Date.now() - stat.mtimeMs < ICON_TTL_MS + jitterMs) return;
      } catch {
        logger.debug(`Icon cache stat failed for ${indexer.name}, will download`);
      }
      if (!indexer.siteUrl) return;
      try {
        const faviconUrl = (await fetchFaviconUrl(indexer.siteUrl)) || `${indexer.siteUrl.replace(/\/+$/, '')}/favicon.ico`;
        const resp = await axios.get(faviconUrl, { responseType: 'arraybuffer', timeout: 5000, maxBodyLength: 500000 });
        if (resp.data && resp.data.byteLength > 0) {
          fs.writeFileSync(cachePath, resp.data);
        }
      } catch {
        logger.debug(`Icon download failed for ${indexer.name}`);
      }
    }),
  );
};

export const drainIconCaches = async (): Promise<void> => {
  if (pendingIconCaches.size === 0) return;
  logger.info(`Waiting for ${pendingIconCaches.size} pending icon cache(s)...`);
  await Promise.allSettled([...pendingIconCaches]);
  pendingIconCaches.clear();
};

export const scheduleIconCache = (indexers: Indexer[], isFirstPoll: boolean): void => {
  const cachePromise = cacheIcons(indexers, isFirstPoll);
  pendingIconCaches.add(cachePromise);
  cachePromise.finally(() => pendingIconCaches.delete(cachePromise));
};
