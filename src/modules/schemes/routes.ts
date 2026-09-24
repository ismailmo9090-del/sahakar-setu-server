import { Router, Request, Response } from 'express';
import { getAvailableSchemes, checkEligibility } from './index.js';
import { SchemeEligibilitySchema } from '../../types/index.js';
import { logger } from '../../config/logger.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const schemes = getAvailableSchemes();
  res.json({ schemes });
});

router.post('/eligibility', (req: Request, res: Response) => {
  try {
    const parsed = SchemeEligibilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { scheme, answers } = parsed.data;
    const result = checkEligibility(scheme, answers);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Scheme eligibility error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
