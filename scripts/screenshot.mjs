import { chromium } from 'playwright';

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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.route('**/api/indexers', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_INDEXERS) });
  });

  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');

  await page.waitForSelector('text=TorrentLeech', { timeout: 15000 });
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  await browser.close();
})().catch((err) => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
