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

export const indexerUp = new client.Gauge({
  name: 'indexmon_indexer_up',
  help: 'Whether an indexer is up (1) or down (0) per source (prowlarr/autobrr/qbittorrent)',
  labelNames: ['indexer', 'source'] as const,
});

export const indexerUptimePercentage = new client.Gauge({
  name: 'indexmon_indexer_uptime_percentage',
  help: '24-hour time-weighted uptime percentage per source',
  labelNames: ['indexer', 'source'] as const,
});

export const announceAgeSeconds = new client.Gauge({
  name: 'indexmon_announce_age_seconds',
  help: 'Seconds since last Autobrr IRC announce per indexer',
  labelNames: ['indexer'] as const,
});

export const trackerBufferBytes = new client.Gauge({
  name: 'indexmon_tracker_buffer_bytes',
  help: 'Per-indexer buffer (uploaded minus downloaded) in bytes',
  labelNames: ['indexer'] as const,
});

export const trackerRatio = new client.Gauge({
  name: 'indexmon_tracker_ratio',
  help: 'Per-indexer upload/download ratio',
  labelNames: ['indexer'] as const,
});

export const upstreamErrors = new client.Counter({
  name: 'indexmon_upstream_errors_total',
  help: 'Total upstream service errors per source',
  labelNames: ['service'] as const,
});

export const circuitBreakerOpen = new client.Gauge({
  name: 'indexmon_circuit_breaker_open',
  help: 'Whether the circuit breaker is open (1) for a service (prowlarr/autobrr)',
  labelNames: ['service'] as const,
});

export const alertSends = new client.Counter({
  name: 'indexmon_alert_sends_total',
  help: 'Total alert sends per result',
  labelNames: ['result'] as const,
});

export const metricsHandler = async (_req: Request, res: Response) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
};
