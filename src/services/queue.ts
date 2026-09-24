import { logger } from '../config/logger.js';

let ocrQueue: any = null;
let draftQueue: any = null;

export function startWorkers() {
  try {
    const { Queue, Worker } = require('bullmq');
    const { getRedis } = require('./cache.js');
    const connection = { connection: getRedis() };

    ocrQueue = new Queue('ocr', connection);
    draftQueue = new Queue('draft', connection);

    const ocrWorker = new Worker('ocr', async (job: any) => {
      logger.info({ jobId: job.id, caseId: job.data.caseId }, 'Processing OCR job');
    }, connection);

    ocrWorker.on('failed', (job: any, err: any) => {
      logger.error({ jobId: job?.id, err }, 'OCR job failed');
    });

    const draftWorker = new Worker('draft', async (job: any) => {
      logger.info({ jobId: job.id, caseId: job.data.caseId }, 'Processing draft job');
    }, connection);

    draftWorker.on('failed', (job: any, err: any) => {
      logger.error({ jobId: job?.id, err }, 'Draft job failed');
    });

    logger.info('BullMQ workers started');
  } catch (err) {
    logger.warn('BullMQ not available, queue workers disabled');
  }
}

export function getOcrQueue() { return ocrQueue; }
export function getDraftQueue() { return draftQueue; }
