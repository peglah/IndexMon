import express from 'express';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import indexerRoutes from './routes/indexers';
import authRoutes from './routes/auth';
import appriseRoutes from './routes/apprise';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { requestIdMiddleware } from './middleware/requestId';
import { httpMetricsMiddleware } from './middleware/httpMetrics';
import { metricsHandler } from './utils/metrics';
import { dbPath } from './config/database';
import { getIconContentType } from './services/indexer-icons';

const app = express();

app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '50kb' }));
app.use(requestIdMiddleware);
app.use(httpMetricsMiddleware);

// Routes
app.use('/api/auth', authRoutes);

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));

// Prometheus metrics
app.get('/metrics', metricsHandler);

const iconLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// Unprotected icon route (img tags in browser don't send auth headers)
app.get('/api/indexers/icon/:prowlarrId', iconLimiter, async (req, res) => {
  const iconsDir = path.resolve(path.dirname(dbPath), 'icons');
  const filePath = path.resolve(iconsDir, req.params.prowlarrId + '.png');
  if (!filePath.startsWith(iconsDir + path.sep))
    return res.status(400).json({ error: 'Invalid indexer ID' });
  try {
    await fs.promises.access(filePath);
    res.type(getIconContentType(+req.params.prowlarrId)).sendFile(filePath);
  } catch {
    res.status(404).end();
  }
});

app.use('/api/apprise', authMiddleware, appriseRoutes);
app.use('/api/indexers', authMiddleware, indexerRoutes);

// Error handling
app.use(errorHandler);

export default app;