import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { getDb } from '../../db/client.js';
import { generateTrackingId } from '../../services/tracking.js';
import { Fact } from '../../types/index.js';
import { logger } from '../../config/logger.js';

const TEMPLATE_DIR = path.join(process.cwd(), 'templates');

interface GrievanceData {
  caseId: string;
  category: string;
  facts: Fact[];
  language: string;
}

interface DraftResult {
  trackingId: string;
  addressee: string;
  subject: string;
  body: string;
}

const CATEGORY_ADDRESSEE: Record<string, string> = {
  society_pacs: 'PACS Secretary / PACS Prabandhak',
  cooperative_bank: 'Bank Nodal Grievance Officer',
  insurance_pmfby: 'Insurance Grievance Cell / Bima Lokpal',
  registrar_level: 'Registrar of Cooperative Societies',
  election: 'Registrar / Cooperative Election Authority',
  loan: 'Branch Manager, Sahakari Bank',
  subsidy: 'District Cooperative Officer',
  land: 'Tehsildar / Sub-Divisional Magistrate',
};

const CATEGORY_ADDRESSEE_EN: Record<string, string> = {
  society_pacs: 'Secretary, Primary Agricultural Credit Society',
  cooperative_bank: 'Nodal Grievance Officer, Cooperative Bank',
  insurance_pmfby: 'Insurance Grievance Cell / Insurance Ombudsman',
  registrar_level: 'Registrar of Cooperative Societies',
  election: 'Registrar / Cooperative Election Authority',
  loan: 'Branch Manager, Cooperative Bank',
  subsidy: 'District Cooperative Officer',
  land: 'Tehsildar / Sub-Divisional Magistrate',
};

export async function generateDraft(data: GrievanceData): Promise<DraftResult> {
  const db = getDb();
  const trackingId = await generateTrackingIdWithRetry(db);

  const factsMap: Record<string, string> = {};
  data.facts.forEach(f => { factsMap[f.factKey] = f.factValue; });

  const addresseeMap = data.language === 'en' ? CATEGORY_ADDRESSEE_EN : CATEGORY_ADDRESSEE;
  const addressee = addresseeMap[data.category] || (data.language === 'en' ? 'Sir/Madam' : 'Mahoday/Mahodaya');
  const subject = generateSubject(data.category, factsMap, data.language);

  let body = '';
  try {
    const templateFile = path.join(TEMPLATE_DIR, `grievance.${data.language}.hbs`);
    if (fs.existsSync(templateFile)) {
      const template = Handlebars.compile(fs.readFileSync(templateFile, 'utf-8'));
      body = template({
        addressee,
        member_name: factsMap.name || (data.language === 'en' ? '[Name]' : '[Naam]'),
        father_name: factsMap.father_name || '',
        village: factsMap.village || (data.language === 'en' ? '[Village]' : '[Gaon]'),
        district: factsMap.district || (data.language === 'en' ? '[District]' : '[Zila]'),
        state: factsMap.state || '',
        pacs_name: factsMap.pacs || (data.language === 'en' ? '[PACS Name]' : '[PACS ka naam]'),
        membership_no: factsMap.membership_no || '',
        subject,
        issue_description: factsMap.issue_description || '',
        application_date: factsMap.application_date || '',
        receipt_no: factsMap.receipt_no || '',
        amount: factsMap.amount || '',
        date: new Date().toLocaleDateString(data.language === 'en' ? 'en-IN' : 'hi-IN'),
        phone: factsMap.phone || '',
        tracking_id: trackingId,
        category: data.category,
      });
    } else {
      body = generateDefaultBody(addressee, factsMap, trackingId, data.language);
    }
  } catch (err) {
    body = generateDefaultBody(addressee, factsMap, trackingId, data.language);
  }

  const { data: draftRow, error } = await db.from('grievance_drafts').insert({
    case_id: data.caseId,
    tracking_id: trackingId,
    addressee,
    subject,
    body,
    language: data.language,
  }).select('id').single();

  if (error) {
    logger.error({ error }, 'Failed to save grievance draft');
    throw error;
  }

  const { error: trackingError } = await db.from('grievance_tracking').insert({
    draft_id: draftRow?.id,
    status: 'drafted',
    note: 'Draft created',
  });

  if (trackingError) {
    logger.error({ error: trackingError }, 'Failed to create tracking entry');
  }

  return { trackingId, addressee, subject, body };
}

export async function trackGrievance(trackingId: string) {
  const db = getDb();

  const { data: draft, error } = await db
    .from('grievance_drafts')
    .select('*')
    .eq('tracking_id', trackingId)
    .single();

  if (error || !draft) {
    return null;
  }

  const { data: tracking } = await db
    .from('grievance_tracking')
    .select('*')
    .eq('draft_id', draft.id)
    .order('updated_at', { ascending: false });

  return { draft, tracking: tracking || [] };
}

async function generateTrackingIdWithRetry(db: any, maxRetries = 3): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const trackingId = await generateTrackingId();
    const { data } = await db
      .from('grievance_drafts')
      .select('id')
      .eq('tracking_id', trackingId)
      .limit(1);
    if (!data || data.length === 0) {
      return trackingId;
    }
    logger.warn({ trackingId, attempt: i + 1 }, 'Tracking ID collision, retrying');
  }
  return await generateTrackingId();
}

function generateSubject(category: string, facts: Record<string, string>, lang: string): string {
  if (lang === 'en') {
    const subjects: Record<string, string> = {
      society_pacs: `Complaint against ${facts.pacs || 'PACS'}`,
      cooperative_bank: `Bank grievance: ${facts.issue || 'Loan related'}`,
      insurance_pmfby: `PMFBY claim: ${facts.crop || 'Crop'} damage`,
      registrar_level: `Complaint to Registrar: ${facts.issue || 'Issue'}`,
      election: `Election complaint: ${facts.issue || 'Election related'}`,
      loan: `Loan grievance: ${facts.issue || 'Loan issue'}`,
      subsidy: `Subsidy complaint: ${facts.issue || 'Subsidy issue'}`,
      land: `Land record issue: ${facts.issue || 'Land dispute'}`,
    };
    return subjects[category] || `Complaint: ${facts.issue || 'General'}`;
  }

  const subjects: Record<string, string> = {
    society_pacs: `Shikayat: ${facts.pacs || 'PACS'} ke khilaf`,
    cooperative_bank: `Bank grievance: ${facts.issue || 'Loan related'}`,
    insurance_pmfby: `PMFBY shikayat: ${facts.crop || 'Fasal'} ka nuksan`,
    registrar_level: `Registrar ko shikayat: ${facts.issue || 'Samasya'}`,
    election: `Chunav shikayat: ${facts.issue || 'Election related'}`,
    loan: `Loan shikayat: ${facts.issue || 'Loan samasya'}`,
    subsidy: `Subsidy shikayat: ${facts.issue || 'Subsidy samasya'}`,
    land: `Bhulekh shikayat: ${facts.issue || 'Bhulekh samasya'}`,
  };
  return subjects[category] || `Shikayat: ${facts.issue || 'General'}`;
}

function generateDefaultBody(addressee: string, facts: Record<string, string>, trackingId: string, lang: string): string {
  if (lang === 'en') {
    return `To,
${addressee}

Subject: Grievance Complaint

Dear Sir/Madam,

I, ${facts.name || '[Name]'}, member of Village ${facts.village || '[Village]'}, am writing to bring to your attention the following grievance:

${facts.issue_description || 'Please provide details of your grievance.'}

${facts.amount ? `Amount involved: Rs. ${facts.amount}` : ''}
${facts.application_date ? `Date of application: ${facts.application_date}` : ''}
${facts.receipt_no ? `Receipt number: ${facts.receipt_no}` : ''}

I request you to kindly resolve this matter within 15 days.

Yours sincerely,
${facts.name || '[Name]'}
Date: ${new Date().toLocaleDateString('en-IN')}
Tracking ID: ${trackingId}`;
  }

  return `सेवा में,
${addressee}

विषय: शिकायत

महोदय/महोदया,

मैं, ${facts.name || '[नाम]'}, ग्राम ${facts.village || '[गांव]'} का सदस्य हूँ।

${facts.issue_description || 'मेरी शिकायत दर्ज करने के लिए कृपया विवरण दें।'}

${facts.amount ? `राशि: ₹${facts.amount}` : ''}
${facts.application_date ? `आवेदन तिथि: ${facts.application_date}` : ''}
${facts.receipt_no ? `रसीद संख्या: ${facts.receipt_no}` : ''}

कृपया उपरोक्त मामले का निस्तारण 15 दिनों के भीतर करने की कृपा करें।

सादर,
${facts.name || '[नाम]'}
दिनांक: ${new Date().toLocaleDateString('hi-IN')}
ट्रैकिंग आईडी: ${trackingId}`;
}
