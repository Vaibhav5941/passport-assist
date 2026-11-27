// Audit logging. The shape has no free-form payload, so document contents,
// tokens or identity values cannot be attached by accident.
import { pool, query, type Db } from '../lib/db.js';
import type { ActorRole } from '../domain/types.js';

export type AuditAction =
  | 'AUTH_SIGNED_IN' | 'AUTH_SIGN_IN_FAILED' | 'ACCESS_DENIED'
  | 'CONSENT_GRANTED' | 'CONSENT_WITHDRAWN'
  | 'DIGILOCKER_CONNECT_STARTED' | 'DIGILOCKER_CONNECTED' | 'DIGILOCKER_CALLBACK_DUPLICATE'
  | 'DIGILOCKER_CALLBACK_REJECTED' | 'PROVIDER_UNAVAILABLE'
  | 'DOCUMENTS_DISCOVERED' | 'DOCUMENT_LINKED' | 'DOCUMENT_UPLOADED' | 'DOCUMENT_METADATA_ACCESSED'
  | 'DOCUMENT_RULE_FAILED' | 'CHECKLIST_ACCEPTED' | 'CHECKLIST_REJECTED'
  | 'APPLICATION_CREATED' | 'STATUS_CHANGED' | 'TRANSITION_REJECTED' | 'CORRECTION_REQUESTED' | 'REVIEW_STARTED';

export interface AuditEntry {
  actor: { id: string | null; role: ActorRole };
  action: AuditAction;
  resourceType: 'user' | 'application' | 'document' | 'consent' | 'connection';
  resourceId: string;
  applicationId?: string | null;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  /** Short machine-written note such as a status pair or error code. Never user input. */
  detail?: string;
  correlationId: string;
}

export async function audit(entry: AuditEntry, db: Db = pool) {
  await query(
    db,
    `INSERT INTO audit_events (actor_id, actor_role, action, resource_type, resource_id, application_id, outcome, detail, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [entry.actor.id, entry.actor.role, entry.action, entry.resourceType, entry.resourceId,
      entry.applicationId ?? null, entry.outcome ?? 'SUCCESS', entry.detail ?? null, entry.correlationId],
  );
}
