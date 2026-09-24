import OpenAI from 'openai';
import { getEnv } from '../../config/env.js';
import { LLMContext, LLMResult, RetrievedPassage } from '../../types/index.js';
import { extractCitations } from '../../utils/citation.js';
import { logger } from '../../config/logger.js';
import { fallbackTotal, groundingFailuresTotal, groundingRetriesTotal } from '../../services/metrics.js';

export const BOUNDARY_MESSAGE = 'Main Sahakar Setu hoon aur sirf sahkari kanoon, sarkari yojanaon, PACS sevaon, PMFBY, vittiya saksharta aur shikayat samadhan se judi jaankari de sakta hoon. Aap in vishayon mein kuch pooch sakte hain.';

let groqClient: OpenAI;

function getGroqClient(): OpenAI {
  if (!groqClient) {
    const env = getEnv();
    groqClient = new OpenAI({
      apiKey: env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: 30000,
      maxRetries: 2,
    });
  }
  return groqClient;
}

export async function generateAnswer(
  query: string,
  ctx: LLMContext
): Promise<LLMResult> {
  const env = getEnv();
  const isVoiceCall = ctx.channel === 'ivr' || ctx.channel === 'voice' || ctx.channel === 'kiosk';
  const systemPrompt = buildSystemPrompt(ctx);
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...ctx.history.slice(isVoiceCall ? -4 : -6),
    { role: 'user' as const, content: query },
  ];

  // Voice channels need low latency: use the smaller/faster model first.
  const primaryModel = isVoiceCall ? env.GROQ_MODEL_FALLBACK : env.GROQ_MODEL_PRIMARY;
  const backupModel = isVoiceCall ? env.GROQ_MODEL_PRIMARY : env.GROQ_MODEL_FALLBACK;

  try {
    return await callGroq(primaryModel, messages, ctx);
  } catch (err) {
    logger.warn({ err }, 'Primary model failed, using fallback');
    fallbackTotal.inc({ component: 'llm' });
    return await callGroq(backupModel, messages, ctx);
  }
}

function buildSystemPrompt(ctx: LLMContext): string {
  const isVoiceCall = ctx.channel === 'ivr' || ctx.channel === 'voice' || ctx.channel === 'kiosk';
  const hasPassages = ctx.passages.length > 0;
  const passageLimit = isVoiceCall ? 250 : 700;
  const passagesText = hasPassages
    ? ctx.passages.map((p) => {
        const trimmed = p.text.length > passageLimit ? p.text.slice(0, passageLimit) + '...' : p.text;
        return `[${p.sourceDoc}, ${p.sectionRef}]:\n${trimmed}`;
      }).join('\n\n')
    : 'No database passages retrieved.';

  if (isVoiceCall) {
    const isFirstTurn = ctx.history.length === 0;
    const greetingInstruction = isFirstTurn
      ? "If the caller has only greeted you, greet them back warmly in your own words and ask how you can help. If they already asked something, skip the greeting and answer."
      : "Do NOT greet again (no 'नमस्ते', 'राम राम' etc.) — the call is already underway. Continue the conversation directly.";

    return `You are Sahakar Setu (सहकार सेतु मित्र) — a friendly male assistant on a LIVE phone call with a rural farmer or cooperative member in India.

HOW TO CONVERSE (MOST IMPORTANT):
1. Talk like a real person on a phone call, not like a FAQ document. React to the caller's exact words and situation. Phrase every reply freshly, in your own words — NEVER reuse a sentence you already spoke in this call, and never recite memorized template lines.
2. GREETING: ${greetingInstruction}
3. SPEECH STYLE: Everyday spoken Hindi (आम बोलचाल की खड़ी बोली), polite and warm ("जी", "चिंता मत कीजिए"). Avoid English jargon, legal-sounding textbook Hindi, and long compound sentences.
4. FOLLOW-UP QUESTIONS: If the caller's problem lacks a detail needed to help precisely (e.g. which crop, when the loss happened, which scheme, their village/district), ask ONE short natural follow-up question first instead of dumping full guidance. Give complete guidance once details are known.
5. EMPATHY: When someone shares a loss or trouble, acknowledge it briefly and sincerely in your OWN words, then move to practical help. Vary how you express sympathy every time — do not repeat a fixed condolence line.
6. FACTS: Scheme/legal facts (deadlines, premium rates, eligibility, documents) must come from the RETRIEVED PASSAGES below. If passages lack the needed fact, share only what you reliably know about Indian agriculture, cooperatives and government schemes, and offer to register a grievance for further help.
7. LENGTH: 2 to 4 short spoken sentences per turn. Complete your thought; do not read essays or lists aloud.
8. ABSOLUTE FORBIDDEN ON CALLS: no "नीचे देखें", no "वेबसाइट/लिंक/ऐप", no markdown, bullets, tables or headings — this is a phone call.
9. OUT-OF-DOMAIN (CRITICAL): If asked about completely unrelated topics (food recipes, cricket, movies, programming, weather, general trivia), respond ONLY with this exact verbatim text:
${BOUNDARY_MESSAGE}

CASE FACTS KNOWN SO FAR:
${ctx.caseFacts.map(f => `- ${f.key}: ${f.value}`).join('\n') || 'None'}

RETRIEVED PASSAGES:
${passagesText}`;
  }

  return `You are Sahakar Setu — an expert AI assistant for rural India: farmers, Primary Agricultural Credit Societies (PACS) members, cooperative societies and government schemes.

HOW TO ANSWER:
1. Respond in ${ctx.language}, in a natural spoken style (आम बोलचाल की खड़ी बोली for Hindi) suited to rural users.
2. Answer the user's ACTUAL question directly, based on their exact words and the conversation so far. Phrase every answer freshly in your own words — NEVER copy template sentences or repeat an earlier reply word-for-word.
3. EMPATHY: When someone reports a loss or problem (crop burnt, loan rejected, claim stuck), show brief empathy in your own words, then give practical next steps. Do not reuse a fixed sympathy phrase across answers.
4. CLARIFY: If a detail is missing, still give the general guidance first (with citations), then ask one short follow-up question at the end.
5. IN-DOMAIN SUBJECTS (always answer fully and helpfully): crop loss and PMFBY claims (report loss within 72 hours to the agriculture officer / insurance company / PACS secretary; offer grievance drafting), government schemes (PM-Kisan, PMFBY, KCC, Soil Health Card, etc. — benefits, eligibility, documents, process), PACS and cooperative societies (member rights, voting, loans, inputs, land records), financial literacy, and grievance redressal (how to complain, escalation to Registrar/Ombudsman, legal aid).
6. CITATIONS (MANDATORY): When RETRIEVED PASSAGES are provided below, you MUST ground your answer in them and end factual claims with citations like [Source: <doc name>, <section ref>]. If passages are empty or incomplete, use your reliable general knowledge about Indian agriculture, schemes and cooperative law — never refuse a valid in-domain question.
7. Never use text-layout phrases like "नीचे तालिका देखें" or "see the list below"; write naturally.
8. OUT-OF-DOMAIN ONLY (CRITICAL): For completely unrelated topics (recipes, sports, movies, entertainment, programming, general trivia), respond ONLY with this exact verbatim text, character-for-character in Roman script (do NOT alter, rephrase, translate, or change any punctuation):
${BOUNDARY_MESSAGE}

CASE FACTS:
${ctx.caseFacts.map(f => `- ${f.key}: ${f.value}`).join('\n') || 'None'}

RETRIEVED PASSAGES FROM DATABASE:
${passagesText}`;
}

function postProcessAnswer(answer: string, isVoiceCall: boolean = false): string {
  let cleaned = answer.trim();

  const preamblePatterns = [
    /^(Sure|Of course|Certainly|Let me|I'll help|Bilkul|Haan ji|Zaroor)[\s!,.]*:?\s*/i,
    /^(Here is|Here's|This is)[\s]+/i,
  ];
  for (const pattern of preamblePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  const signoffPatterns = [
    /[\s]*(Feel free|Do not hesitate)[\s]*$/i,
  ];
  for (const pattern of signoffPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  if (isVoiceCall) {
    cleaned = cleaned
      .replace(/\[Source:[^\]]+\]/gi, '')
      .replace(/[*#|`~]/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\s{2,}/g, ' ');

    const lastPunct = Math.max(
      cleaned.lastIndexOf('.'),
      cleaned.lastIndexOf('।'),
      cleaned.lastIndexOf('?'),
      cleaned.lastIndexOf('!')
    );
    if (lastPunct > 20 && lastPunct < cleaned.length - 1) {
      cleaned = cleaned.slice(0, lastPunct + 1);
    }
  }

  cleaned = cleaned.trim() || answer.trim();
  return isBoundaryLike(cleaned) ? BOUNDARY_MESSAGE : cleaned;
}

const DEVANAGARI_VARIANTS: Array<[string, string]> = [
  ['सिर्फ', 'sirf'], ['कानून', 'kanoon'], ['विषयों', 'vishayon'],
  ['जानकारी', 'jaankari'], ['सकता', 'sakta'], ['सकती', 'sakti'],
  ['पूछ', 'pooch'], ['हूँ', 'hoon'], ['हूं', 'hoon'], ['में', 'mein'],
];

function isBoundaryLike(text: string): boolean {
  const normalized = DEVANAGARI_VARIANTS.reduce(
    (t, [dv, roman]) => t.split(dv).join(roman),
    text.replace(/।/g, '.')
  );
  const boundaryWords = BOUNDARY_MESSAGE.toLowerCase()
    .replace(/।/g, '.')
    .split(/[\s,.]+/)
    .filter(Boolean);
  const textWords = normalized.toLowerCase().split(/[\s,.]+/).filter(Boolean);
  const hits = boundaryWords.filter(w => textWords.includes(w)).length;
  return hits / boundaryWords.length >= 0.85;
}

const DECLINE = 'Mere paas iska verified jawab nahi hai.';

async function callGroq(model: string, messages: any[], ctx: LLMContext): Promise<LLMResult> {
  const client = getGroqClient();
  const isVoiceCall = ctx.channel === 'ivr' || ctx.channel === 'voice' || ctx.channel === 'kiosk';
  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: isVoiceCall ? 0.7 : 0.3,
    max_tokens: isVoiceCall ? 350 : 600,
    stream: false,
  });

  let answer = response.choices[0].message.content || '';
  answer = postProcessAnswer(answer, isVoiceCall);
  let citations = extractCitations(answer);

  if (
    !isVoiceCall &&
    ctx.passages.length > 0 &&
    citations.length === 0 &&
    answer !== DECLINE &&
    answer !== BOUNDARY_MESSAGE
  ) {
    try {
      const retry = await client.chat.completions.create({
        model,
        messages: [
          ...messages,
          { role: 'assistant', content: answer },
          {
            role: 'user',
            content:
              'Your previous answer had no [Source: ...] citations. Answer again, grounding every factual claim in the RETRIEVED PASSAGES, and end the answer with the citation [Source: <doc name>, <section ref>].',
          },
        ],
        temperature: 0.2,
        max_tokens: 500,
        stream: false,
      });
      const retryAnswer = postProcessAnswer(retry.choices[0].message.content || '', false);
      const retryCitations = extractCitations(retryAnswer);
      if (retryCitations.length > 0) {
        answer = retryAnswer;
        citations = retryCitations;
        groundingRetriesTotal.inc();
      }
    } catch (err) {
      logger.warn({ err }, 'Grounding retry failed');
    }
  }

  return { answer, citations, model };
}
