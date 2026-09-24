import { logger } from '../config/logger.js';

let redis: any = null;
let redisAvailable = false;

const memoryCache = new Map<string, { value: Buffer; expiresAt: number }>();
const MEMORY_CACHE_MAX = 500;

function memoryCacheGet(key: string): Buffer | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function memoryCacheSet(key: string, value: Buffer, ttlSeconds: number): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

const stringMemoryCache = new Map<string, { value: string; expiresAt: number }>();

function memoryCacheGetString(key: string): string | null {
  const entry = stringMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    stringMemoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function memoryCacheSetString(key: string, value: string, ttlSeconds: number): void {
  if (stringMemoryCache.size >= MEMORY_CACHE_MAX) {
    const firstKey = stringMemoryCache.keys().next().value;
    if (firstKey) stringMemoryCache.delete(firstKey);
  }
  stringMemoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function getRedis(): any {
  if (redis) return redis;
  try {
    const Redis = require('ioredis');
    const { getEnv } = require('../config/env.js');
    const env = getEnv();
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy(times: number) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      connectTimeout: 3000,
      lazyConnect: true,
    });
    redis.on('error', () => { redisAvailable = false; });
    redis.on('connect', () => {
      redisAvailable = true;
      logger.info('Redis connected');
    });
    redis.connect().catch(() => {
      logger.warn('Redis not available, using in-memory cache');
    });
  } catch (err) {
    logger.warn('Failed to create Redis client, using in-memory cache');
  }
  return redis;
}

export function isRedisAvailable(): boolean {
  return redisAvailable && redis !== null;
}

export async function cacheGet(key: string): Promise<Buffer | null> {
  const memResult = memoryCacheGet(key);
  if (memResult) return memResult;

  if (isRedisAvailable()) {
    try {
      const result = await redis!.getBuffer(key);
      if (result) {
        memoryCacheSet(key, result, 86400);
        return result;
      }
    } catch { return null; }
  }
  return null;
}

export async function cacheSet(key: string, value: Buffer, ttlSeconds: number = 86400): Promise<void> {
  memoryCacheSet(key, value, ttlSeconds);
  if (isRedisAvailable()) {
    try {
      await redis!.set(key, value, 'EX', ttlSeconds);
    } catch { /* ignore */ }
  }
}

export async function cacheGetString(key: string): Promise<string | null> {
  const memResult = memoryCacheGetString(key);
  if (memResult) return memResult;

  if (isRedisAvailable()) {
    try {
      const result = await redis!.get(key);
      if (result) {
        memoryCacheSetString(key, result, 86400);
        return result;
      }
    } catch { return null; }
  }
  return null;
}

export async function cacheSetString(key: string, value: string, ttlSeconds: number = 86400): Promise<void> {
  memoryCacheSetString(key, value, ttlSeconds);
  if (isRedisAvailable()) {
    try {
      await redis!.set(key, value, 'EX', ttlSeconds);
    } catch { /* ignore */ }
  }
}
