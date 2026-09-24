import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { maskPhone } from '../../utils/text.js';
import { logger } from '../../config/logger.js';

const LawyerConnectSchema = z.object({
  caseId: z.string().uuid(),
  memberPhone: z.string().min(10).max(15),
  confirmCallback: z.boolean().default(false),
});

const router = Router();

router.post('/connect', async (req: Request, res: Response) => {
  try {
    const parsed = LawyerConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { caseId, memberPhone, confirmCallback } = parsed.data;

    const db = getDb();

    const { data: caseData, error: caseError } = await db
      .from('cases')
      .select('id, strength_score, category, language')
      .eq('id', caseId)
      .single();

    if (caseError || !caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }

    if (caseData.strength_score < 60) {
      return res.status(400).json({
        error: 'Case score too low for lawyer connection',
        current_score: caseData.strength_score,
        required_score: 60,
        message: 'Pehle apne case ko majboot karein. Documents upload karein aur facts add karein.',
      });
    }

    if (!confirmCallback) {
      return res.status(200).json({
        requires_confirmation: true,
        message: 'Lawyer se connect hone ke liye confirmation chahiye. confirmCallback: true bhejein.',
        score: caseData.strength_score,
      });
    }

    const { data: lawyers, error: lawyerError } = await db
      .from('lawyer_directory')
      .select('id, full_name, bar_council_id, languages, districts, specialization')
      .eq('verified', true)
      .limit(1);

    if (lawyerError || !lawyers || lawyers.length === 0) {
      return res.status(404).json({ error: 'No verified lawyers available' });
    }

    const advocate = lawyers[0];

    const callbackWindow = '24-48 hours';

    logger.info({ caseId, advocateId: advocate.id }, 'Lawyer connection initiated');

    res.json({
      advocate_id: advocate.id,
      advocate_name: advocate.full_name,
      specialization: advocate.specialization,
      languages: advocate.languages,
      callback_window: callbackWindow,
      fees: 'Free (Legal Aid)',
      tracking_id: `LAW-${caseId.slice(0, 8)}`,
      message: `${advocate.full_name} se aapka connect ho jayega ${callbackWindow} mein.`,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Lawyer connect error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
