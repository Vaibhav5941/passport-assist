import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/lib/db.js';
import { DEMO_PASSWORD, seed } from '../../database/seed-data.js';

export const app = createApp();

export async function resetDatabase() {
  await pool.query(`TRUNCATE users, sessions, applicant_profiles, passport_applications, document_requirements,
    application_documents, digilocker_connections, consent_records, application_reviews, status_events,
    notifications, audit_events RESTART IDENTITY CASCADE`);
  await seed(pool);
}

export const EMAIL = {
  asha: 'asha.applicant@example.test', bilal: 'bilal.applicant@example.test',
  north: 'meera.operator@example.test', south: 'sam.operator@example.test',
};

export type Client = Awaited<ReturnType<typeof signIn>>;

export async function signIn(email: string) {
  const res = await request(app).post('/api/auth/login').set('x-requested-with', 'passport-assist').send({ email, password: DEMO_PASSWORD });
  if (res.status !== 200) throw new Error(`sign in failed: ${res.status}`);
  const cookie = res.headers['set-cookie'] as unknown as string[];
  const send = (method: 'get' | 'post' | 'put', url: string) =>
    request(app)[method](`/api${url}`).set('Cookie', cookie).set('x-requested-with', 'passport-assist');
  return {
    cookie, user: res.body.user,
    get: (url: string) => send('get', url),
    post: (url: string, body: object = {}) => send('post', url).send(body),
    put: (url: string, body: object) => send('put', url).send(body),
    upload: (url: string, bytes: Buffer, type = 'application/pdf', issuedOn?: string) => {
      const req = send('put', url).set('content-type', type);
      if (issuedOn) req.set('x-issued-on', issuedOn);
      return req.send(bytes);
    },
  };
}

export const profile = (fullName: string) => ({
  fullName, dateOfBirth: '1995-04-12', phone: '9000000000', addressLine: '12 Synthetic Street',
  city: 'Sampleville', state: 'Delhi', postalCode: '110001',
});

export const PDF = Buffer.from('%PDF-1.4 synthetic test file');
export const today = () => new Date().toISOString().slice(0, 10);
export const GOOD_DOCS = ['mock-identity', 'mock-address-recent', 'mock-birth'];
export const SCOPES = ['IDENTITY_PROOF', 'ADDRESS_PROOF', 'BIRTH_PROOF'];

export const detail = async (client: Client, id: string) => (await client.get(`/applications/${id}`)).body;

export async function transition(client: Client, id: string, to: string, reason?: string) {
  const current = await query<{ version: number }>(pool, 'SELECT version FROM passport_applications WHERE id = $1', [id]);
  return client.post(`/applications/${id}/transitions`, { to, reason, expectedVersion: current[0]!.version });
}

/** Applicant with a profile and a fresh application in DOCUMENTS_PENDING. */
export async function startedApplication(client: Client, name = 'Asha Verma') {
  await client.put('/profile', profile(name)).expect(204);
  const created = await client.post('/applications', { type: 'FRESH', scenario: 'STANDARD' }).expect(201);
  const id: string = created.body.application.id;
  await transition(client, id, 'DOCUMENTS_PENDING').then((r) => { if (r.status !== 200) throw new Error('start failed'); });
  return id;
}

export async function connect(client: Client, id: string, scopes = SCOPES) {
  await client.post(`/applications/${id}/consent`, { accepted: true, scopes }).expect(201);
  const started = await client.post(`/applications/${id}/digilocker/connect`).expect(200);
  const state = new URL(started.body.authorizationUrl, 'http://x').searchParams.get('state')!;
  const callback = (await client.post('/mock-provider/authorize', { state }).expect(200)).body;
  await client.post('/digilocker/callback', callback).expect(200);
  return callback as { state: string; code: string; signature: string };
}

export const countRows = async (sql: string, params: unknown[] = []) =>
  Number((await pool.query(`SELECT count(*) FROM ${sql}`, params)).rows[0].count);
