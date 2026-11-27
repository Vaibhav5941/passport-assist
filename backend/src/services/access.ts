// Authorisation. Every application and document lookup goes through this file.
// "Not yours" and "does not exist" both return 404, so ids cannot be probed.
import type pg from 'pg';
import { one, pool, transaction, type Db } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import type { Application, RequestContext } from '../domain/types.js';
import { audit } from './audit.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The scope is part of the SQL, so out-of-scope rows are never loaded. */
function findInScope(db: Db, ctx: RequestContext, id: string, lock: boolean) {
  const suffix = lock ? ' FOR UPDATE' : '';
  if (ctx.user.role === 'APPLICANT') {
    return one<Application>(db, `SELECT * FROM passport_applications WHERE id = $1 AND applicant_id = $2${suffix}`, [id, ctx.user.id]);
  }
  return one<Application>(
    db,
    `SELECT * FROM passport_applications
      WHERE id = $1 AND region = $2 AND sent_for_review_at IS NOT NULL
        AND status NOT IN ('DRAFT','DOCUMENTS_PENDING')${suffix}`,
    [id, ctx.user.region],
  );
}

async function deny(ctx: RequestContext, id: string): Promise<never> {
  // Written outside any transaction so the record survives a rollback.
  await audit({
    actor: ctx.user, action: 'ACCESS_DENIED', resourceType: 'application', resourceId: UUID.test(id) ? id : 'malformed-id',
    outcome: 'DENIED', correlationId: ctx.correlationId,
  });
  throw notFound();
}

export async function getApplication(ctx: RequestContext, id: string): Promise<Application> {
  const found = UUID.test(id) ? await findInScope(pool, ctx, id, false) : undefined;
  return found ?? deny(ctx, id);
}

/**
 * Runs a write while holding a row lock on the application. This serialises
 * competing writes, such as consent withdrawal racing a document link.
 */
export async function withApplication<T>(
  ctx: RequestContext, id: string, work: (tx: pg.PoolClient, application: Application) => Promise<T>,
): Promise<T> {
  await getApplication(ctx, id);
  return transaction(async (tx) => {
    const locked = await findInScope(tx, ctx, id, true);
    if (!locked) throw notFound();
    return work(tx, locked);
  });
}

export function assertApplicant(ctx: RequestContext) {
  if (ctx.user.role !== 'APPLICANT') throw forbidden();
}
