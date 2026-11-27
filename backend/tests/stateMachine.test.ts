import { describe, expect, it } from 'vitest';
import { evaluateTransition, TRANSITIONS, type GuardFacts } from '../src/domain/stateMachine.js';
import { checkRules } from '../src/domain/rules.js';
import { createState, verifyState } from '../src/services/oauthState.js';
import type { ActorRole, ApplicationStatus } from '../src/domain/types.js';

const STATUSES: ApplicationStatus[] = ['DRAFT', 'DOCUMENTS_PENDING', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'SUBMITTED_SIMULATED', 'CLOSED'];
const ROLES: ActorRole[] = ['APPLICANT', 'OPERATOR', 'SYSTEM'];
const facts = (status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'MISSING', profileComplete = true): GuardFacts => ({ profileComplete, items: [{ required: true, status }] });
/** Facts that satisfy each guard. */
const satisfying = (guard?: string) => facts(guard === 'HAS_REJECTED_ITEM' ? 'REJECTED' : 'VERIFIED');

describe('state machine: valid transitions', () => {
  it.each(TRANSITIONS.map((t) => [t.from, t.to, t] as const))('%s -> %s', (from, to, t) => {
    for (const role of t.roles) expect(evaluateTransition(from, to, role, 'reason', satisfying(t.guard)).allowed).toBe(true);
  });
});

describe('state machine: invalid transitions and roles', () => {
  it('rejects every pair that is not listed, for every role', () => {
    for (const from of STATUSES) for (const to of STATUSES) for (const role of ROLES) {
      if (TRANSITIONS.some((t) => t.from === from && t.to === to)) continue;
      expect(evaluateTransition(from, to, role, 'r', facts('VERIFIED'))).toMatchObject({ allowed: false, code: 'INVALID_TRANSITION' });
    }
  });
  it('rejects every role that is not listed for a transition', () => {
    for (const t of TRANSITIONS) for (const role of ROLES.filter((r) => !t.roles.includes(r))) {
      expect(evaluateTransition(t.from, t.to, role, 'r', satisfying(t.guard))).toMatchObject({ code: 'ROLE_NOT_PERMITTED' });
    }
  });
  it('requires a reason where configured', () => {
    expect(evaluateTransition('UNDER_REVIEW', 'CLOSED', 'OPERATOR', '   ', facts('VERIFIED'))).toMatchObject({ code: 'REASON_REQUIRED' });
  });
  it('enforces guards', () => {
    expect(evaluateTransition('DRAFT', 'DOCUMENTS_PENDING', 'APPLICANT', undefined, facts('MISSING', false))).toMatchObject({ code: 'GUARD_FAILED' });
    expect(evaluateTransition('DOCUMENTS_PENDING', 'READY_FOR_REVIEW', 'APPLICANT', undefined, facts('MISSING'))).toMatchObject({ code: 'GUARD_FAILED' });
    expect(evaluateTransition('UNDER_REVIEW', 'SUBMITTED_SIMULATED', 'OPERATOR', undefined, facts('PENDING'))).toMatchObject({ code: 'GUARD_FAILED' });
  });
  it('treats CLOSED as terminal', () => {
    expect(TRANSITIONS.some((t) => t.from === 'CLOSED')).toBe(false);
  });
});

describe('checklist rules', () => {
  const now = new Date('2026-11-27T00:00:00Z');
  it('rejects stale, expired and mismatched documents with reasons', () => {
    expect(checkRules({ maxAgeMonths: 3 }, { issuedOn: '2026-01-01' }, 'A', now)[0]).toContain('last 3 months');
    expect(checkRules({}, { validUntil: '2026-01-01' }, 'A', now)[0]).toContain('expired');
    expect(checkRules({ nameMustMatch: true }, { holderName: 'Someone Else' }, 'Asha Verma', now)[0]).toContain('name');
  });
  it('accepts a recent matching document', () => {
    expect(checkRules({ maxAgeMonths: 3, nameMustMatch: true }, { issuedOn: '2026-11-01', holderName: 'asha verma' }, 'Asha Verma', now)).toEqual([]);
  });
});

describe('signed OAuth state', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  it('round-trips and is random', () => {
    const a = createState(id);
    expect(verifyState(a.state)).toMatchObject({ applicationId: id, nonce: a.nonce });
    expect(createState(id).state).not.toBe(a.state);
  });
  it('rejects an expired state', () => {
    const { state } = createState(id, Date.now() - 60 * 60_000);
    expect(() => verifyState(state)).toThrowError(/expired/);
  });
  it('rejects tampered and malformed state', () => {
    const parts = createState(id).state.split('.');
    const extended = [parts[0], parts[1], String(Number(parts[2]) + 999999), parts[3]].join('.');
    for (const bad of [extended, 'abc', `${parts.join('.')}.x`]) expect(() => verifyState(bad)).toThrowError(/could not be verified/);
  });
});
