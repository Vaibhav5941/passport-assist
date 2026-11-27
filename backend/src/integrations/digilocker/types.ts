// Provider-independent boundary. Business logic depends only on this file, so an
// authorised sandbox adapter can replace the mock without changing services.

export interface ProviderDocument {
  docRef: string; code: string; title: string; issuer: string;
  maskedIdentifier: string; holderName: string; issuedOn: string; validUntil: string | null;
}

export interface ConnectRequest { state: string; scopes: string[] }
export interface CallbackParams { state: string; code: string; signature: string }

export interface IDigiLockerAdapter {
  /** Checks the provider is reachable and returns where to send the user. */
  connect(request: ConnectRequest): Promise<{ authorizationUrl: string }>;
  buildAuthorizationUrl(request: ConnectRequest): string;
  /** Verifies the callback and returns an opaque, non-secret connection handle. */
  exchangeCallback(params: CallbackParams): Promise<{ providerRef: string }>;
  listDocuments(providerRef: string, scopes: string[], holderName: string): Promise<ProviderDocument[]>;
  retrieveDocumentMetadata(providerRef: string, docRef: string, scopes: string[], holderName: string): Promise<ProviderDocument>;
  revokeConnection(providerRef: string): Promise<void>;
}

export class ProviderUnavailableError extends Error {}
export class ProviderRejectedError extends Error {}
