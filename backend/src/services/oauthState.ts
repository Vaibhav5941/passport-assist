// Signed, expiring state: "nonce.applicationId.expiry.signature".
// Single use is enforced in the database by digiLockerService.
import { config } from '../config.js';
import { hmac, randomToken, safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

export function createState(applicationId: string, now = Date.now()) {
  const nonce = randomToken(32);
  const expiresAt = new Date(now + config.stateTtlMs);
  const payload = `${nonce}.${applicationId}.${expiresAt.getTime()}`;
  return { state: `${payload}.${hmac(payload, config.stateSecret)}`, nonce, expiresAt };
}

export function verifyState(state: string, now = Date.now()) {
  const parts = state.split('.');
  const [nonce, applicationId, expiry, signature] = parts;
  if (parts.length !== 4 || !safeEqual(signature!, hmac(`${nonce}.${applicationId}.${expiry}`, config.stateSecret))) {
    throw new AppError(400, 'STATE_INVALID', 'This connection request could not be verified. Please start again.');
  }
  if (Number(expiry) <= now) throw new AppError(400, 'STATE_EXPIRED', 'This connection request has expired. Please start again.');
  return { nonce: nonce!, applicationId: applicationId! };
}
