import client from 'prom-client';
import type { Request, Response } from 'express';

client.collectDefaultMetrics();

export const pollDuration = new client.Histogram({
  name: 'indexmon_poll_duration_seconds',
  help: 'Duration of full indexer poll cycle',
  buckets: [1, 2, 5, 10, 20, 30],
});

export const pollTotal = new client.Counter({
  name: 'indexmon_poll_total',
  help: 'Total poll cycles',
  labelNames: ['result'] as const,
});

export const upstreamReachable = new client.Gauge({
  name: 'indexmon_upstream_reachable',
  help: 'Whether upstream services are reachable (1=ok, 0=down)',
  labelNames: ['service'] as const,
});

export const historyRows = new client.Gauge({
  name: 'indexmon_history_rows',
  help: 'Number of rows in indexer_history table',
});

export const metricsHandler = async (_req: Request, res: Response) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
};
