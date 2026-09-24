import { getDb } from '../../db/client.js';
import { EscalationStep, CaseData } from '../../types/index.js';
import { ESCALATION_STEPS } from '../../config/constants.js';
import { logger } from '../../config/logger.js';

export async function getEscalationPath(caseId: string): Promise<EscalationStep[]> {
  const db = getDb();

  const { data: caseData, error } = await db
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .single();

  if (error || !caseData) {
    logger.error({ error }, 'Failed to get case for escalation');
    return [];
  }

  const steps: EscalationStep[] = [];
  const daysSinceSubmission = Math.floor(
    (Date.now() - new Date(caseData.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  steps.push({
    step: 1,
    authority: ESCALATION_STEPS[0].authority,
    deadline: `${ESCALATION_STEPS[0].deadlineDays} days from submission`,
    status: caseData.status === 'open' ? 'current' : 'completed',
    draftTemplate: 'society_grievance',
  });

  if (daysSinceSubmission > 15) {
    steps.push({
      step: 2,
      authority: ESCALATION_STEPS[1].authority,
      deadline: `${ESCALATION_STEPS[1].deadlineDays} days`,
      status: 'current',
      draftTemplate: 'registrar_grievance',
    });
  }

  if (caseData.category === 'pmfby' && daysSinceSubmission > 30) {
    steps.push({
      step: 3,
      authority: ESCALATION_STEPS[2].authority,
      deadline: 'As per Ombudsman rules',
      status: 'current',
      draftTemplate: 'ombudsman_complaint',
    });
  }

  if (caseData.status === 'escalated' && daysSinceSubmission > 60) {
    steps.push({
      step: 4,
      authority: ESCALATION_STEPS[3].authority,
      deadline: 'As per NALSA guidelines',
      status: 'current',
      draftTemplate: 'legal_aid_application',
    });
  }

  return steps;
}
