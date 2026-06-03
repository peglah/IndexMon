import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { isPrivateUrl } from '../utils/ssrf';
import { Indexer } from './indexer-types';
import { dbPath } from '../config/database';

const ICONS_DIR = path.join(
  path.dirname(dbPath),
  'icons',
);
const ICON_TTL_MS = 24 * 60 * 60 * 1000;

const fetchFaviconUrl = async (siteUrl: string): Promise<string | null> => {
  if (isPrivateUrl(siteUrl)) return null;
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
const iconContentTypes = new Map<number, string>();

const detectContentType = (buf: Buffer): string => {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  if (buf[0] === 0x3c) {
    const text = buf.toString('utf8', 0, 100).trimStart();
    if (text.startsWith('<svg') || text.startsWith('<?xml') || text.startsWith('<!DOCTYPE')) return 'image/svg+xml';
  }
  return 'image/png';
};

export const getIconContentType = (prowlarrId: number): string =>
  iconContentTypes.get(prowlarrId) ?? 'image/png';

export const cacheIcons = async (indexers: Indexer[], isFirstPoll: boolean): Promise<void> => {
  await fs.promises.mkdir(ICONS_DIR, { recursive: true });
  await Promise.all(
    indexers.map(async (indexer) => {
      const prowlarrId = indexer.id.replace('prowlarr-', '');
      const cachePath = path.resolve(ICONS_DIR, `${prowlarrId}.png`);
      if (!cachePath.startsWith(ICONS_DIR + path.sep)) return;
      try {
        const stat = await fs.promises.stat(cachePath);
        const jitterMs = (Math.random() - 0.5) * 60 * 60 * 1000;
        if (!isFirstPoll && Date.now() - stat.mtimeMs < ICON_TTL_MS + jitterMs) return;
      } catch {
        logger.debug(`Icon cache stat failed for ${indexer.name}, will download`);
      }
      if (!indexer.siteUrl) return;
      if (isPrivateUrl(indexer.siteUrl)) return;
      try {
        const faviconUrl = (await fetchFaviconUrl(indexer.siteUrl)) || `${indexer.siteUrl.replace(/\/+$/, '')}/favicon.ico`;
        if (isPrivateUrl(faviconUrl)) return;
        const resp = await axios.get(faviconUrl, { responseType: 'arraybuffer', timeout: 5000, maxBodyLength: 500000 });
        if (resp.data && resp.data.byteLength > 0) {
          const data = Buffer.from(resp.data);
          const tmpPath = cachePath + '.tmp';
          await fs.promises.writeFile(tmpPath, data);
          await fs.promises.rename(tmpPath, cachePath);
          iconContentTypes.set(+prowlarrId, detectContentType(data));
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
