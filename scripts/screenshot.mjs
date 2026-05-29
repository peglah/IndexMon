import { chromium } from 'playwright';
import zlib from 'zlib';

const BASE_URL = process.env.BASE_URL || 'http://localhost';

const SCREEN_WIDTH = 412;
const SCREEN_HEIGHT = 915;

const MOCK_INDEXERS = [
  { id: 'prowlarr-1', name: 'TorrentLeech', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 5 * 60000).toISOString() }, qbittorrent: { working: true, hasTorrents: true, statuses: [{ code: 2, msg: 'Working' }], lastChecked: new Date().toISOString() }, autobrrUptimePercentage: 100, qbUptimePercentage: 100, stats: { uploaded: 5000000000000, downloaded: 1500000000000, ratio: 3.33, buffer: 3500000000000 } },
  { id: 'prowlarr-2', name: 'MoreThanTV', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 10 * 60000).toISOString() }, qbittorrent: { working: true, hasTorrents: true, statuses: [{ code: 2, msg: 'Working' }], lastChecked: new Date().toISOString() }, autobrrUptimePercentage: 100, qbUptimePercentage: 100, stats: { uploaded: 800000000000, downloaded: 920000000000, ratio: 0.77, buffer: -120000000000 } },
  { id: 'prowlarr-3', name: 'TorrentDay', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: null }, qbittorrent: { working: true, hasTorrents: true, statuses: [{ code: 2, msg: 'Working' }], lastChecked: new Date().toISOString() }, autobrrUptimePercentage: 100, qbUptimePercentage: 100, stats: { uploaded: 2500000000000, downloaded: 2400000000000, ratio: 1.04, buffer: 100000000000 } },
  { id: 'prowlarr-4', name: 'IPTorrents', status: 'down', lastChecked: new Date().toISOString(), downtimeMinutes: 145, uptimePercentage: 92, autobrr: null, autobrrMissing: true, qbittorrent: { working: false, hasTorrents: false, statuses: [], lastChecked: new Date().toISOString() }, qbDowntimeMinutes: 145 },
  { id: 'prowlarr-5', name: 'AlphaRatio', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 15 * 60000).toISOString() }, qbittorrent: { working: true, hasTorrents: true, statuses: [{ code: 2, msg: 'Working' }], lastChecked: new Date().toISOString() }, autobrrUptimePercentage: 100, qbUptimePercentage: 100, stats: { uploaded: 12000000000000, downloaded: 3000000000000, ratio: 4.0, buffer: 9000000000000 } },
  { id: 'prowlarr-6', name: 'PassThePopcorn', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: false, monitoring: false, lastAnnounce: null }, qbittorrent: { working: false, hasTorrents: false, statuses: [], lastChecked: new Date().toISOString() }, autobrrUptimePercentage: 54 },
  { id: 'prowlarr-7', name: 'HDTorrents', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, qbittorrent: { working: false, hasTorrents: true, statuses: [{ code: 1, msg: 'Tracker error' }], lastChecked: new Date().toISOString() }, qbUptimePercentage: 42, qbDowntimeMinutes: 180 },
  { id: 'prowlarr-8', name: 'BeyondHD', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 30 * 60000).toISOString() }, qbittorrent: { working: true, hasTorrents: true, statuses: [{ code: 2, msg: 'Working' }], lastChecked: new Date().toISOString() }, autobrrUptimePercentage: 100, qbUptimePercentage: 100, stats: { uploaded: 900000000000, downloaded: 450000000000, ratio: 2.0, buffer: 450000000000 } },
  { id: 'prowlarr-9', name: 'SpeedApp', status: 'down', lastChecked: new Date().toISOString(), downtimeMinutes: 320, uptimePercentage: 78, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 90 * 60000).toISOString() }, qbittorrent: { working: false, hasTorrents: true, statuses: [{ code: 1, msg: 'Tracker error' }], lastChecked: new Date().toISOString() }, autobrrUptimePercentage: 99, qbUptimePercentage: 31, autobrrDowntimeMinutes: 15, qbDowntimeMinutes: 320 },
  { id: 'prowlarr-10', name: 'FileList', status: 'up', lastChecked: new Date().toISOString(), downtimeMinutes: null, uptimePercentage: 100, autobrr: { enabled: true, connected: true, monitoring: true, lastAnnounce: new Date(Date.now() - 40 * 60000).toISOString() }, qbittorrent: { working: true, hasTorrents: true, statuses: [{ code: 2, msg: 'Working' }], lastChecked: new Date().toISOString() }, autobrrUptimePercentage: 100, qbUptimePercentage: 100, stats: { uploaded: 100000000000, downloaded: 95000000000, ratio: 1.05, buffer: 5000000000 } },
];

const MOCK_SERVICES = {
  prowlarr: { ok: true },
  autobrr: { ok: true },
  qbittorrent: { ok: true, connectionStatus: 'firewalled', portOpen: false },
};

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

const setupRoutes = (page, iconCache) => {
  const iconRoute = async (route) => {
    const match = route.request().url().match(/icon\/(\d+)$/);
    const id = match ? parseInt(match[1], 10) : 1;
    const idx = Math.min(Math.max(id - 1, 0), COLORS.length - 1);
    if (!iconCache.has(idx)) iconCache.set(idx, makePNG(...COLORS[idx]));
    await route.fulfill({ status: 200, contentType: 'image/png', body: iconCache.get(idx) });
  };

  return Promise.all([
    page.route('**/api/indexers/icon/*', iconRoute),
    page.route('**/api/auth/login', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'mock-token' }) });
    }),
    page.route('**/api/indexers', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ indexers: MOCK_INDEXERS, services: MOCK_SERVICES }) });
    }),
  ]);
};

const capture = async (context, iconCache, fullPage = true) => {
  const page = await context.newPage();
  await setupRoutes(page, iconCache);

  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');

  await page.waitForSelector('text=TorrentLeech >> visible=true', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const light = await page.screenshot({ fullPage });

  await page.click('button[aria-label="Toggle theme"]');
  await page.waitForTimeout(500);

  const dark = await page.screenshot({ fullPage });

  return { light, dark };
};

const frameMobileShot = async (browser, imageBuf) => {
  const b64 = imageBuf.toString('base64');
  const bezel = '#222';

  const BORDER_RADIUS = 44;
  const INNER_RADIUS = BORDER_RADIUS - 6;

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:6px;background:transparent;display:flex;justify-content:center;align-items:center">
    <div style="position:relative;border-radius:${BORDER_RADIUS}px;padding:6px 6px 20px 6px;background:${bezel};display:inline-flex">
    <img src="data:image/png;base64,${b64}" style="display:block;border-radius:${INNER_RADIUS}px;width:${SCREEN_WIDTH}px">
  </div>
</body>
</html>`;

  const page = await browser.newPage();
  await page.setContent(html);
  await page.waitForTimeout(200);
  const result = await page.screenshot({ fullPage: true, omitBackground: true });
  await page.close();
  return result;
};

(async () => {
  const iconCache = new Map();
  const browser = await chromium.launch({ headless: true });

  const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const desktop = await capture(desktopCtx, iconCache);
  await desktopCtx.close();

  const mobileCtx = await browser.newContext({ viewport: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } });
  const mobile = await capture(mobileCtx, iconCache, false);
  await mobileCtx.close();

  const mobileLight = await frameMobileShot(browser, mobile.light);
  const mobileDark = await frameMobileShot(browser, mobile.dark);

  await browser.close();

  const fs = await import('fs');
  fs.writeFileSync('screenshot-light.png', desktop.light);
  fs.writeFileSync('screenshot-dark.png', desktop.dark);
  fs.writeFileSync('screenshot-light-mobile.png', mobileLight);
  fs.writeFileSync('screenshot-dark-mobile.png', mobileDark);
})().catch((err) => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
