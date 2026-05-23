import { chromium } from 'playwright';
import sharp from 'sharp';
import zlib from 'zlib';

const BASE_URL = process.env.BASE_URL || 'http://localhost';

const MOCK_INDEXERS = [
  { id: 'prowlarr-1', name: 'TorrentLeech', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 5 * 60000).toISOString() } },
  { id: 'prowlarr-2', name: 'MoreThanTV', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 10 * 60000).toISOString() } },
  { id: 'prowlarr-3', name: 'TorrentDay', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: null } },
  { id: 'prowlarr-4', name: 'IPTorrents', status: 'down', lastChecked: new Date().toISOString(), downtimeMinutes: 145, uptimePercentage: 92, autobrr: null, autobrrMissing: true },
  { id: 'prowlarr-5', name: 'AlphaRatio', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 15 * 60000).toISOString() } },
  { id: 'prowlarr-6', name: 'PassThePopcorn', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: false, monitoring: false, lastAnnounce: null } },
  { id: 'prowlarr-7', name: 'HDTorrents', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100 },
  { id: 'prowlarr-8', name: 'BeyondHD', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 30 * 60000).toISOString() } },
  { id: 'prowlarr-9', name: 'SpeedApp', status: 'down', lastChecked: new Date().toISOString(), downtimeMinutes: 320, uptimePercentage: 78, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 90 * 60000).toISOString() } },
  { id: 'prowlarr-10', name: 'FileList', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 40 * 60000).toISOString() } },
];

const SIZE = 16;
const COLORS = [
  [0x22, 0x66, 0xcc],  // TorrentLeech
  [0xcc, 0x44, 0x44],  // MoreThanTV
  [0x33, 0x99, 0x66],  // TorrentDay
  [0x99, 0x55, 0xcc],  // IPTorrents
  [0xdd, 0x88, 0x22],  // AlphaRatio
  [0x33, 0x88, 0xbb],  // PassThePopcorn
  [0xbb, 0x44, 0x88],  // HDTorrents
  [0x44, 0x77, 0x99],  // BeyondHD
  [0x88, 0x66, 0x44],  // SpeedApp
  [0x66, 0xaa, 0x77],  // FileList
];

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c ^= buf[n];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crc]);
};

const makePNG = (r, g, b) => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
  for (let y = 0; y < SIZE; y++) {
    const off = y * (1 + SIZE * 3);
    raw[off] = 0;
    for (let x = 0; x < SIZE; x++) {
      const darken = (y === 0 || y === SIZE - 1 || x === 0 || x === SIZE - 1) ? 0.7 : 1;
      const cx = Math.abs(x - 7.5), cy = Math.abs(y - 7.5);
      const cornerDark = (cx > 4 && cy > 4) ? 0.85 : 1;
      const f = darken * cornerDark;
      const po = off + 1 + x * 3;
      raw[po] = Math.round(r * f);
      raw[po + 1] = Math.round(g * f);
      raw[po + 2] = Math.round(b * f);
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
};

(async () => {
  const iconCache = new Map();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.route('**/api/indexers/icon/*', async (route) => {
    const match = route.request().url().match(/icon\/(\d+)$/);
    const id = match ? parseInt(match[1], 10) : 1;
    const idx = Math.min(Math.max(id - 1, 0), COLORS.length - 1);
    if (!iconCache.has(idx)) iconCache.set(idx, makePNG(...COLORS[idx]));
    await route.fulfill({ status: 200, contentType: 'image/png', body: iconCache.get(idx) });
  });

  await page.route('**/api/indexers', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INDEXERS) });
  });

  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');

  await page.waitForSelector('text=TorrentLeech', { timeout: 15000 });
  await page.waitForTimeout(500);

  const lightBuf = await page.screenshot({ fullPage: true });

  await page.click('button[aria-label="Toggle theme"]');
  await page.waitForTimeout(500);

  const darkBuf = await page.screenshot({ fullPage: true });
  await browser.close();

  const lightRaw = await sharp(lightBuf).raw().toBuffer();
  const darkRaw = await sharp(darkBuf).raw().toBuffer();
  const { width, height } = await sharp(lightBuf).metadata();

  const merged = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = y * width + x;
      const dst = src * 3;
      const useDark = y >= (height / width) * (width - x);
      const px = useDark ? darkRaw : lightRaw;
      merged[dst] = px[dst];
      merged[dst + 1] = px[dst + 1];
      merged[dst + 2] = px[dst + 2];
    }
  }

  await sharp(merged, { raw: { width, height, channels: 3 } })
    .png()
    .toFile('screenshot.png');
})().catch((err) => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
