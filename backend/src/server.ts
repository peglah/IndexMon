import { logger } from './utils/logger';
import app from './app';
import { initDefinitionChecker } from './services/definitions';
import { startQbitPolling } from './services/qbittorrent';

const PORT = Number(process.env.PORT) || 3000;
const version = process.env.APP_VERSION || 'dev';

const startServer = async () => {
  logger.info(`Starting IndexMon v${version}...`);
  try {
    await initDefinitionChecker();
    startQbitPolling(parseInt(process.env.QBITTORRENT_POLL_INTERVAL_S || '300', 10));
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`IndexMon v${version} running on http://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();