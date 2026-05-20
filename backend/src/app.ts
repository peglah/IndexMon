import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import indexerRoutes from './routes/indexers';
import authRoutes from './routes/auth';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/indexers', authMiddleware, indexerRoutes);

// Error handling
app.use(errorHandler);

export default app;