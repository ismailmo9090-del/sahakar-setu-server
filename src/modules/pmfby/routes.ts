import { Router, Request, Response } from 'express';
import { calculatePremium } from './index.js';
import { PremiumCalcSchema } from '../../types/index.js';
import { logger } from '../../config/logger.js';

const router = Router();

router.post('/premium', (req: Request, res: Response) => {
  try {
    const parsed = PremiumCalcSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { crop, season, sumInsured } = parsed.data;
    const result = calculatePremium(crop, season, sumInsured);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Premium calculation error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
