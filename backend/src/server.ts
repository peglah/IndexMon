import { logger } from './utils/logger';
import app from './app';
import { initDefinitionChecker } from './services/definitions';
import { startQbitPolling } from './services/qbittorrent';
import { initTrackerStats } from './services/tracker-stats';

const PORT = Number(process.env.PORT) || 3000;
const version = process.env.APP_VERSION || 'dev';

const startServer = async () => {
  logger.info(`Starting IndexMon v${version}...`);
  try {
    await initDefinitionChecker();
    startQbitPolling(parseInt(process.env.QBITTORRENT_POLL_INTERVAL_S || '300', 10));
    initTrackerStats();
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`IndexMon v${version} running on http://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();