import { Router, Request, Response } from 'express';
import { getDb } from '../../db/client.js';
import { getCaseFacts } from '../../modules/case-memory/index.js';
import { computeVerdict } from '../../modules/verdict/index.js';
import { logger } from '../../config/logger.js';

const router = Router();

router.get('/:caseId', async (req: Request, res: Response) => {
  try {
    const { caseId } = req.params;
    if (!caseId || !/^[0-9a-f-]{36}$/i.test(caseId)) {
      return res.status(400).json({ error: 'Invalid case ID format' });
    }

    const db = getDb();

    const { data: caseData, error } = await db
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();

    if (error || !caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const facts = await getCaseFacts(caseId);

    const { data: documents } = await db
      .from('documents')
      .select('id, doc_type, original_filename, uploaded_at')
      .eq('case_id', caseId);

    const verdict = computeVerdict({
      ...caseData,
      facts,
      documents: documents || [],
      retrievedPassages: [],
      daysSinceSubmission: Math.floor(
        (Date.now() - new Date(caseData.created_at).getTime()) / (1000 * 60 * 60 * 24)
      ),
    });

    res.json({
      id: caseData.id,
      category: caseData.category,
      subcategory: caseData.subcategory,
      status: caseData.status,
      strength_score: verdict.score,
      language: caseData.language,
      facts: facts.map(f => ({
        id: f.id,
        key: f.factKey,
        value: f.factValue,
        confirmed: f.confirmed,
      })),
      documents: (documents || []).map(d => ({
        id: d.id,
        doc_type: d.doc_type,
        filename: d.original_filename,
        uploaded_at: d.uploaded_at,
      })),
      verdict: {
        score: verdict.score,
        band: verdict.band,
        message: verdict.message,
      },
      created_at: caseData.created_at,
      updated_at: caseData.updated_at,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Get case error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:caseId/verdict', async (req: Request, res: Response) => {
  try {
    const { caseId } = req.params;
    if (!caseId || !/^[0-9a-f-]{36}$/i.test(caseId)) {
      return res.status(400).json({ error: 'Invalid case ID format' });
    }

    const db = getDb();

    const { data: caseData, error } = await db
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();

    if (error || !caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const facts = await getCaseFacts(caseId);

    const { data: documents } = await db
      .from('documents')
      .select('*')
      .eq('case_id', caseId);

    const verdict = computeVerdict({
      ...caseData,
      facts,
      documents: documents || [],
      retrievedPassages: [],
      daysSinceSubmission: Math.floor(
        (Date.now() - new Date(caseData.created_at).getTime()) / (1000 * 60 * 60 * 24)
      ),
    });

    const missingItems: string[] = [];
    const factKeys = facts.map(f => f.factKey);
    if (!factKeys.includes('name')) missingItems.push('naam');
    if (!factKeys.includes('village')) missingItems.push('gaon');
    if (!factKeys.includes('pacs')) missingItems.push('PACS details');
    if ((documents || []).length === 0) missingItems.push('documents');

    res.json({
      score: verdict.score,
      band: verdict.band,
      message: verdict.message,
      missing_items: missingItems,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Get verdict error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
