import { Router, Request, Response } from 'express';
import { generateDraft, trackGrievance } from '../../modules/grievance/index.js';
import { GrievanceDraftSchema, TrackingIdSchema } from '../../types/index.js';
import { logger } from '../../config/logger.js';

const router = Router();

router.post('/draft', async (req: Request, res: Response) => {
  try {
    const parsed = GrievanceDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { caseId, category, language } = parsed.data;

    const { getDb } = await import('../../db/client.js');
    const { getCaseFacts } = await import('../../modules/case-memory/index.js');

    const db = getDb();
    const facts = await getCaseFacts(caseId);

    if (facts.length === 0) {
      return res.status(400).json({
        error: 'No case facts found. Please provide case details first.',
        hint: 'Use the chat to provide: name, village, district, issue description.',
      });
    }

    const draft = await generateDraft({
      caseId,
      category,
      facts,
      language,
    });

    const statusOrder = ['drafted', 'submitted', 'acknowledged', 'escalated', 'resolved'];
    const nextStep = statusOrder[1];

    logger.info({ trackingId: draft.trackingId, caseId }, 'Grievance draft generated');

    res.json({
      tracking_id: draft.trackingId,
      addressee: draft.addressee,
      subject: draft.subject,
      body: draft.body,
      language,
      status: 'drafted',
      next_step: nextStep,
    });
  } catch (err) {
    logger.error({ err }, 'Grievance draft error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/track/:trackingId', async (req: Request, res: Response) => {
  try {
    const parsed = TrackingIdSchema.safeParse({ trackingId: req.params.trackingId });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid tracking ID format. Expected: SS-YYYY-NNNNNN' });
    }

    const result = await trackGrievance(req.params.trackingId);
    if (!result) {
      return res.status(404).json({ error: 'Grievance not found' });
    }

    const { draft, tracking } = result;

    const timeline = (tracking || []).map((t: any) => ({
      status: t.status,
      note: t.note,
      updated_at: t.updated_at,
    }));

    const statusOrder = ['drafted', 'submitted', 'acknowledged', 'escalated', 'resolved'];
    const currentIdx = statusOrder.indexOf(draft.status || 'drafted');
    const nextStep = currentIdx < statusOrder.length - 1 ? statusOrder[currentIdx + 1] : null;

    res.json({
      tracking_id: draft.tracking_id,
      status: draft.status || 'drafted',
      addressee: draft.addressee,
      subject: draft.subject,
      body: draft.body,
      language: draft.language,
      timeline,
      next_step: nextStep,
      created_at: draft.created_at,
    });
  } catch (err) {
    logger.error({ err }, 'Track grievance error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
