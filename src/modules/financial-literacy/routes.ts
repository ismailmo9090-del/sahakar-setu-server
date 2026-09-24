import { Router, Request, Response } from 'express';
import { calculateEMI, getAvailableLessons, getLessonById } from './index.js';
import { EMICalcSchema } from '../../types/index.js';
import { runTTS } from '../voice/routes.js';
import { cacheGet, cacheSet } from '../../services/cache.js';
import { createHash } from 'crypto';
import { logger } from '../../config/logger.js';

const router = Router();

router.post('/emi', (req: Request, res: Response) => {
  try {
    const parsed = EMICalcSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { principal, annualRate, tenureMonths } = parsed.data;
    const result = calculateEMI(principal, annualRate, tenureMonths);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'EMI calculation error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/lessons/:language', (req: Request, res: Response) => {
  const lessons = getAvailableLessons();
  const lang = req.params.language || 'hi';
  res.json({
    lessons: lessons.map(l => ({
      lesson_id: l.id,
      title: l.title,
      duration: l.duration,
      language: lang,
    })),
  });
});

router.get('/lessons/:lessonId/audio', async (req: Request, res: Response) => {
  try {
    const lesson = getLessonById(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const lang = (req.query.lang as string) || 'hi';
    const cacheKey = `lesson_audio:${req.params.lessonId}:${lang}`;

    const cached = await cacheGet(cacheKey);
    if (cached) {
      res.set('Content-Type', 'audio/mpeg');
      return res.send(cached);
    }

    const text = `${lesson.title}. ${lesson.description}`;
    const audioBuffer = await runTTS(text, lang);

    await cacheSet(cacheKey, audioBuffer, 86400);

    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Lesson audio error');
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

export default router;
