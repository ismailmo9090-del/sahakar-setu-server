import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import { logger } from '../config/logger.js';

const register = new Registry();

collectDefaultMetrics({ register });

export const queriesTotal = new Counter({
  name: 'sahakar_queries_total',
  help: 'Total queries processed',
  labelNames: ['channel', 'language', 'category'] as const,
  registers: [register],
});

export const latencyHistogram = new Histogram({
  name: 'sahakar_latency_seconds',
  help: 'Processing latency in seconds',
  labelNames: ['stage'] as const,
  buckets: [0.1, 0.5, 1, 1.5, 2, 2.5, 3, 5, 10],
  registers: [register],
});

export const fallbackTotal = new Counter({
  name: 'sahakar_fallback_total',
  help: 'Total fallback activations',
  labelNames: ['component'] as const,
  registers: [register],
});

export const escalationsTotal = new Counter({
  name: 'sahakar_escalations_total',
  help: 'Total escalations',
  labelNames: ['category'] as const,
  registers: [register],
});

export const groundingFailuresTotal = new Counter({
  name: 'sahakar_grounding_failures_total',
  help: 'Total grounding check failures',
  registers: [register],
});

export const groundingRetriesTotal = new Counter({
  name: 'sahakar_grounding_retries_total',
  help: 'Total grounding retries that recovered a citation',
  registers: [register],
});

export async function registerMetrics() {
  logger.info('Prometheus metrics registered');
}

export async function metricsHandler(_req: any, res: any) {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end();
  }
}
