// Applies state machine decisions. Every status change in the system goes through here.
import type pg from 'pg';
import { one, query } from '../lib/db.js';
import { AppError, conflict } from '../lib/errors.js';
import { evaluateTransition, type GuardFacts } from '../domain/stateMachine.js';
import type { ActorRole, Application, ApplicationStatus, RequestContext } from '../domain/types.js';
import { audit } from './audit.js';
import { loadChecklist } from './checklist.js';
import { withApplication } from './access.js';
import { notifier } from './notifications.js';

export async function guardFacts(tx: pg.Pool | pg.PoolClient, application: Application): Promise<GuardFacts> {
  const profile = await one(tx, 'SELECT 1 FROM applicant_profiles WHERE user_id = $1', [application.applicantId]);
  return { profileComplete: !!profile, items: await loadChecklist(tx, application.id) };
}

/** Records a validated change: status, timeline event, audit and notification, atomically. */
export async function recordTransition(
  tx: pg.PoolClient, application: Application, to: ApplicationStatus,
  actor: { id: string | null; role: ActorRole; name: string }, reason: string, correlationId: string,
) {
  const updated = await one<Application>(
    tx,
    `UPDATE passport_applications
        SET status = $1, version = version + 1, updated_at = now(),
            sent_for_review_at = CASE WHEN $1::application_status = 'READY_FOR_REVIEW'
                                      THEN coalesce(sent_for_review_at, now()) ELSE sent_for_review_at END
      WHERE id = $2 AND version = $3 RETURNING *`,
    [to, application.id, application.version],
  );
  if (!updated) throw conflict('STALE_VERSION', 'This application changed. Refresh and try again.');

  await query(
    tx,
    `INSERT INTO status_events (application_id, previous_status, new_status, actor_id, actor_role, actor_name, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [application.id, application.status, to, actor.id, actor.role, actor.name, reason],
  );
  await audit({
    actor, action: to === 'CORRECTION_REQUIRED' ? 'CORRECTION_REQUESTED' : 'STATUS_CHANGED', resourceType: 'application',
    resourceId: application.id, applicationId: application.id, detail: `${application.status} -> ${to}`, correlationId,
  }, tx);

  const notices: Partial<Record<ApplicationStatus, { title: string; message: string; link: string }>> = {
    CORRECTION_REQUIRED: { title: 'Action required: corrections', message: `Corrections were requested for ${application.reference}. Review the checklist and replace rejected documents.`, link: 'checklist' },
    DOCUMENTS_PENDING: { title: 'Action required: documents', message: `${application.reference} needs documents. Open the checklist to see what is missing.`, link: 'checklist' },
    SUBMITTED_SIMULATED: { title: 'Simulated submission recorded', message: 'Simulated submission. No real application has been filed.', link: 'tracking' },
  };
  const notice = notices[to];
  if (notice) {
    await notifier.send(tx, {
      userId: application.applicantId, applicationId: application.id,
      title: notice.title, message: notice.message, link: `/applications/${application.id}/${notice.link}`,
    });
  }
  return updated;
}

export interface TransitionRequest { to: ApplicationStatus; reason?: string; expectedVersion: number }

export async function requestTransition(ctx: RequestContext, applicationId: string, request: TransitionRequest) {
  try {
    return await withApplication(ctx, applicationId, async (tx, application) => {
      if (application.version !== request.expectedVersion) {
        throw conflict('STALE_VERSION', 'This application changed. Refresh and try again.');
      }
      const decision = evaluateTransition(application.status, request.to, ctx.user.role, request.reason, await guardFacts(tx, application));
      if (!decision.allowed) {
        const status = decision.code === 'ROLE_NOT_PERMITTED' ? 403 : decision.code === 'REASON_REQUIRED' ? 400 : 409;
        throw new AppError(status, decision.code, decision.message);
      }
      if (request.to === 'CORRECTION_REQUIRED') {
        await query(tx, `INSERT INTO application_reviews (application_id, operator_id, decision, reason) VALUES ($1,$2,'CORRECTION_REQUESTED',$3)`,
          [application.id, ctx.user.id, request.reason!.trim()]);
      }
      return recordTransition(tx, application, request.to,
        { id: ctx.user.id, role: ctx.user.role, name: ctx.user.displayName },
        request.reason?.trim() || decision.transition.label, ctx.correlationId);
    });
  } catch (error) {
    // The transaction has rolled back; record the rejected attempt separately.
    if (error instanceof AppError && error.code !== 'NOT_FOUND') {
      await audit({
        actor: ctx.user, action: 'TRANSITION_REJECTED', resourceType: 'application', resourceId: applicationId,
        applicationId, outcome: 'DENIED', detail: `to ${request.to}: ${error.code}`, correlationId: ctx.correlationId,
      });
    }
    throw error;
  }
}
