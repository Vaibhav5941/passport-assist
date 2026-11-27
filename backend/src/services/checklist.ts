import { query, type Db } from '../lib/db.js';
import type { ChecklistItem } from '../domain/types.js';

export const CHECKLIST_SQL = `
  SELECT d.*, r.code, r.name, r.description, r.required, r.rules
    FROM application_documents d JOIN document_requirements r ON r.id = d.requirement_id`;

export const loadChecklist = (db: Db, applicationId: string) =>
  query<ChecklistItem>(db, `${CHECKLIST_SQL} WHERE d.application_id = $1 ORDER BY r.sort_order`, [applicationId]);

/** What the viewer sees. Provider references and consent ids stay on the server. */
export function presentItem(item: ChecklistItem, role: 'APPLICANT' | 'OPERATOR', editable: boolean) {
  const { providerDocRef: _ref, consentId: _consent, rules: _rules, ...safe } = item;
  let nextAction: string;
  if (role === 'OPERATOR') nextAction = item.status === 'PENDING' ? 'Review this document' : 'No action';
  else if (item.status === 'VERIFIED') nextAction = 'No action needed';
  else if (!editable) nextAction = 'Waiting for review';
  else if (item.status === 'REJECTED') nextAction = 'Replace this document';
  else if (item.status === 'MISSING') nextAction = item.accessRevokedAt ? 'Upload, or grant consent again' : 'Link from DigiLocker or upload';
  else nextAction = 'Nothing yet. You can replace it before sending';
  return { ...safe, requiresIssueDate: !!item.rules.maxAgeMonths, nextAction, canProvide: role === 'APPLICANT' && editable && item.status !== 'VERIFIED' };
}
