import { getEnv } from '../config/env.js';
import { getDb } from '../db/client.js';
import { logger } from '../config/logger.js';

let counter = 0;

export async function generateTrackingId(): Promise<string> {
  const env = getEnv();
  const db = getDb();

  if (counter === 0) {
    const { data } = await db
      .from('grievance_drafts')
      .select('tracking_id')
      .order('tracking_id', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      const lastId = data[0].tracking_id;
      const match = lastId.match(/(\d{6})$/);
      if (match) {
        counter = parseInt(match[1], 10);
      }
    }
  }

  counter++;
  const num = String(counter).padStart(6, '0');
  return `${env.TRACKING_ID_PREFIX}-${env.TRACKING_ID_YEAR}-${num}`;
}

export function validateTrackingId(id: string): boolean {
  return /^SS-\d{4}-\d{6}$/.test(id);
}
