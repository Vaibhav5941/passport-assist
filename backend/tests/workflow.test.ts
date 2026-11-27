// API integration tests against a real PostgreSQL database, including the seven engineering scenarios.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/lib/db.js';
import { mockProvider } from '../src/integrations/digilocker/index.js';
import {
  app, connect, countRows, detail, EMAIL, GOOD_DOCS, PDF, resetDatabase, SCOPES, signIn,
  startedApplication, today, transition, type Client,
} from './helpers.js';

let asha: Client, bilal: Client, operator: Client, southOperator: Client, appId: string;

beforeEach(async () => {
  mockProvider.setOutage('*', false);
  await resetDatabase();
  [asha, bilal, operator, southOperator] = await Promise.all([signIn(EMAIL.asha), signIn(EMAIL.bilal), signIn(EMAIL.north), signIn(EMAIL.south)]);
  mockProvider.setOutage(asha.user.id, false);
  appId = await startedApplication(asha);
});
afterAll(() => pool.end());

const link = (docRefs: string[]) => asha.post(`/applications/${appId}/digilocker/link`, { docRefs });
const withdraw = () => asha.post(`/applications/${appId}/consent/withdraw`);
const itemByCode = async (code: string, client = asha) => (await detail(client, appId)).checklist.find((i: any) => i.code === code);
const audits = (action: string) => countRows('audit_events WHERE action = $1', [action]);

async function toUnderReview() {
  await connect(asha, appId);
  await link(GOOD_DOCS).expect(200);
  expect((await transition(asha, appId, 'READY_FOR_REVIEW')).status).toBe(200);
  expect((await transition(operator, appId, 'UNDER_REVIEW')).status).toBe(200);
}
async function review(code: string, decision: 'ACCEPT' | 'REJECT', reason?: string) {
  const item = await itemByCode(code, operator);
  return operator.post(`/operator/applications/${appId}/documents/${item.id}/review`, { decision, reason, seenUpdatedAt: item.updatedAt });
}

describe('authentication and request safety', () => {
  it('requires a session and uses an HttpOnly, SameSite=Strict cookie', async () => {
    await request(app).get('/api/applications').expect(401);
    expect(asha.cookie[0]).toMatch(/HttpOnly/);
    expect(asha.cookie[0]).toMatch(/SameSite=Strict/);
  });
  it('rejects writes without the CSRF header or from another origin', async () => {
    await request(app).post('/api/applications').set('Cookie', asha.cookie).send({}).expect(403);
    await asha.post('/applications', {}).set('origin', 'https://evil.example').expect(403);
  });
  it('ends the session on sign out', async () => {
    await asha.post('/auth/logout').expect(204);
    await asha.get('/auth/me').expect(401);
  });
  it('throttles repeated bad passwords', async () => {
    const attempt = () => request(app).post('/api/auth/login').set('x-requested-with', 'passport-assist').send({ email: 'x@example.test', password: 'bad' });
    for (let i = 0; i < 5; i++) await attempt().expect(401);
    await attempt().expect(429);
  });
  it('validates writes and returns safe errors with a correlation id', async () => {
    const res = await asha.put('/profile', { fullName: 'A', extra: true }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBeTruthy();
  });
});

describe('consent', () => {
  it('must be explicit, and records time, scopes and an audit event', async () => {
    await asha.post(`/applications/${appId}/consent`, { accepted: false, scopes: SCOPES }).expect(400);
    await asha.post(`/applications/${appId}/digilocker/connect`).expect(409);
    await asha.post(`/applications/${appId}/consent`, { accepted: true, scopes: SCOPES }).expect(201);
    const { consent } = await detail(asha, appId);
    expect(consent.grantedAt).toBeTruthy();
    expect(consent.scopes).toHaveLength(3);
    expect(await audits('CONSENT_GRANTED')).toBe(1);
  });
  it('limits discovery and linking to consented scopes', async () => {
    await connect(asha, appId, ['IDENTITY_PROOF']);
    const found = (await asha.get(`/applications/${appId}/digilocker/documents`)).body.documents;
    expect(found.map((d: any) => d.code)).toEqual(['IDENTITY_PROOF']);
    await link(['mock-birth']).expect(400);
  });
});

describe('scenario 1: withdrawal after linking documents', () => {
  it('removes access, reflects withdrawal and keeps upload available', async () => {
    await connect(asha, appId);
    await link(GOOD_DOCS).expect(200);
    const item = await itemByCode('IDENTITY_PROOF');
    await asha.get(`/documents/${item.id}`).expect(200);
    await transition(asha, appId, 'READY_FOR_REVIEW');

    const res = await withdraw().expect(200);
    expect(res.body).toEqual({ withdrawn: true, removedDocuments: 3 });

    const after = await detail(asha, appId);
    expect(after.consent.withdrawnAt).toBeTruthy();
    expect(after.application.status).toBe('DOCUMENTS_PENDING');
    for (const i of after.checklist) {
      expect(i).toMatchObject({ status: 'MISSING', source: null, maskedIdentifier: null, issuer: null });
      expect(i.accessRevokedAt).toBeTruthy();
    }
    const denied = await asha.get(`/documents/${item.id}`).expect(403);
    expect(denied.body.error.code).toBe('CONSENT_WITHDRAWN');
    await asha.get(`/applications/${appId}/digilocker/documents`).expect(403);
    await link(['mock-identity']).expect(403);
    await operator.get(`/applications/${appId}`).expect(404);
    expect(await countRows('application_documents WHERE provider_doc_ref IS NOT NULL')).toBe(0);
    expect(await audits('CONSENT_WITHDRAWN')).toBe(1);
    expect(await countRows(`notifications WHERE title = 'Action required: documents' AND message LIKE '%needs documents%'`)).toBeGreaterThan(0);

    await asha.upload(`/applications/${appId}/documents/${item.id}/upload`, PDF).expect(200);
    expect(await itemByCode('IDENTITY_PROOF')).toMatchObject({ status: 'PENDING', source: 'UPLOAD' });
  });
  it('works while the provider is down, and is idempotent', async () => {
    await connect(asha, appId);
    mockProvider.setOutage(asha.user.id, true);
    await withdraw().expect(200);
    expect((await withdraw()).body.withdrawn).toBe(false);
    expect(await audits('CONSENT_WITHDRAWN')).toBe(1);
  });
  it('does not let an old callback reconnect', async () => {
    const callback = await connect(asha, appId);
    await withdraw();
    await asha.post('/digilocker/callback', callback).expect(409);
    expect(await countRows(`digilocker_connections WHERE status = 'CONNECTED'`)).toBe(0);
  });
});

describe('scenario 2: duplicate callback', () => {
  it('is idempotent for sequential and parallel redelivery', async () => {
    const callback = await connect(asha, appId);
    await link(GOOD_DOCS);
    await link(GOOD_DOCS).expect(200);
    const repeats = await Promise.all([1, 2, 3].map(() => asha.post('/digilocker/callback', callback)));
    for (const r of repeats) expect(r.body).toMatchObject({ status: 'CONNECTED', duplicate: true });
    expect(await countRows('digilocker_connections')).toBe(1);
    expect(await countRows('application_documents WHERE application_id = $1', [appId])).toBe(3);
    expect(await audits('DIGILOCKER_CONNECTED')).toBe(1);
    expect(await audits('DOCUMENT_LINKED')).toBe(3);
  });
  it('handles two first-time deliveries arriving together', async () => {
    await asha.post(`/applications/${appId}/consent`, { accepted: true, scopes: SCOPES });
    const started = await asha.post(`/applications/${appId}/digilocker/connect`);
    const state = new URL(started.body.authorizationUrl, 'http://x').searchParams.get('state')!;
    const callback = (await asha.post('/mock-provider/authorize', { state })).body;
    const results = await Promise.all([asha.post('/digilocker/callback', callback), asha.post('/digilocker/callback', callback)]);
    expect(results.map((r) => r.body.duplicate).sort()).toEqual([false, true]);
    expect(await audits('DIGILOCKER_CONNECTED')).toBe(1);
  });
  it('rejects replay with a different code, bad signatures, tampered state and another user', async () => {
    const callback = await connect(asha, appId);
    const second = (await asha.post('/mock-provider/authorize', { state: callback.state })).body;
    expect((await asha.post('/digilocker/callback', second)).body.error.code).toBe('STATE_REPLAYED');
    expect((await asha.post('/digilocker/callback', { ...callback, state: `${callback.state}x` })).body.error.code).toBe('STATE_INVALID');
    await bilal.post('/digilocker/callback', callback).expect(404);
    await withdraw();
    await asha.post(`/applications/${appId}/consent`, { accepted: true, scopes: SCOPES });
    await asha.post(`/applications/${appId}/digilocker/connect`).expect(200);
    expect((await asha.post('/digilocker/callback', callback)).body.error.code).toBe('STATE_INVALID');
    expect(await audits('DIGILOCKER_CALLBACK_REJECTED')).toBeGreaterThanOrEqual(2);
  });
  it('rejects a forged provider signature', async () => {
    await asha.post(`/applications/${appId}/consent`, { accepted: true, scopes: SCOPES });
    const started = await asha.post(`/applications/${appId}/digilocker/connect`);
    const state = new URL(started.body.authorizationUrl, 'http://x').searchParams.get('state')!;
    const callback = (await asha.post('/mock-provider/authorize', { state })).body;
    const forged = await asha.post('/digilocker/callback', { ...callback, signature: 'forged' }).expect(400);
    expect(forged.body.error.code).toBe('PROVIDER_REJECTED');
    expect(await countRows(`digilocker_connections WHERE status = 'CONNECTED'`)).toBe(0);
  });
});

describe('scenario 3: document fails checklist rules', () => {
  it('is rejected with a reason, never verified, and notifies the applicant', async () => {
    await connect(asha, appId);
    const res = await link(['mock-address-old']).expect(200);
    expect(res.body.results[0].status).toBe('REJECTED');
    const item = await itemByCode('ADDRESS_PROOF');
    expect(item.rejectionReason).toContain('last 3 months');
    expect(item.nextAction).toBe('Replace this document');
    expect(await countRows(`notifications WHERE message LIKE '%last 3 months%'`)).toBe(1);
    expect((await transition(asha, appId, 'READY_FOR_REVIEW')).status).toBe(409);
  });
  it('cannot be accepted by an operator while it is rejected', async () => {
    await toUnderReview();
    await review('ADDRESS_PROOF', 'REJECT', 'Unreadable').then((r) => expect(r.status).toBe(200));
    const res = await review('ADDRESS_PROOF', 'ACCEPT');
    expect(res.body.error.code).toBe('NOT_PENDING');
    expect((await itemByCode('ADDRESS_PROOF', operator)).status).toBe('REJECTED');
  });
  it('applies rules to uploads too', async () => {
    const item = await itemByCode('ADDRESS_PROOF');
    const res = await asha.upload(`/applications/${appId}/documents/${item.id}/upload`, PDF, 'application/pdf', '2020-01-01').expect(200);
    expect(res.body.status).toBe('REJECTED');
  });
  it('the database refuses a rejected item without a reason', async () => {
    await expect(pool.query(`UPDATE application_documents SET status = 'REJECTED', rejection_reason = '  '`)).rejects.toThrow(/rejected_requires_reason/);
  });
});

describe('upload fallback', () => {
  it('checks type, content and size, and stores no contents or file name', async () => {
    const item = await itemByCode('IDENTITY_PROOF');
    const url = `/applications/${appId}/documents/${item.id}/upload`;
    await asha.upload(url, Buffer.from('plain'), 'text/plain').expect(415);
    await asha.upload(url, Buffer.from('not a pdf')).expect(415);
    await asha.upload(url, Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)])).expect(413);
    await asha.upload(url, PDF).expect(200);
    const columns = await pool.query(`SELECT data_type, column_name FROM information_schema.columns WHERE table_name = 'application_documents'`);
    expect(columns.rows.some((c) => c.data_type === 'bytea' || /content|file_name/.test(c.column_name))).toBe(false);
    expect(await audits('DOCUMENT_UPLOADED')).toBe(1);
  });
});

describe('operator review', () => {
  it('requires a reason to reject, then runs correction and resubmission to simulated submission', async () => {
    await toUnderReview();
    const noReason = await review('IDENTITY_PROOF', 'REJECT', '  ');
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    await review('IDENTITY_PROOF', 'REJECT', 'Photo is unclear').then((r) => expect(r.status).toBe(200));
    expect((await transition(operator, appId, 'CORRECTION_REQUIRED', 'Replace identity proof')).status).toBe(200);
    expect(await countRows(`notifications WHERE title = 'Action required: corrections'`)).toBe(1);
    expect(await itemByCode('IDENTITY_PROOF')).toMatchObject({ rejectionReason: 'Photo is unclear' });

    const item = await itemByCode('IDENTITY_PROOF');
    await asha.upload(`/applications/${appId}/documents/${item.id}/upload`, PDF).expect(200);
    await transition(asha, appId, 'READY_FOR_REVIEW');
    await transition(operator, appId, 'UNDER_REVIEW');
    expect((await transition(operator, appId, 'SUBMITTED_SIMULATED')).status).toBe(409);
    for (const code of SCOPES) expect((await review(code, 'ACCEPT')).status).toBe(200);
    expect((await transition(operator, appId, 'SUBMITTED_SIMULATED')).status).toBe(200);

    const final = await detail(asha, appId);
    expect(final.timeline.at(-1)).toMatchObject({ previousStatus: 'UNDER_REVIEW', newStatus: 'SUBMITTED_SIMULATED', actorRole: 'OPERATOR' });
    expect(final.timeline.at(-1).createdAt).toBeTruthy();
    for (const action of ['CHECKLIST_ACCEPTED', 'CHECKLIST_REJECTED', 'CORRECTION_REQUESTED', 'DOCUMENT_METADATA_ACCESSED']) {
      expect(await audits(action)).toBeGreaterThan(0);
    }
  });
  it('refuses a decision made on a stale view of a document', async () => {
    await toUnderReview();
    const item = await itemByCode('IDENTITY_PROOF', operator);
    await review('IDENTITY_PROOF', 'ACCEPT');
    const stale = await operator.post(`/operator/applications/${appId}/documents/${item.id}/review`, { decision: 'ACCEPT', seenUpdatedAt: item.updatedAt });
    expect(stale.body.error.code).toBe('STALE_VERSION');
  });
});

describe('operator permissions', () => {
  it('limits operators to their region and to applications sent for review', async () => {
    await operator.get(`/applications/${appId}`).expect(404);
    await toUnderReview();
    await operator.get(`/applications/${appId}`).expect(200);
    expect((await operator.get('/operator/applications?status=UNDER_REVIEW')).body.applications).toHaveLength(1);
    expect((await operator.get('/operator/applications?status=CLOSED')).body.applications).toHaveLength(0);
    expect((await southOperator.get('/operator/applications')).body.applications).toHaveLength(0);
    await southOperator.get(`/applications/${appId}`).expect(404);
    await southOperator.get(`/operator/applications/${appId}/audit`).expect(404);
    const item = await itemByCode('IDENTITY_PROOF');
    await southOperator.get(`/documents/${item.id}`).expect(404);
  });
  it('separates the two roles and hides internal references', async () => {
    await toUnderReview();
    await asha.get('/operator/applications').expect(403);
    await asha.get(`/operator/applications/${appId}/audit`).expect(403);
    await operator.get('/profile').expect(403);
    await operator.post(`/applications/${appId}/consent/withdraw`).expect(403);
    const body = JSON.stringify(await detail(operator, appId));
    expect(body).not.toContain('providerDocRef');
    expect(body).not.toContain('9000000000');
  });
});

describe('scenario 4: invalid status transition', () => {
  it('is rejected by the backend and audited', async () => {
    await toUnderReview();
    const res = await transition(operator, appId, 'DRAFT');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect((await detail(operator, appId)).application.status).toBe('UNDER_REVIEW');
    expect(await countRows(`audit_events WHERE action = 'TRANSITION_REJECTED' AND outcome = 'DENIED' AND detail = 'to DRAFT: INVALID_TRANSITION'`)).toBe(1);
  });
  it('blocks an applicant from performing operator transitions', async () => {
    await connect(asha, appId);
    await link(GOOD_DOCS);
    await transition(asha, appId, 'READY_FOR_REVIEW');
    expect((await transition(asha, appId, 'UNDER_REVIEW')).status).toBe(403);
    expect(await audits('TRANSITION_REJECTED')).toBe(1);
  });
  it('applies a duplicated request only once', async () => {
    await connect(asha, appId);
    await link(GOOD_DOCS);
    const { application } = await detail(asha, appId);
    const body = { to: 'READY_FOR_REVIEW', expectedVersion: application.version };
    const results = await Promise.all([asha.post(`/applications/${appId}/transitions`, body), asha.post(`/applications/${appId}/transitions`, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await countRows(`status_events WHERE new_status = 'READY_FOR_REVIEW'`)).toBe(1);
  });
});

describe('scenario 5: continue on another device', () => {
  it('a second session sees the same server state', async () => {
    await connect(asha, appId);
    await link(['mock-identity']);
    const phone = await signIn(EMAIL.asha);
    expect(phone.cookie[0]).not.toBe(asha.cookie[0]);
    const other = await detail(phone, appId);
    expect(other.connection.status).toBe('CONNECTED');
    expect(other.checklist[0]).toMatchObject({ status: 'PENDING', source: 'DIGILOCKER' });
    await phone.post(`/applications/${appId}/digilocker/link`, { docRefs: ['mock-birth'] }).expect(200);
    expect((await itemByCode('BIRTH_PROOF')).status).toBe('PENDING');
  });
});

describe('scenario 6: provider unavailable', () => {
  it('returns a retryable error, succeeds on retry, and leaves upload available', async () => {
    await asha.post(`/applications/${appId}/consent`, { accepted: true, scopes: SCOPES });
    await asha.post('/mock-provider/outage', { unavailable: true }).expect(204);
    const down = await asha.post(`/applications/${appId}/digilocker/connect`).expect(503);
    expect(down.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(await audits('PROVIDER_UNAVAILABLE')).toBe(1);
    const item = await itemByCode('IDENTITY_PROOF');
    await asha.upload(`/applications/${appId}/documents/${item.id}/upload`, PDF).expect(200);
    await asha.post('/mock-provider/outage', { unavailable: false }).expect(204);
    await asha.post(`/applications/${appId}/digilocker/connect`).expect(200);
  });
});

describe('scenario 7: ownership isolation (Applicant B against Applicant A)', () => {
  it('denies every read and write, and audits the attempts', async () => {
    await connect(asha, appId);
    await link(GOOD_DOCS);
    const item = await itemByCode('IDENTITY_PROOF');
    await startedApplication(bilal, 'Bilal Khan');
    const base = `/applications/${appId}`;
    const attempts = [
      bilal.get(base), bilal.get(`/documents/${item.id}`),
      bilal.post(`${base}/transitions`, { to: 'CLOSED', reason: 'x', expectedVersion: 2 }),
      bilal.post(`${base}/consent`, { accepted: true, scopes: SCOPES }), bilal.post(`${base}/consent/withdraw`),
      bilal.post(`${base}/digilocker/connect`), bilal.get(`${base}/digilocker/documents`),
      bilal.post(`${base}/digilocker/link`, { docRefs: ['mock-identity'] }),
      bilal.upload(`${base}/documents/${item.id}/upload`, PDF),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect((await bilal.get('/documents')).body.documents).toHaveLength(0);
    expect((await bilal.get('/applications')).body.applications).toHaveLength(1);
    expect(await audits('ACCESS_DENIED')).toBe(attempts.length);
    expect((await detail(asha, appId)).consent.withdrawnAt).toBeNull();
  });
  it("cannot use A's checklist item through B's own application", async () => {
    const item = await itemByCode('IDENTITY_PROOF');
    const bilalApp = await startedApplication(bilal, 'Bilal Khan');
    await bilal.upload(`/applications/${bilalApp}/documents/${item.id}/upload`, PDF).expect(404);
    expect((await itemByCode('IDENTITY_PROOF')).status).toBe('MISSING');
  });
  it("cannot read or mark A's notifications", async () => {
    await connect(asha, appId);
    await link(['mock-address-old']);
    const [note] = (await asha.get('/notifications')).body.notifications;
    await bilal.post(`/notifications/${note.id}/read`).expect(404);
    await asha.post(`/notifications/${note.id}/read`).expect(204);
    expect((await asha.get('/notifications')).body.notifications.find((n: any) => n.id === note.id).readAt).toBeTruthy();
  });
});

describe('audit trail and requirement configuration', () => {
  it('is append-only, carries correlation ids and holds no sensitive values', async () => {
    const callback = await connect(asha, appId);
    await link(GOOD_DOCS);
    const rows = await pool.query('SELECT * FROM audit_events');
    const dump = JSON.stringify(rows.rows);
    for (const secret of [callback.code, callback.signature, callback.state, 'XXXX-XXXX', '9000000000']) expect(dump).not.toContain(secret);
    expect(rows.rows.every((r) => r.correlation_id && r.action && r.resource_id && r.created_at)).toBe(true);
    await expect(pool.query('DELETE FROM audit_events')).rejects.toThrow(/append-only/);
  });
  it('gives each application type and scenario its own checklist', async () => {
    const res = await asha.post('/applications', { type: 'REISSUE', scenario: 'LOST_OR_DAMAGED' }).expect(201);
    const codes = (await detail(asha, res.body.application.id)).checklist.map((i: any) => i.code);
    expect(codes).toEqual(['IDENTITY_PROOF', 'ADDRESS_PROOF', 'LOSS_REPORT']);
    await asha.post('/applications', { type: 'FRESH', scenario: 'EXPIRING' }).expect(400);
    await asha.post('/applications', { type: 'FRESH', scenario: 'STANDARD' }).expect(409);
  });
  it('keeps today usable as an upload issue date', async () => {
    const item = await itemByCode('ADDRESS_PROOF');
    expect((await asha.upload(`/applications/${appId}/documents/${item.id}/upload`, PDF, 'application/pdf', today())).body.status).toBe('PENDING');
  });
});
