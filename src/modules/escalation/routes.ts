import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getEscalationPath } from './index.js';
import { logger } from '../../config/logger.js';

const EscalationPathSchema = z.object({
  caseId: z.string().uuid(),
});

const router = Router();

router.post('/path', async (req: Request, res: Response) => {
  try {
    const parsed = EscalationPathSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { caseId } = parsed.data;
    const steps = await getEscalationPath(caseId);
    res.json({ steps });
  } catch (err) {
    logger.error({ err }, 'Escalation path error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
