# API

Base path `/api`. JSON unless stated.

## Authentication
`POST /auth/login` sets `pa_session` (HttpOnly, SameSite=Strict, Path=/api, 8 hours; Secure when `NODE_ENV=production`). All other endpoints except logout need it. Every non-GET request needs `x-requested-with: passport-assist`; a foreign `Origin` is rejected.

## Endpoints
A = applicant (own data only), O = operator (region scope).

| Method | Path | Role | Body / notes |
|---|---|---|---|
| POST | /auth/login | any | `{email,password}` |
| POST | /auth/logout | any | 204 |
| GET | /auth/me | A,O | |
| GET, PUT | /profile | A | fullName, dateOfBirth, phone (10 digits), addressLine, city, state, postalCode (6 digits) |
| GET, POST | /applications | A | `{type:"FRESH"\|"REISSUE", scenario:"STANDARD"\|"EXPIRING"\|"LOST_OR_DAMAGED"}` |
| GET | /applications/:id | A,O | application, profile, consent, connection, checklist, timeline, actions |
| POST | /applications/:id/transitions | A,O | `{to, reason?, expectedVersion}` |
| POST | /applications/:id/consent | A | `{accepted:true, scopes:[code]}` |
| POST | /applications/:id/consent/withdraw | A | idempotent |
| POST | /applications/:id/digilocker/connect | A | returns authorizationUrl |
| POST | /digilocker/callback | A | `{state,code,signature}` |
| GET | /applications/:id/digilocker/documents | A | needs active consent |
| POST | /applications/:id/digilocker/link | A | `{docRefs:[...]}`, all or nothing |
| PUT | /applications/:id/documents/:itemId/upload | A | raw PDF/PNG/JPEG body, up to 2 MB; optional `x-issued-on: YYYY-MM-DD` |
| GET | /documents | A | own document list |
| GET | /documents/:id | A,O | metadata; audited |
| GET | /operator/applications?status= | O | queue |
| POST | /operator/applications/:id/documents/:itemId/review | O | `{decision:"ACCEPT"\|"REJECT", reason?, seenUpdatedAt}` |
| GET | /operator/applications/:id/audit | O | events and history |
| GET | /notifications | A | latest 100 |
| POST | /notifications/:id/read | A | 204 |
| POST | /mock-provider/authorize | A | demo only; `{state}` |
| POST | /mock-provider/outage | A | demo only; `{unavailable}` |

## Examples
```http
POST /api/applications/6f1c.../transitions
{ "to": "READY_FOR_REVIEW", "expectedVersion": 2 }

200 { "application": { "id": "6f1c...", "status": "READY_FOR_REVIEW", "version": 3 } }
409 { "error": { "code": "INVALID_TRANSITION", "message": "Cannot move from UNDER_REVIEW to DRAFT.", "correlationId": "..." } }
```
```http
POST /api/applications/6f1c.../consent
{ "accepted": true, "scopes": ["IDENTITY_PROOF"] }

201 { "consentId": "..." }
```
```http
POST /api/applications/6f1c.../consent/withdraw

200 { "withdrawn": true, "removedDocuments": 2 }
```

## Validation
Zod schemas in `backend/src/routes/schemas.ts`; write bodies reject unknown fields. JSON limit 20 KB.

## Error codes
| HTTP | Codes |
|---|---|
| 400 | VALIDATION_ERROR (with `details`), INVALID_JSON, INVALID_SCOPE, DUPLICATE_SELECTION, REASON_REQUIRED, STATE_INVALID, STATE_EXPIRED, PROVIDER_REJECTED, EMPTY_FILE |
| 401 | UNAUTHENTICATED, INVALID_CREDENTIALS |
| 403 | FORBIDDEN, CSRF_REJECTED, ROLE_NOT_PERMITTED, CONSENT_REQUIRED, CONSENT_WITHDRAWN |
| 404 | NOT_FOUND (also used for out-of-scope records) |
| 409 | INVALID_TRANSITION, GUARD_FAILED, STALE_VERSION, STATE_REPLAYED, CONSENT_ACTIVE, CONSENT_REQUIRED, NOT_CONNECTED, NOT_EDITABLE, NOT_UNDER_REVIEW, NOT_PENDING, NOTHING_TO_REVIEW, ALREADY_VERIFIED, OPEN_APPLICATION_EXISTS |
| 413 / 415 | FILE_TOO_LARGE / UNSUPPORTED_TYPE, CONTENT_MISMATCH |
| 429 | TOO_MANY_ATTEMPTS |
| 500 | INTERNAL_ERROR |
| 503 | PROVIDER_UNAVAILABLE |
