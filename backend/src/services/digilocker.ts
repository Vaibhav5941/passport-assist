// Consent-gated DigiLocker workflow. Depends only on the adapter interface.
import type pg from 'pg';
import { one, query } from '../lib/db.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { checkRules } from '../domain/rules.js';
import type { Application, RequestContext } from '../domain/types.js';
import { digiLockerFor } from '../integrations/digilocker/index.js';
import { ProviderRejectedError, ProviderUnavailableError, type CallbackParams } from '../integrations/digilocker/types.js';
import { assertApplicant, withApplication } from './access.js';
import { audit } from './audit.js';
import { loadChecklist } from './checklist.js';
import { notifier } from './notifications.js';
import { createState, verifyState } from './oauthState.js';
import { recordTransition } from './transitions.js';
import { EDITABLE } from './applications.js';

export const CONSENT_PURPOSE = 'Fetch document metadata to prepare this passport assistance application';
export const CONSENT_TEXT_VERSION = '2026-11-v1';

interface Consent { id: string; scopes: string[] }
interface Connection {
  id: string; consentId: string; status: 'PENDING' | 'CONNECTED' | 'WITHDRAWN'; stateNonceHash: string;
  stateUsedAt: Date | null; callbackHash: string | null; providerRef: string | null;
}

const activeConsent = (tx: pg.PoolClient, applicationId: string) =>
  one<Consent>(tx, 'SELECT id, scopes FROM consent_records WHERE application_id = $1 AND withdrawn_at IS NULL', [applicationId]);

const connectionFor = (tx: pg.PoolClient, applicationId: string) =>
  one<Connection>(tx, 'SELECT * FROM digilocker_connections WHERE application_id = $1', [applicationId]);

function assertEditable(application: Application) {
  if (!EDITABLE.includes(application.status)) {
    throw conflict('NOT_EDITABLE', 'Documents can only be changed while documents are pending or a correction is required.');
  }
}

/** Translates provider failures into safe API errors and audits outages. */
async function callProvider<T>(ctx: RequestContext, applicationId: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      await audit({ actor: ctx.user, action: 'PROVIDER_UNAVAILABLE', resourceType: 'connection', resourceId: applicationId, applicationId, outcome: 'FAILURE', correlationId: ctx.correlationId });
      throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'DigiLocker (simulated) is unavailable. Retry, or upload instead.');
    }
    if (error instanceof ProviderRejectedError) {
      throw new AppError(400, 'PROVIDER_REJECTED', 'The provider response could not be verified.');
    }
    throw error;
  }
}

export async function grantConsent(ctx: RequestContext, applicationId: string, scopes: string[]) {
  assertApplicant(ctx);
  return withApplication(ctx, applicationId, async (tx, application) => {
    assertEditable(application);
    const allowed = new Set((await loadChecklist(tx, applicationId)).map((i) => i.code));
    const unique = [...new Set(scopes)].sort();
    if (!unique.every((s) => allowed.has(s))) throw new AppError(400, 'INVALID_SCOPE', 'A selected scope is not part of this checklist.');
    const existing = await activeConsent(tx, applicationId);
    if (existing) {
      if ([...existing.scopes].sort().join() === unique.join()) return { consentId: existing.id };
      throw conflict('CONSENT_ACTIVE', 'Withdraw your current consent before granting a different one.');
    }
    const consent = (await one<{ id: string }>(
      tx, 'INSERT INTO consent_records (application_id, user_id, purpose, scopes, text_version) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [applicationId, ctx.user.id, CONSENT_PURPOSE, unique, CONSENT_TEXT_VERSION],
    ))!;
    await audit({ actor: ctx.user, action: 'CONSENT_GRANTED', resourceType: 'consent', resourceId: consent.id, applicationId, detail: `scopes: ${unique.join(' ')}`, correlationId: ctx.correlationId }, tx);
    return { consentId: consent.id };
  });
}

export async function startConnection(ctx: RequestContext, applicationId: string) {
  assertApplicant(ctx);
  return callProvider(ctx, applicationId, () => withApplication(ctx, applicationId, async (tx, application) => {
    assertEditable(application);
    const consent = await activeConsent(tx, applicationId);
    if (!consent) throw conflict('CONSENT_REQUIRED', 'Grant consent before connecting.');
    const existing = await connectionFor(tx, applicationId);
    if (existing?.status === 'CONNECTED') return { alreadyConnected: true as const, authorizationUrl: null };

    const { state, nonce, expiresAt } = createState(applicationId);
    const { authorizationUrl } = await digiLockerFor(ctx.user.id).connect({ state, scopes: consent.scopes });
    // One row per application. A retry replaces the nonce, invalidating older states.
    await query(tx, `INSERT INTO digilocker_connections (application_id, consent_id, state_nonce_hash, state_expires_at)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (application_id) DO UPDATE SET consent_id = $2, status = 'PENDING', state_nonce_hash = $3,
        state_expires_at = $4, state_used_at = NULL, callback_hash = NULL, provider_ref = NULL, updated_at = now()`,
      [applicationId, consent.id, sha256(nonce), expiresAt]);
    await audit({ actor: ctx.user, action: 'DIGILOCKER_CONNECT_STARTED', resourceType: 'connection', resourceId: applicationId, applicationId, correlationId: ctx.correlationId }, tx);
    return { alreadyConnected: false as const, authorizationUrl };
  }));
}

export async function handleCallback(ctx: RequestContext, params: CallbackParams) {
  assertApplicant(ctx);
  const { nonce, applicationId } = verifyState(params.state);
  const fingerprint = sha256(`${params.state}.${params.code}.${params.signature}`);
  try {
    return await callProvider(ctx, applicationId, () => withApplication(ctx, applicationId, async (tx, application) => {
      const connection = await connectionFor(tx, applicationId);
      const consent = await activeConsent(tx, applicationId);
      if (!consent || !connection || connection.consentId !== consent.id) {
        throw conflict('CONSENT_REQUIRED', 'Consent for this connection is no longer active.');
      }
      if (connection.stateNonceHash !== sha256(nonce)) throw new AppError(400, 'STATE_INVALID', 'This connection request was replaced. Please start again.');
      if (connection.stateUsedAt) {
        // An exact redelivery succeeds without writing again. Anything else is a replay.
        if (connection.callbackHash !== fingerprint) throw conflict('STATE_REPLAYED', 'This connection request was already used.');
        await audit({ actor: ctx.user, action: 'DIGILOCKER_CALLBACK_DUPLICATE', resourceType: 'connection', resourceId: connection.id, applicationId, correlationId: ctx.correlationId }, tx);
        return { applicationId, status: 'CONNECTED' as const, duplicate: true };
      }
      assertEditable(application);
      const { providerRef } = await digiLockerFor(ctx.user.id).exchangeCallback(params);
      await query(tx, `UPDATE digilocker_connections SET status = 'CONNECTED', state_used_at = now(), callback_hash = $1, provider_ref = $2, updated_at = now() WHERE id = $3`,
        [fingerprint, providerRef, connection.id]);
      await audit({ actor: ctx.user, action: 'DIGILOCKER_CONNECTED', resourceType: 'connection', resourceId: connection.id, applicationId, correlationId: ctx.correlationId }, tx);
      return { applicationId, status: 'CONNECTED' as const, duplicate: false };
    }));
  } catch (error) {
    if (error instanceof AppError && error.status !== 503 && error.status !== 404) {
      await audit({ actor: ctx.user, action: 'DIGILOCKER_CALLBACK_REJECTED', resourceType: 'connection', resourceId: applicationId, applicationId, outcome: 'DENIED', detail: error.code, correlationId: ctx.correlationId });
    }
    throw error;
  }
}

async function usableConnection(tx: pg.PoolClient, applicationId: string) {
  const consent = await activeConsent(tx, applicationId);
  if (!consent) throw new AppError(403, 'CONSENT_REQUIRED', 'No active consent. DigiLocker documents are not accessible.');
  const connection = await connectionFor(tx, applicationId);
  if (connection?.status !== 'CONNECTED' || connection.consentId !== consent.id) throw conflict('NOT_CONNECTED', 'Connect DigiLocker first.');
  return { consent, providerRef: connection.providerRef! };
}

async function profileName(tx: pg.PoolClient, userId: string) {
  return (await one<{ fullName: string }>(tx, 'SELECT full_name FROM applicant_profiles WHERE user_id = $1', [userId]))!.fullName;
}

export async function discoverDocuments(ctx: RequestContext, applicationId: string) {
  assertApplicant(ctx);
  return callProvider(ctx, applicationId, () => withApplication(ctx, applicationId, async (tx) => {
    const { consent, providerRef } = await usableConnection(tx, applicationId);
    const documents = await digiLockerFor(ctx.user.id).listDocuments(providerRef, consent.scopes, await profileName(tx, ctx.user.id));
    await audit({ actor: ctx.user, action: 'DOCUMENTS_DISCOVERED', resourceType: 'connection', resourceId: applicationId, applicationId, detail: `count: ${documents.length}`, correlationId: ctx.correlationId }, tx);
    return documents.map(({ holderName: _name, ...metadata }) => metadata);
  }));
}

export async function linkDocuments(ctx: RequestContext, applicationId: string, docRefs: string[]) {
  assertApplicant(ctx);
  return callProvider(ctx, applicationId, () => withApplication(ctx, applicationId, async (tx, application) => {
    assertEditable(application);
    const { consent, providerRef } = await usableConnection(tx, applicationId);
    const name = await profileName(tx, ctx.user.id);
    const items = await loadChecklist(tx, applicationId);
    const used = new Set<string>();
    const results: Array<{ code: string; status: string; reason: string | null }> = [];

    for (const docRef of new Set(docRefs)) {
      const doc = await digiLockerFor(ctx.user.id).retrieveDocumentMetadata(providerRef, docRef, consent.scopes, name);
      const item = items.find((i) => i.code === doc.code);
      if (!item) throw notFound();
      if (used.has(doc.code)) throw new AppError(400, 'DUPLICATE_SELECTION', 'Select only one document for each checklist item.');
      used.add(doc.code);
      if (item.status === 'VERIFIED') throw conflict('ALREADY_VERIFIED', `${item.name} is already verified.`);
      // Re-linking the same document is a no-op.
      if (item.providerDocRef === docRef && item.consentId === consent.id) {
        results.push({ code: item.code, status: item.status, reason: item.rejectionReason });
        continue;
      }
      const failures = checkRules(item.rules, doc, name);
      const status = failures.length ? 'REJECTED' : 'PENDING';
      const reason = failures.length ? failures.join(' ') : null;
      await query(tx, `UPDATE application_documents SET status = $1, source = 'DIGILOCKER', provider_doc_ref = $2, consent_id = $3,
          issuer = $4, masked_identifier = $5, issued_on = $6, valid_until = $7, mime_type = NULL, size_bytes = NULL,
          rejection_reason = $8, access_revoked_at = NULL, updated_at = now() WHERE id = $9`,
        [status, docRef, consent.id, doc.issuer, doc.maskedIdentifier, doc.issuedOn, doc.validUntil, reason, item.id]);
      const base = { actor: ctx.user, resourceType: 'document' as const, resourceId: item.id, applicationId, correlationId: ctx.correlationId };
      await audit({ ...base, action: 'DOCUMENT_METADATA_ACCESSED' }, tx);
      await audit({ ...base, action: 'DOCUMENT_LINKED' }, tx);
      if (reason) {
        await audit({ ...base, action: 'DOCUMENT_RULE_FAILED', outcome: 'FAILURE' }, tx);
        await notifyRuleFailure(tx, application, item.name, reason);
      }
      results.push({ code: item.code, status, reason });
    }
    return results;
  }));
}

export async function notifyRuleFailure(tx: pg.PoolClient, application: Application, itemName: string, reason: string) {
  await notifier.send(tx, {
    userId: application.applicantId, applicationId: application.id, title: `Action required: ${itemName}`,
    message: `${itemName} did not pass a checklist rule. ${reason}`, link: `/applications/${application.id}/checklist`,
  });
}

export async function withdrawConsent(ctx: RequestContext, applicationId: string) {
  assertApplicant(ctx);
  // Local revocation commits first and never depends on the provider being up.
  const outcome = await withApplication(ctx, applicationId, async (tx, application) => {
    const consent = await activeConsent(tx, applicationId);
    if (!consent) return { withdrawn: false, removedDocuments: 0, providerRef: null as string | null };
    const connection = await connectionFor(tx, applicationId);
    await query(tx, 'UPDATE consent_records SET withdrawn_at = now() WHERE id = $1', [consent.id]);
    await query(tx, `UPDATE digilocker_connections SET status = 'WITHDRAWN', provider_ref = NULL, callback_hash = NULL, updated_at = now() WHERE application_id = $1`, [applicationId]);
    // Scrub every linked DigiLocker item: references and metadata are deleted.
    const scrubbed = await query<{ id: string }>(tx, `UPDATE application_documents SET status = 'MISSING', source = NULL, provider_doc_ref = NULL,
        consent_id = NULL, issuer = NULL, masked_identifier = NULL, issued_on = NULL, valid_until = NULL,
        rejection_reason = NULL, access_revoked_at = now(), updated_at = now()
      WHERE application_id = $1 AND source = 'DIGILOCKER' RETURNING id`, [applicationId]);
    await audit({ actor: ctx.user, action: 'CONSENT_WITHDRAWN', resourceType: 'consent', resourceId: consent.id, applicationId, detail: `documents removed: ${scrubbed.length}`, correlationId: ctx.correlationId }, tx);

    const inReview = ['READY_FOR_REVIEW', 'UNDER_REVIEW', 'CORRECTION_REQUIRED'].includes(application.status);
    if (scrubbed.length && inReview) {
      await recordTransition(tx, application, 'DOCUMENTS_PENDING', { id: null, role: 'SYSTEM', name: 'System' },
        'Consent was withdrawn, so linked DigiLocker documents are no longer accessible.', ctx.correlationId);
    } else if (scrubbed.length && application.status === 'DOCUMENTS_PENDING') {
      await notifier.send(tx, { userId: ctx.user.id, applicationId, title: 'Action required: documents',
        message: 'Consent withdrawn. Upload replacements for the removed documents, or grant consent again.', link: `/applications/${applicationId}/checklist` });
    }
    return { withdrawn: true, removedDocuments: scrubbed.length, providerRef: connection?.providerRef ?? null };
  });
  if (outcome.providerRef) {
    await callProvider(ctx, applicationId, () => digiLockerFor(ctx.user.id).revokeConnection(outcome.providerRef!)).catch(() => undefined);
  }
  return { withdrawn: outcome.withdrawn, removedDocuments: outcome.removedDocuments };
}
