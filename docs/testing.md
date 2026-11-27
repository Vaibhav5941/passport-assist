# Testing

Run everything: `npm test`

## Strategy
- **Unit** (`stateMachine.test.ts`): every listed transition for its roles, every unlisted status pair for every role, every disallowed role, reasons, guards, checklist rules, signed state.
- **API integration** (`workflow.test.ts`): Supertest against a real PostgreSQL `_test` database, reset and re-seeded before each test. The provider is the mock.

## Coverage of required categories
| Requirement | Test group |
|---|---|
| Valid, invalid and role-restricted transitions | state machine groups, scenario 4 |
| Duplicate callback, replay | scenario 2 |
| Expired and invalid signed state | signed OAuth state (unit); tampered state in scenario 2 |
| Consent grant and withdrawal, access afterwards | consent, scenario 1 |
| Provider unavailable and retry | scenario 6 |
| Upload fallback | upload fallback, scenarios 1 and 6 |
| Failed checklist rules, reason requirement | scenario 3, operator review |
| Ownership isolation | scenario 7 |
| Operator permissions | operator permissions |
| Audit and notifications | audit trail group and assertions across scenarios |
| Second device | scenario 5 (two sessions) |

## Actual results (27 November 2026, Linux, Node 22, PostgreSQL 16)
```
Test Files  2 passed (2)
     Tests  58 passed (58)
```
`npm run build` (type-check of both projects and web build) passed.

A scripted Chromium journey on the dev servers covered sign-in, profile, application, consent, outage and retry, linking with a rule failure, notifications, withdrawal, uploads, review, correction, resubmission, simulated submission, audit trail and a 375 px viewport. It found no page errors and no horizontal overflow on the pages it checked. The only console errors were the expected 401 before sign-in and the simulated 503. That script is not part of the repository.

## Defects found during development
- An operator could accept a document that had been rejected, including by a checklist rule. Fixed, with a regression test.

## Not covered
Frontend unit tests, load testing, a screen reader or full keyboard audit, other browsers, the Docker Compose path, Windows and macOS, and any human manual testing.
