import { getDb } from '../../db/client.js';
import { logger } from '../../config/logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export async function ensureSessionByRef(externalRef: string, language: string, channel = 'ivr'): Promise<string | null> {
  try {
    const db = getDb();
    const { data: existing } = await db
      .from('sessions')
      .select('id')
      .eq('external_ref', externalRef)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      await db.from('sessions').update({ last_active_at: new Date().toISOString() }).eq('id', existing.id);
      return existing.id;
    }
    const { data: created, error } = await db
      .from('sessions')
      .insert({ channel, language, external_ref: externalRef })
      .select('id')
      .single();
    if (error || !created?.id) {
      logger.warn({ error }, 'chat-log: session create failed');
      return null;
    }
    return created.id;
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'chat-log: ensureSessionByRef failed');
    return null;
  }
}

export async function endSession(sessionId: string): Promise<void> {
  try {
    const db = getDb();
    await db.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionId).is('ended_at', null);
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'chat-log: endSession failed');
  }
}

export async function storeTurn(
  sessionId: string | null,
  role: 'user' | 'assistant',
  content: string,
  meta?: Record<string, unknown>
): Promise<void> {
  if (!sessionId || !content) return;
  try {
    const db = getDb();
    const { error } = await db.from('messages').insert({
      session_id: sessionId,
      role,
      content,
      meta: meta ?? null,
    });
    if (error) logger.warn({ error, role }, 'chat-log: storeTurn failed');
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'chat-log: storeTurn failed');
  }
}

export async function countTurns(sessionId: string): Promise<number | null> {
  try {
    const db = getDb();
    const { count, error } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function getRecentTurns(
  sessionId: string,
  limit = 6
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data
      .reverse()
      .filter(r => r.role === 'user' || r.role === 'assistant')
      .map(r => ({ role: r.role as 'user' | 'assistant', content: r.content as string }));
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'chat-log: getRecentTurns failed');
    return [];
  }
}
