import { one, pool, query, transaction } from '../lib/db.js';
import { conflict, forbidden } from '../lib/errors.js';
import { availableActions } from '../domain/stateMachine.js';
import type { Application, ApplicationStatus, RequestContext } from '../domain/types.js';
import { assertApplicant, getApplication } from './access.js';
import { audit } from './audit.js';
import { presentItem, loadChecklist } from './checklist.js';
import { guardFacts } from './transitions.js';

export const EDITABLE: ApplicationStatus[] = ['DOCUMENTS_PENDING', 'CORRECTION_REQUIRED'];

export async function createApplication(ctx: RequestContext, type: string, scenario: string) {
  assertApplicant(ctx);
  return transaction(async (tx) => {
    // Lock the user row so a double click cannot create two open applications.
    await query(tx, 'SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [ctx.user.id]);
    const open = await one(tx, `SELECT 1 FROM passport_applications WHERE applicant_id = $1 AND type = $2 AND status NOT IN ('CLOSED','SUBMITTED_SIMULATED')`, [ctx.user.id, type]);
    if (open) throw conflict('OPEN_APPLICATION_EXISTS', 'You already have an open application of this type.');

    const application = (await one<Application>(
      tx, 'INSERT INTO passport_applications (applicant_id, type, scenario, region) VALUES ($1,$2,$3,$4) RETURNING *',
      [ctx.user.id, type, scenario, ctx.user.region],
    ))!;
    await query(tx, `INSERT INTO application_documents (application_id, requirement_id)
      SELECT $1, id FROM document_requirements WHERE application_type = $2 AND scenario = $3`, [application.id, type, scenario]);
    await query(tx, `INSERT INTO status_events (application_id, previous_status, new_status, actor_id, actor_role, actor_name, reason)
      VALUES ($1,NULL,'DRAFT',$2,'APPLICANT',$3,'Application created')`, [application.id, ctx.user.id, ctx.user.displayName]);
    await audit({ actor: ctx.user, action: 'APPLICATION_CREATED', resourceType: 'application', resourceId: application.id, applicationId: application.id, correlationId: ctx.correlationId }, tx);
    return application;
  });
}

export function listOwnApplications(ctx: RequestContext) {
  assertApplicant(ctx);
  return query<Application>(pool, 'SELECT * FROM passport_applications WHERE applicant_id = $1 ORDER BY created_at DESC', [ctx.user.id]);
}

export function listQueue(ctx: RequestContext, status?: ApplicationStatus) {
  if (ctx.user.role !== 'OPERATOR') throw forbidden();
  return query(
    pool,
    `SELECT a.id, a.reference, a.type, a.scenario, a.status, a.version, a.updated_at, u.display_name AS applicant_name,
            count(d.id) FILTER (WHERE d.status = 'PENDING')::int AS pending_count,
            count(d.id) FILTER (WHERE d.status = 'VERIFIED')::int AS verified_count,
            count(d.id)::int AS item_count
       FROM passport_applications a
       JOIN users u ON u.id = a.applicant_id
       LEFT JOIN application_documents d ON d.application_id = a.id
      WHERE a.region = $1 AND a.sent_for_review_at IS NOT NULL AND a.status NOT IN ('DRAFT','DOCUMENTS_PENDING')
        AND ($2::application_status IS NULL OR a.status = $2)
      GROUP BY a.id, u.display_name ORDER BY a.sent_for_review_at`,
    [ctx.user.region, status ?? null],
  );
}

export async function applicationDetail(ctx: RequestContext, id: string) {
  const application = await getApplication(ctx, id);
  const facts = await guardFacts(pool, application);
  const checklist = await loadChecklist(pool, id);
  const editable = EDITABLE.includes(application.status);
  const profile = await one(pool, 'SELECT full_name, date_of_birth, city, state FROM applicant_profiles WHERE user_id = $1', [application.applicantId]);
  const consent = await one(pool, 'SELECT id, purpose, scopes, granted_at, withdrawn_at FROM consent_records WHERE application_id = $1 ORDER BY granted_at DESC LIMIT 1', [id]);
  const connection = await one(pool, 'SELECT status, updated_at FROM digilocker_connections WHERE application_id = $1', [id]);
  const timeline = await query(pool, 'SELECT id, previous_status, new_status, actor_role, actor_name, reason, created_at FROM status_events WHERE application_id = $1 ORDER BY id', [id]);

  if (ctx.user.role === 'OPERATOR') {
    await audit({ actor: ctx.user, action: 'DOCUMENT_METADATA_ACCESSED', resourceType: 'application', resourceId: id, applicationId: id, detail: 'package opened', correlationId: ctx.correlationId });
  }
  return {
    application, profile: profile ?? null, consent: consent ?? null, connection: connection ?? null, timeline,
    checklist: checklist.map((item) => presentItem(item, ctx.user.role, editable)),
    actions: availableActions(application.status, ctx.user.role, facts),
    editable,
  };
}

export async function auditTrail(ctx: RequestContext, id: string) {
  if (ctx.user.role !== 'OPERATOR') throw forbidden();
  await getApplication(ctx, id);
  const events = await query(
    pool,
    `SELECT e.id, e.actor_role, coalesce(u.display_name, 'System') AS actor_name, e.action, e.resource_type, e.resource_id,
            e.outcome, e.detail, e.correlation_id, e.created_at
       FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.application_id = $1 ORDER BY e.id DESC`,
    [id],
  );
  const history = await query(pool, 'SELECT * FROM status_events WHERE application_id = $1 ORDER BY id', [id]);
  return { events, history };
}
