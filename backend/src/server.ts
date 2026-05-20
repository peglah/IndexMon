import app from './app';
import { initDefinitionChecker } from './services/definitions';

const PORT = Number(process.env.PORT) || 3000;

const startServer = async () => {
  try {
    await initDefinitionChecker();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();