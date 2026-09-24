import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { healthCheck } from './db/client.js';
import { registerMetrics, metricsHandler } from './services/metrics.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { handleWebConnection } from './channels/web/index.js';
import chatRoutes from './channels/web/routes.js';
import caseRoutes from './modules/case/routes.js';
import grievanceRoutes from './modules/grievance/routes.js';
import documentRoutes from './modules/document-scan/routes.js';
import schemeRoutes from './modules/schemes/routes.js';
import pmfbyRoutes from './modules/pmfby/routes.js';
import financialRoutes from './modules/financial-literacy/routes.js';
import escalationRoutes from './modules/escalation/routes.js';
import lawyerRoutes from './modules/laws/routes.js';
import voiceRoutes from './modules/voice/routes.js';
import { handleWhatsAppWebhook } from './channels/whatsapp/index.js';
import { handleSMSWebhook } from './channels/sms/index.js';
import { handleVAPIWebhook, handleVAPITranscriber, handleVAPICustomLLM } from './channels/ivr/index.js';

const env = getEnv();
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);
app.use(rateLimit);

app.get('/health', async (_req, res) => {
  const dbOk = await healthCheck();
  const status = dbOk ? 'ok' : 'degraded';
  res.json({ status, timestamp: new Date().toISOString(), db: dbOk ? 'connected' : 'disconnected' });
});

app.get('/metrics', metricsHandler);

app.use('/api/v1', chatRoutes);
app.use('/api/v1/case', caseRoutes);
app.use('/api/v1/grievance', grievanceRoutes);
app.use('/api/v1/document', documentRoutes);
app.use('/api/v1/scheme', schemeRoutes);
app.use('/api/v1/pmfby', pmfbyRoutes);
app.use('/api/v1/financial', financialRoutes);
app.use('/api/v1/escalation', escalationRoutes);
app.use('/api/v1/lawyer', lawyerRoutes);
app.use('/api/v1', voiceRoutes);

app.post('/webhook/twilio/whatsapp', handleWhatsAppWebhook);
app.post('/webhook/twilio/sms', handleSMSWebhook);
app.post('/webhook/vapi/call', handleVAPIWebhook);
app.post('/webhook/vapi/transcriber', handleVAPITranscriber);
app.post('/webhook/vapi/chat/completions', handleVAPICustomLLM);
// VAPI naively appends "/chat/completions" to model.url — secret lives in the path segment
app.post('/webhook/vapi/:secret/chat/completions', handleVAPICustomLLM);

app.get('/', (_req, res) => {
  res.json({
    name: 'Sahakar Setu API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      chat: 'POST /api/v1/chat',
      chatStream: 'POST /api/v1/chat/stream',
      case: 'GET /api/v1/case/:caseId',
      verdict: 'GET /api/v1/case/:caseId/verdict',
      grievance: 'POST /api/v1/grievance/draft',
      grievanceTrack: 'GET /api/v1/grievance/track/:trackingId',
      document: 'POST /api/v1/document/upload',
      scheme: 'POST /api/v1/scheme/eligibility',
      pmfby: 'POST /api/v1/pmfby/premium',
      financial: 'POST /api/v1/financial/emi',
      lessons: 'GET /api/v1/financial/lessons/:language',
      escalation: 'POST /api/v1/escalation/path',
      lawyer: 'POST /api/v1/lawyer/connect',
      metrics: '/metrics',
    }
  });
});

app.use('/api/chat', chatRoutes);
app.use('/api', chatRoutes);

app.use(errorHandler);

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
  const url = req.url || '';

  if (url.includes('/ws/chat') || url.includes('/ws/stt') || url.includes('/ws/tts')) {
    handleWebConnection(ws);
  } else {
    logger.info({ url }, 'WebSocket connection established');
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        logger.debug({ type: msg.type }, 'WS message received');
      } catch (err) {
        logger.error({ err }, 'Invalid WS message');
      }
    });
    ws.on('close', () => {
      logger.info('WebSocket connection closed');
    });
  }
});

server.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT, host: '0.0.0.0', env: env.NODE_ENV }, 'Sahakar Setu server started');
});

process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  wss.close();
  server.close(() => process.exit(0));
});

export { app, server };
