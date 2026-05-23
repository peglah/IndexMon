import app from './app';
import { initDefinitionChecker } from './services/definitions';
import { startQbitPolling } from './services/qbittorrent';

const PORT = Number(process.env.PORT) || 3000;
const version = process.env.APP_VERSION || 'dev';

const startServer = async () => {
  try {
    await initDefinitionChecker();
    startQbitPolling(parseInt(process.env.QBITTORRENT_POLL_INTERVAL_S || '300', 10));
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`IndexMon v${version} running on http://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();