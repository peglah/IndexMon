import express from 'express';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import indexerRoutes from './routes/indexers';
import authRoutes from './routes/auth';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';

const app = express();

app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));

// Unprotected icon route (img tags in browser don't send auth headers)
const iconContentType = (filePath: string): string => {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(100);
    const bytesRead = fs.readSync(fd, buf, 0, 100, 0);
    fs.closeSync(fd);
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
    if (buf[0] === 0x3c) {
      const text = buf.toString('utf8', 0, bytesRead).trimStart();
      if (text.startsWith('<svg') || text.startsWith('<?xml') || text.startsWith('<!DOCTYPE')) return 'image/svg+xml';
    }
  } catch { /* fall through */ }
  return 'image/png';
};

app.get('/api/indexers/icon/:prowlarrId', (req, res) => {
  const iconsDir = path.resolve(
    path.dirname(process.env.DB_PATH || '/app/data/indexmon.db'),
    'icons',
  );
  const filePath = path.resolve(iconsDir, req.params.prowlarrId + '.png');
  if (!filePath.startsWith(iconsDir + path.sep)) {
    return res.status(400).json({ error: 'Invalid indexer ID' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).end();
  }
  res.type(iconContentType(filePath)).sendFile(filePath);
});

app.use('/api/indexers', authMiddleware, indexerRoutes);

// Error handling
app.use(errorHandler);

export default app;