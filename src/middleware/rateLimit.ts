import { Request, Response, NextFunction } from 'express';
import { getEnv } from '../config/env.js';

const rateLimitWindow = 60 * 1000;
const ipCounts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const env = getEnv();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + rateLimitWindow });
  } else {
    entry.count++;
    if (entry.count > env.RATE_LIMIT_PER_MINUTE) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
  }
  res.setHeader('X-RateLimit-Remaining', Math.max(0, env.RATE_LIMIT_PER_MINUTE - (ipCounts.get(ip)?.count || 1)));
  next();
}
