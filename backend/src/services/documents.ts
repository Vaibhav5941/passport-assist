// Upload fallback, operator review and the applicant's document views.
import { one, pool, query } from '../lib/db.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { checkRules } from '../domain/rules.js';
import type { ChecklistItem, RequestContext } from '../domain/types.js';
import { assertApplicant, getApplication, withApplication } from './access.js';
import { audit } from './audit.js';
import { CHECKLIST_SQL, loadChecklist, presentItem } from './checklist.js';
import { notifyRuleFailure } from './digilocker.js';
import { notifier } from './notifications.js';
import { EDITABLE } from './applications.js';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const SIGNATURES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

/** Checks size, declared type and leading bytes. This is not a malware scan. */
export function validateFile(mimeType: string, bytes: Buffer) {
  const signature = SIGNATURES[mimeType];
  if (!signature) throw new AppError(415, 'UNSUPPORTED_TYPE', 'Upload a PDF, PNG or JPEG file.');
  if (!bytes.length) throw new AppError(400, 'EMPTY_FILE', 'The file is empty.');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file must be 2 MB or smaller.');
  if (!signature.every((byte, i) => bytes[i] === byte)) throw new AppError(415, 'CONTENT_MISMATCH', 'The file content does not match its type.');
}

/** The bytes are validated in memory and then discarded. Only metadata is saved. */
export async function uploadDocument(ctx: RequestContext, applicationId: string, itemId: string, mimeType: string, bytes: Buffer, issuedOn: string | null) {
  assertApplicant(ctx);
  return withApplication(ctx, applicationId, async (tx, application) => {
    const item = (await loadChecklist(tx, applicationId)).find((i) => i.id === itemId);
    if (!item) throw notFound();
    if (!EDITABLE.includes(application.status)) throw conflict('NOT_EDITABLE', 'Documents cannot be changed at this stage.');
    if (item.status === 'VERIFIED') throw conflict('ALREADY_VERIFIED', 'This document is already verified.');
    validateFile(mimeType, bytes);

    // The holder name cannot be read from an upload, so the operator checks it.
    const failures = checkRules(item.rules, { issuedOn }, '');
    const status = failures.length ? 'REJECTED' : 'PENDING';
    const reason = failures.length ? failures.join(' ') : null;
    await query(tx, `UPDATE application_documents SET status = $1, source = 'UPLOAD', provider_doc_ref = NULL, consent_id = NULL,
        issuer = NULL, masked_identifier = NULL, issued_on = $2, valid_until = NULL, mime_type = $3, size_bytes = $4,
        rejection_reason = $5, access_revoked_at = NULL, updated_at = now() WHERE id = $6`,
      [status, issuedOn, mimeType, bytes.length, reason, itemId]);
    const base = { actor: ctx.user, resourceType: 'document' as const, resourceId: itemId, applicationId, correlationId: ctx.correlationId };
    await audit({ ...base, action: 'DOCUMENT_UPLOADED' }, tx);
    if (reason) {
      await audit({ ...base, action: 'DOCUMENT_RULE_FAILED', outcome: 'FAILURE' }, tx);
      await notifyRuleFailure(tx, application, item.name, reason);
    }
    return { status, reason };
  });
}

export async function reviewDocument(ctx: RequestContext, applicationId: string, itemId: string, decision: 'ACCEPT' | 'REJECT', reason: string | undefined, seenUpdatedAt: string) {
  if (ctx.user.role !== 'OPERATOR') throw forbidden();
  return withApplication(ctx, applicationId, async (tx, application) => {
    const item = (await loadChecklist(tx, applicationId)).find((i) => i.id === itemId);
    if (!item) throw notFound();
    if (application.status !== 'UNDER_REVIEW') throw conflict('NOT_UNDER_REVIEW', 'Start the review before deciding on documents.');
    if (item.status === 'MISSING') throw conflict('NOTHING_TO_REVIEW', 'There is no document to review.');
    if (item.updatedAt.toISOString() !== seenUpdatedAt) throw conflict('STALE_VERSION', 'This document changed. Refresh and review it again.');
    // A rejected document (by a rule or an operator) must be replaced before it can be verified.
    if (decision === 'ACCEPT' && item.status !== 'PENDING') throw conflict('NOT_PENDING', 'Only a pending document can be accepted.');
    const note = reason?.trim();
    if (decision === 'REJECT' && !note) throw new AppError(400, 'REASON_REQUIRED', 'Give a reason when rejecting a document.');

    const status = decision === 'ACCEPT' ? 'VERIFIED' : 'REJECTED';
    await query(tx, 'UPDATE application_documents SET status = $1, rejection_reason = $2, updated_at = now() WHERE id = $3',
      [status, decision === 'REJECT' ? note : null, itemId]);
    await query(tx, 'INSERT INTO application_reviews (application_id, document_id, operator_id, decision, reason) VALUES ($1,$2,$3,$4,$5)',
      [applicationId, itemId, ctx.user.id, decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', decision === 'REJECT' ? note : null]);
    await audit({ actor: ctx.user, action: decision === 'ACCEPT' ? 'CHECKLIST_ACCEPTED' : 'CHECKLIST_REJECTED', resourceType: 'document', resourceId: itemId, applicationId, correlationId: ctx.correlationId }, tx);
    if (decision === 'REJECT') {
      await notifier.send(tx, { userId: application.applicantId, applicationId, title: `Action required: ${item.name} rejected`,
        message: `Reason: ${note}`, link: `/applications/${applicationId}/checklist` });
    }
    return { status };
  });
}

export function myDocuments(ctx: RequestContext) {
  assertApplicant(ctx);
  return query(pool, `SELECT d.id, d.application_id, a.reference, r.name, d.status, d.source, d.masked_identifier, d.updated_at, d.access_revoked_at
      FROM application_documents d
      JOIN passport_applications a ON a.id = d.application_id
      JOIN document_requirements r ON r.id = d.requirement_id
     WHERE a.applicant_id = $1 AND (d.source IS NOT NULL OR d.access_revoked_at IS NOT NULL)
     ORDER BY d.updated_at DESC`, [ctx.user.id]);
}

export async function documentDetail(ctx: RequestContext, documentId: string) {
  const row = /^[0-9a-f-]{36}$/i.test(documentId)
    ? await one<ChecklistItem>(pool, `${CHECKLIST_SQL} WHERE d.id = $1`, [documentId])
    : undefined;
  if (!row) throw notFound();
  // Ownership or operator scope is checked on the parent application.
  const application = await getApplication(ctx, row.applicationId);
  if (row.accessRevokedAt) throw new AppError(403, 'CONSENT_WITHDRAWN', 'Consent was withdrawn. This DigiLocker document is no longer accessible.');
  await audit({ actor: ctx.user, action: 'DOCUMENT_METADATA_ACCESSED', resourceType: 'document', resourceId: row.id, applicationId: application.id, correlationId: ctx.correlationId });
  return presentItem(row, ctx.user.role, EDITABLE.includes(application.status));
}
