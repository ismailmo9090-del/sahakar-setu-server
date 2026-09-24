import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getEnv } from '../config/env.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health' || req.path === '/metrics') {
    return next();
  }

  const token = req.headers['x-hmac-token'] as string;
  if (!token) {
    return res.status(401).json({ error: 'Missing HMAC token' });
  }

  const env = getEnv();
  const expected = crypto
    .createHmac('sha256', env.HMAC_SECRET)
    .update(`${req.method}:${req.path}:${JSON.stringify(req.body)}`)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return res.status(403).json({ error: 'Invalid HMAC token' });
  }

  next();
}
