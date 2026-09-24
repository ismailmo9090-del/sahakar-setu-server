import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

let supabase: SupabaseClient;

export function getDb(): SupabaseClient {
  if (!supabase) {
    const env = getEnv();
    supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    logger.info('Supabase client initialized');
  }
  return supabase;
}

export async function dbQuery(text: string, params?: unknown[]) {
  const db = getDb();
  const start = Date.now();
  const result = await db.rpc('query', { query_text: text, query_params: params });
  const duration = Date.now() - start;
  logger.debug({ duration, rows: result.data?.length }, 'DB query executed');
  return result;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const db = getDb();
    const { error } = await db.from('sessions').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}
