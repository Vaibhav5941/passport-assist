// HTTP layer: validate, call a service, return JSON. No business rules here.
import express, { Router } from 'express';
import { config } from '../config.js';
import { one, pool, query } from '../lib/db.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { AppError, notFound } from '../lib/errors.js';
import { authenticate, contextOf, endSession, requireRole, startSession } from '../middleware/auth.js';
import { mockProvider } from '../integrations/digilocker/index.js';
import type { User } from '../domain/types.js';
import { audit } from '../services/audit.js';
import { getApplication } from '../services/access.js';
import * as applications from '../services/applications.js';
import * as digilocker from '../services/digilocker.js';
import * as documents from '../services/documents.js';
import { requestTransition } from '../services/transitions.js';
import { verifyState } from '../services/oauthState.js';
import * as s from './schemas.js';

export const router = Router();
const param = (value: unknown) => String(value);

// ---- Sign in (local demo authentication) ----
const attempts = new Map<string, { count: number; resetAt: number }>();
const dummyHash = hashPassword('timing-equaliser');

router.post('/auth/login', async (req, res) => {
  const { email, password } = s.loginSchema.parse(req.body);
  const key = `${req.ip}|${email}`;
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.resetAt > now && entry.count >= 5) throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Try again in a few minutes.');

  const user = await one<User & { passwordHash: string }>(pool, 'SELECT * FROM users WHERE email = $1', [email]);
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !valid) {
    attempts.set(key, entry && entry.resetAt > now ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + 5 * 60_000 });
    await audit({ actor: { id: null, role: 'SYSTEM' }, action: 'AUTH_SIGN_IN_FAILED', resourceType: 'user', resourceId: user?.id ?? 'unknown', outcome: 'DENIED', correlationId: res.locals.correlationId });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
  }
  attempts.delete(key);
  await startSession(res, user.id);
  await audit({ actor: user, action: 'AUTH_SIGNED_IN', resourceType: 'user', resourceId: user.id, correlationId: res.locals.correlationId });
  const { id, displayName, role, region } = user;
  res.json({ user: { id, email: user.email, displayName, role, region } });
});

router.post('/auth/logout', async (req, res) => { await endSession(req, res); res.status(204).end(); });

router.use(authenticate);
const applicant = requireRole('APPLICANT');
const operator = requireRole('OPERATOR');

router.get('/auth/me', (_req, res) => { res.json({ user: contextOf(res).user, demoMode: config.demoMode }); });

// ---- Applicant profile (always the signed-in user's own) ----
router.get('/profile', applicant, async (_req, res) => {
  const profile = await one(pool, `SELECT full_name, date_of_birth, phone, address_line, city, state, postal_code, updated_at FROM applicant_profiles WHERE user_id = $1`, [contextOf(res).user.id]);
  res.json({ profile: profile ?? null });
});
router.put('/profile', applicant, async (req, res) => {
  const p = s.profileSchema.parse(req.body);
  await query(pool, `INSERT INTO applicant_profiles (user_id, full_name, date_of_birth, phone, address_line, city, state, postal_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (user_id) DO UPDATE SET full_name=$2, date_of_birth=$3, phone=$4, address_line=$5, city=$6, state=$7, postal_code=$8, updated_at=now()`,
    [contextOf(res).user.id, p.fullName, p.dateOfBirth, p.phone, p.addressLine, p.city, p.state, p.postalCode]);
  res.status(204).end();
});

// ---- Applications ----
router.get('/applications', applicant, async (_req, res) => { res.json({ applications: await applications.listOwnApplications(contextOf(res)) }); });
router.post('/applications', applicant, async (req, res) => {
  const { type, scenario } = s.createApplicationSchema.parse(req.body);
  res.status(201).json({ application: await applications.createApplication(contextOf(res), type, scenario) });
});
router.get('/applications/:id', async (req, res) => { res.json(await applications.applicationDetail(contextOf(res), param(req.params.id))); });
router.post('/applications/:id/transitions', async (req, res) => {
  res.json({ application: await requestTransition(contextOf(res), param(req.params.id), s.transitionSchema.parse(req.body)) });
});

// ---- Consent and DigiLocker (simulated) ----
router.post('/applications/:id/consent', applicant, async (req, res) => {
  const { scopes } = s.consentSchema.parse(req.body);
  res.status(201).json(await digilocker.grantConsent(contextOf(res), param(req.params.id), scopes));
});
router.post('/applications/:id/consent/withdraw', applicant, async (req, res) => { res.json(await digilocker.withdrawConsent(contextOf(res), param(req.params.id))); });
router.post('/applications/:id/digilocker/connect', applicant, async (req, res) => { res.json(await digilocker.startConnection(contextOf(res), param(req.params.id))); });
router.post('/digilocker/callback', applicant, async (req, res) => { res.json(await digilocker.handleCallback(contextOf(res), s.callbackSchema.parse(req.body))); });
router.get('/applications/:id/digilocker/documents', applicant, async (req, res) => { res.json({ documents: await digilocker.discoverDocuments(contextOf(res), param(req.params.id)) }); });
router.post('/applications/:id/digilocker/link', applicant, async (req, res) => {
  res.json({ results: await digilocker.linkDocuments(contextOf(res), param(req.params.id), s.linkSchema.parse(req.body).docRefs) });
});

// ---- Demo-only helpers that stand in for the provider ----
router.post('/mock-provider/authorize', applicant, async (req, res) => {
  if (!config.demoMode) throw notFound();
  const { state } = s.authorizeSchema.parse(req.body);
  await getApplication(contextOf(res), verifyState(state).applicationId);
  res.json(mockProvider.simulateAuthorization(state));
});
router.post('/mock-provider/outage', applicant, (req, res) => {
  if (!config.demoMode) throw notFound();
  mockProvider.setOutage(contextOf(res).user.id, s.outageSchema.parse(req.body).unavailable);
  res.status(204).end();
});

// ---- Documents ----
router.get('/documents', applicant, async (_req, res) => { res.json({ documents: await documents.myDocuments(contextOf(res)) }); });
router.get('/documents/:id', async (req, res) => { res.json({ document: await documents.documentDetail(contextOf(res), param(req.params.id)) }); });
router.put(
  '/applications/:id/documents/:itemId/upload', applicant,
  express.raw({ type: ['application/pdf', 'image/png', 'image/jpeg'], limit: documents.MAX_UPLOAD_BYTES }),
  async (req, res) => {
    const issuedOn = s.uploadDateSchema.parse(req.get('x-issued-on') || null);
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    if (!bytes) throw new AppError(415, 'UNSUPPORTED_TYPE', 'Upload a PDF, PNG or JPEG file.');
    res.json(await documents.uploadDocument(contextOf(res), param(req.params.id), param(req.params.itemId), String(req.get('content-type')), bytes, issuedOn));
  },
);

// ---- Operator ----
router.get('/operator/applications', operator, async (req, res) => {
  res.json({ applications: await applications.listQueue(contextOf(res), s.queueSchema.parse(req.query).status) });
});
router.post('/operator/applications/:id/documents/:itemId/review', operator, async (req, res) => {
  const body = s.reviewSchema.parse(req.body);
  res.json(await documents.reviewDocument(contextOf(res), param(req.params.id), param(req.params.itemId), body.decision, body.reason, body.seenUpdatedAt));
});
router.get('/operator/applications/:id/audit', operator, async (req, res) => { res.json(await applications.auditTrail(contextOf(res), param(req.params.id))); });

// ---- Notifications ----
router.get('/notifications', applicant, async (_req, res) => {
  res.json({ notifications: await query(pool, 'SELECT id, application_id, title, message, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [contextOf(res).user.id]) });
});
router.post('/notifications/:id/read', applicant, async (req, res) => {
  const id = param(req.params.id);
  const updated = /^[0-9a-f-]{36}$/i.test(id)
    ? await one(pool, 'UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id', [id, contextOf(res).user.id])
    : undefined;
  if (!updated) throw notFound();
  res.status(204).end();
});
