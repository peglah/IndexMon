import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { logger } from './utils/logger';
import app from './app';
import { setPasswordHash, stopSessionCleanup } from './middleware/auth';
import { drainIconCaches } from './services/indexer';
import { initDefinitionChecker } from './services/definitions';
import { startQbitPolling, stopQbitPolling } from './services/qbittorrent';
import { initTrackerStats, stopTrackerStats } from './services/tracker-stats';
import { knex } from './config/database';

const PORT = Number(process.env.PORT) || 3000;
const version = process.env.APP_VERSION || 'dev';

const startServer = async () => {
  logger.info(`Starting IndexMon v${version}...`);
  try {
    const envHash = process.env.ADMIN_PASSWORD_HASH;
    if (envHash) {
      setPasswordHash(envHash);
      logger.info('Admin password configured from ADMIN_PASSWORD_HASH');
    } else {
      const adminPassword = randomBytes(12).toString('hex');
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      setPasswordHash(passwordHash);
      logger.info(`=== Generated admin password: ${adminPassword} ===`);
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`IndexMon v${version} running on http://0.0.0.0:${PORT}`);
    });
    server.timeout = 30000;

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`Shutting down (${signal})...`);
      try {
        await drainIconCaches();
      } catch (error) {
        logger.warn('Icon cache drain failed:', error);
      }
      server.close(() => {
        stopQbitPolling();
        stopTrackerStats();
        stopSessionCleanup();
        knex.destroy();
        const code = signal === 'SIGINT' ? 130 : 0;
        process.exit(code);
      });
      setTimeout(() => {
        logger.warn('Forced shutdown after timeout');
        process.exit(1);
      }, 10_000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Heavyweight init — no longer blocks the socket from accepting
    await initDefinitionChecker();
    startQbitPolling(parseInt(process.env.QBITTORRENT_POLL_INTERVAL_S || '300', 10));
    await initTrackerStats();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();