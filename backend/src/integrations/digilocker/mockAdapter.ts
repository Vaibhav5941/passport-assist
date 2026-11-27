// SIMULATION ONLY. No network call is made and no real DigiLocker data exists here.
import { config } from '../../config.js';
import { hmac, randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import {
  ProviderRejectedError, ProviderUnavailableError,
  type CallbackParams, type ConnectRequest, type IDigiLockerAdapter, type ProviderDocument,
} from './types.js';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Synthetic catalogue. "address-old" is deliberately stale to exercise rule failures. */
function catalogue(holderName: string): ProviderDocument[] {
  const doc = (docRef: string, code: string, title: string, issuedDaysAgo: number, tail: string, validUntil: string | null = null) => ({
    docRef, code, title, issuer: 'Mock Issuer (synthetic)', maskedIdentifier: `XXXX-XXXX-${tail}`,
    holderName, issuedOn: daysAgo(issuedDaysAgo), validUntil,
  });
  return [
    doc('mock-identity', 'IDENTITY_PROOF', 'Sample identity card', 900, '4821'),
    doc('mock-address-recent', 'ADDRESS_PROOF', 'Sample utility statement (recent)', 20, '7310'),
    doc('mock-address-old', 'ADDRESS_PROOF', 'Sample utility statement (old)', 400, '1188'),
    doc('mock-birth', 'BIRTH_PROOF', 'Sample birth certificate', 4000, '0956'),
    doc('mock-old-passport', 'OLD_PASSPORT', 'Sample previous passport record', 3500, '6402', daysAgo(-120)),
    doc('mock-loss-report', 'LOSS_REPORT', 'Sample loss report', 15, '2274'),
  ];
}

/** Demo controls that a real provider would not have: outage switch and its consent page. */
export class MockProviderControl {
  /** Keyed by user id; '*' affects everyone. */
  private outages = new Set<string>();

  setOutage(key: string, down: boolean) {
    if (down) this.outages.add(key);
    else this.outages.delete(key);
  }

  isDown(userId: string) {
    return this.outages.has(userId) || this.outages.has('*');
  }

  /** Plays the provider's consent page and returns a signed callback. */
  simulateAuthorization(state: string): CallbackParams {
    const code = randomToken(24);
    return { state, code, signature: sign(state, code) };
  }
}

const sign = (state: string, code: string) => hmac(`${state}.${code}`, config.providerSecret);

export class MockDigiLockerAdapter implements IDigiLockerAdapter {
  constructor(private control: MockProviderControl, private userId: string) {}

  private ensureUp() {
    if (this.control.isDown(this.userId)) throw new ProviderUnavailableError('Mock provider outage');
  }

  async connect(request: ConnectRequest) {
    this.ensureUp();
    return { authorizationUrl: this.buildAuthorizationUrl(request) };
  }

  buildAuthorizationUrl({ state, scopes }: ConnectRequest) {
    return `/digilocker/authorize?${new URLSearchParams({ state, scope: scopes.join(' ') })}`;
  }

  async exchangeCallback({ state, code, signature }: CallbackParams) {
    this.ensureUp();
    if (!safeEqual(signature, sign(state, code))) throw new ProviderRejectedError('Callback signature is invalid');
    return { providerRef: `mock-conn-${sha256(state).slice(0, 16)}` };
  }

  async listDocuments(_providerRef: string, scopes: string[], holderName: string) {
    this.ensureUp();
    return catalogue(holderName).filter((d) => scopes.includes(d.code));
  }

  async retrieveDocumentMetadata(_providerRef: string, docRef: string, scopes: string[], holderName: string) {
    this.ensureUp();
    const found = catalogue(holderName).find((d) => d.docRef === docRef && scopes.includes(d.code));
    if (!found) throw new ProviderRejectedError('Document is not available for the consented scopes');
    return found;
  }

  async revokeConnection(_providerRef: string) {
    this.ensureUp(); // local revocation has already happened before this is called
  }
}
