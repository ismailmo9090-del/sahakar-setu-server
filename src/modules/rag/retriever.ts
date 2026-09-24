import { getDb } from '../../db/client.js';
import { RetrievedPassage } from '../../types/index.js';
import { RAG_CONFIG } from '../../config/constants.js';
import { logger } from '../../config/logger.js';

const HINDI_STOP_WORDS = new Set([
  'mai', 'mera', 'meri', 'mero', 'kya', 'hai', 'hain', 'ho', 'hein',
  'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'par', 'ye', 'wo',
  'aur', 'ya', 'to', 'nahi', 'na', 'kab', 'kaise', 'kahan', 'kaun',
  'kyun', 'kitna', 'kitne', 'bhi', 'jo', 'jis', 'jaise', 'wala',
  'sab', 'kuch', 'ek', 'do', 'tum', 'aap', 'hum', 'woh', 'yah',
  'karo', 'karein', 'karta', 'karte', 'rakhta', 'rakhte', 'hota', 'hote',
  'diya', 'dete', 'milta', 'milte', 'hoga', 'karenge', 'kar', 'kr',
  'rah', 're', 'raha', 'rahe', 'kaa', 'kee', 'koi', 'us', 'iska',
  'unki', 'unki', 'apne', 'apna',
]);

const HINGLISH_MAP: Record<string, string[]> = {
  'farmer': ['kisan', 'kisanon', 'krishak'],
  'premium': ['kiraya', 'bhugtan', 'payment'],
  'insurance': ['bima', 'bima yojana'],
  'cooperative': ['sahakari', 'sahakar', 'society', 'samiti'],
  'voting': ['mat', 'matadan', 'vote'],
  'vote': ['mat', 'matadan', 'voting'],
  'right': ['adhikar', 'haq'],
  'rights': ['adhikar', 'haq'],
  'grievance': ['shikayat', 'samasya'],
  'scheme': ['yojana'],
  'loan': ['rin', 'karj', 'kharza'],
  'interest': ['byaj', 'bunj'],
  'member': ['sadasya', 'nisarga'],
  'members': ['sadasya', 'nisarga'],
  'membership': ['sadasyata', 'sadasya'],
  'admission': ['pravish', 'prvesh', 'admission', 'sadasyata'],
  'become': ['banna', 'banein', 'shamil'],
  'join': ['shamil', 'shamil hona', 'pravesh'],
  'who can be member': ['admission', 'sadasyata', 'competent'],
  'apply': ['aavedan', 'apply'],
  'register': ['register', 'panjikaran', 'registration'],
  'registration': ['register', 'panjikaran', 'registration'],
  'society': ['samiti', 'sangh', 'sahakari'],
  'document': ['dastavez', 'kagaz'],
  'documents': ['dastavez', 'kagaz'],
  'complaint': ['shikayat'],
  'claim': ['dava', 'mukaddma'],
  'crop': ['fasal'],
  'election': ['chunav', 'nirvachan'],
  'audit': ['parkh', 'lekhaparkh'],
  'surplus': ['labh', 'labhansh', 'adhishest'],
  'pension': ['pension', 'vdh'],
  'savings': ['bachat', 'jama'],
  'account': ['khata', 'khaata'],
  'kcc': ['crop loan', 'kisan credit card'],
  'emi': ['kist', 'kistoon', 'installment'],
  'interest rate': ['byaj dar', 'dar'],
  'rate': ['dar'],
  'byelaw': ['bye-law', 'upabidhi'],
  'act': ['adhiniyam'],
  'mscs': ['multi-state cooperative society', 'cooperative societies act', 'multi-state'],
  'become member': ['admission', 'sadasya', 'competent'],
  'banein': ['admission', 'sadasyata', 'eligible', 'competent'],
  'banna': ['admission', 'sadasyata', 'eligible', 'competent'],
  'eligible': ['eligibility', 'yogya', 'competent'],
};

export function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    const hindi = HINGLISH_MAP[kw];
    if (hindi) hindi.forEach(h => expanded.add(h.toLowerCase()));
    for (const [eng, hindiList] of Object.entries(HINGLISH_MAP)) {
      if (hindiList.some(h => h === kw)) expanded.add(eng);
    }
  }
  return [...expanded];
}

export function extractKeywords(query: string): { singles: string[]; bigrams: string[] } {
  const normalized = query.toLowerCase().trim();

  const bigrams: string[] = [];
  const words = normalized
    .replace(/[^\w\s\u0900-\u097F]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !HINDI_STOP_WORDS.has(w));

  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }

  const singles = expandKeywords([...new Set(words)]);
  const expandedBigrams = expandKeywords([...new Set(bigrams)]);
  return { singles, bigrams: expandedBigrams };
}

function computeIdfWeights(
  keywords: string[],
  totalDocs: number,
  docCounts: Map<string, number>
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const kw of keywords) {
    const df = docCounts.get(kw) ?? 0;
    weights.set(kw, Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5)));
  }
  return weights;
}

export function computeSimilarity(
  textLower: string,
  keywords: { singles: string[]; bigrams: string[]; weights: Map<string, number>; avgDocLength: number },
  originalQuery: string
): number {
  const { singles, bigrams, weights, avgDocLength } = keywords;
  if (singles.length === 0 && bigrams.length === 0) return 0;

  const docLength = textLower.split(/\s+/).length || 1;
  const k1 = 1.2;
  const b = 0.75;

  let score = 0;
  for (const kw of singles) {
    let count = 0;
    let idx = textLower.indexOf(kw);
    while (idx !== -1 && count < 9) {
      count++;
      idx = textLower.indexOf(kw, idx + 1);
    }
    if (count === 0) continue;
    const idf = weights.get(kw) ?? 1;
    score += idf * ((count * (k1 + 1)) / (count + k1 * (1 - b + (b * docLength) / avgDocLength)));
  }

  for (const bigram of bigrams) {
    if (textLower.includes(bigram)) {
      score += 3.0;
    }
  }

  const phrase = originalQuery.toLowerCase().trim().replace(/[^\w\s\u0900-\u097F]/g, '');
  if (phrase.length > 8 && textLower.includes(phrase)) {
    score += 2.5;
  }

  return score;
}

export async function retrieve(
  query: string,
  category?: string,
  topK: number = RAG_CONFIG.TOP_K,
  threshold: number = 0.2
): Promise<RetrievedPassage[]> {
  try {
    const db = getDb();
    const keywords = extractKeywords(query);

    if (keywords.singles.length === 0) {
      logger.warn({ query }, 'No keywords extracted from query');
      return [];
    }

    const queryBuilder = db
      .from('corpus_passages')
      .select('id, source_doc, section_ref, passage_text, category')
      .order('id', { ascending: true })
      .limit(1000);

    if (category) {
      queryBuilder.eq('category', category);
    }

    const { data: passages, error } = await queryBuilder;

    if (error) {
      logger.error({ error }, 'RAG retrieval failed');
      return [];
    }

    if (!passages || passages.length === 0) {
      return [];
    }

    const totalDocs = passages.length;
    const allKeywords = [...new Set([...keywords.singles, ...keywords.bigrams])];
    const docCounts = new Map<string, number>();
    for (const kw of allKeywords) {
      let count = 0;
      for (const p of passages) {
        if ((p.passage_text || '').toLowerCase().includes(kw)) count++;
      }
      docCounts.set(kw, count);
    }
    const weights = computeIdfWeights(allKeywords, totalDocs, docCounts);

    const totalLength = passages.reduce((sum, p) => sum + (p.passage_text || '').split(/\s+/).length, 0);
    const avgDocLength = totalLength / Math.max(1, totalDocs);

    const results: RetrievedPassage[] = passages.map((p: any) => {
      const textLower = p.passage_text.toLowerCase();
      const similarity = computeSimilarity(textLower, { ...keywords, weights, avgDocLength }, query);
      return {
        id: p.id,
        sourceDoc: p.source_doc,
        sectionRef: p.section_ref,
        text: p.passage_text,
        similarity,
        category: p.category,
      };
    });

    const ranked = results
      .filter(r => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));

    const top = ranked.slice(0, topK);

    if (top.length === 0) {
      logger.info({ query, keywords: keywords.singles.length }, 'RAG returned zero passages');
    }

    return top;
  } catch (err) {
    logger.error({ err }, 'RAG retrieval error');
    return [];
  }
}