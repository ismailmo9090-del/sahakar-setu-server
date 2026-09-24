import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { getCaseFacts, saveFacts } from '../../modules/case-memory/index.js';
import { analyzeDocument } from '../../modules/document-scan/index.js';
import { logger } from '../../config/logger.js';

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP, PDF allowed'));
    }
  },
});

const router = Router();

const UploadSchema = z.object({
  caseId: z.string().uuid(),
  docType: z.enum(['fir', 'sale_deed', 'notice', 'land_record', 'sowing_cert']),
  language: z.string().default('hi'),
});

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  let tmpPath: string | null = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    tmpPath = req.file.path;

    const parsed = UploadSchema.safeParse({
      caseId: req.body.caseId,
      docType: req.body.docType,
      language: req.body.language || 'hi',
    });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { caseId, docType, language } = parsed.data;

    const db = getDb();

    const { data: caseData, error: caseError } = await db
      .from('cases')
      .select('id')
      .eq('id', caseId)
      .single();

    if (caseError || !caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const analysis = await analyzeDocument(tmpPath, caseId, language);

    const { data: doc, error: docError } = await db
      .from('documents')
      .insert({
        case_id: caseId,
        doc_type: docType,
        original_filename: req.file.originalname,
        storage_path: tmpPath,
        ocr_text: analysis.ocrText,
        analysis_summary: analysis.summary,
        language,
      })
      .select('id')
      .single();

    if (docError) {
      logger.error({ error: docError }, 'Failed to save document');
      return res.status(500).json({ error: 'Failed to save document' });
    }

    if (analysis.extractedFacts.length > 0) {
      await saveFacts(caseId, analysis.extractedFacts);
    }

    const facts = await getCaseFacts(caseId);
    const verdict = computeSimpleVerdict(facts, docType);

    await db
      .from('cases')
      .update({ strength_score: verdict.score, updated_at: new Date().toISOString() })
      .eq('id', caseId);

    logger.info({ docId: doc?.id, caseId, docType }, 'Document uploaded and analyzed');

    res.json({
      doc_id: doc?.id,
      doc_type: docType,
      summary: analysis.summary,
      extracted_facts: analysis.extractedFacts,
      verdict_update: verdict,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Document upload error');
    res.status(500).json({ error: err?.message || 'Internal server error' });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    }
  }
});

router.get('/:docId', async (req: Request, res: Response) => {
  try {
    const { docId } = req.params;
    if (!docId || !/^[0-9a-f-]{36}$/i.test(docId)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const db = getDb();
    const { data, error } = await db
      .from('documents')
      .select('id, doc_type, ocr_text, analysis_summary, uploaded_at, language')
      .eq('id', docId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({
      doc_id: data.id,
      doc_type: data.doc_type,
      ocr_text: data.ocr_text,
      analysis_summary: data.analysis_summary,
      language: data.language,
      uploaded_at: data.uploaded_at,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Get document error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

function computeSimpleVerdict(facts: any[], docType: string): { score: number; band: string } {
  let score = 0;
  const factKeys = facts.map(f => f.factKey || f.fact_key);
  if (factKeys.includes('name')) score += 10;
  if (factKeys.includes('village')) score += 10;
  if (factKeys.includes('pacs')) score += 5;
  if (docType) score += 15;

  let band = 'weak';
  if (score >= 80) band = 'strong';
  else if (score >= 60) band = 'strong_preliminary';
  else if (score >= 30) band = 'needs_evidence';

  return { score, band };
}

export default router;
