// The single source of truth for application status changes. Pure, no I/O.
import type { ActorRole, ApplicationStatus, ChecklistItem } from './types.js';

export type Guard = 'PROFILE_COMPLETE' | 'DOCUMENTS_PROVIDED' | 'HAS_REJECTED_ITEM' | 'ALL_VERIFIED';

export interface Transition {
  from: ApplicationStatus; to: ApplicationStatus; roles: ActorRole[];
  label: string; reasonRequired?: boolean; guard?: Guard;
}

export const TRANSITIONS: readonly Transition[] = [
  { from: 'DRAFT', to: 'DOCUMENTS_PENDING', roles: ['APPLICANT'], label: 'Start document collection', guard: 'PROFILE_COMPLETE' },
  { from: 'DRAFT', to: 'CLOSED', roles: ['APPLICANT'], label: 'Close application', reasonRequired: true },
  { from: 'DOCUMENTS_PENDING', to: 'READY_FOR_REVIEW', roles: ['APPLICANT'], label: 'Send for review', guard: 'DOCUMENTS_PROVIDED' },
  { from: 'DOCUMENTS_PENDING', to: 'CLOSED', roles: ['APPLICANT'], label: 'Close application', reasonRequired: true },
  { from: 'READY_FOR_REVIEW', to: 'UNDER_REVIEW', roles: ['OPERATOR'], label: 'Start review' },
  { from: 'READY_FOR_REVIEW', to: 'DOCUMENTS_PENDING', roles: ['SYSTEM'], label: 'Return for documents' },
  { from: 'UNDER_REVIEW', to: 'CORRECTION_REQUIRED', roles: ['OPERATOR'], label: 'Request corrections', reasonRequired: true, guard: 'HAS_REJECTED_ITEM' },
  { from: 'UNDER_REVIEW', to: 'SUBMITTED_SIMULATED', roles: ['OPERATOR'], label: 'Mark submitted (simulated)', guard: 'ALL_VERIFIED' },
  { from: 'UNDER_REVIEW', to: 'DOCUMENTS_PENDING', roles: ['SYSTEM'], label: 'Return for documents' },
  { from: 'UNDER_REVIEW', to: 'CLOSED', roles: ['OPERATOR'], label: 'Close application', reasonRequired: true },
  { from: 'CORRECTION_REQUIRED', to: 'READY_FOR_REVIEW', roles: ['APPLICANT'], label: 'Resend for review', guard: 'DOCUMENTS_PROVIDED' },
  { from: 'CORRECTION_REQUIRED', to: 'DOCUMENTS_PENDING', roles: ['SYSTEM'], label: 'Return for documents' },
  { from: 'CORRECTION_REQUIRED', to: 'CLOSED', roles: ['OPERATOR'], label: 'Close application', reasonRequired: true },
  { from: 'SUBMITTED_SIMULATED', to: 'CLOSED', roles: ['OPERATOR'], label: 'Close application', reasonRequired: true },
];

export interface GuardFacts { profileComplete: boolean; items: Pick<ChecklistItem, 'required' | 'status'>[] }

const GUARDS: Record<Guard, { passes: (f: GuardFacts) => boolean; message: string }> = {
  PROFILE_COMPLETE: { passes: (f) => f.profileComplete, message: 'Complete your applicant profile first.' },
  DOCUMENTS_PROVIDED: {
    passes: (f) =>
      f.items.every((i) => i.status !== 'REJECTED') &&
      f.items.every((i) => !i.required || i.status === 'PENDING' || i.status === 'VERIFIED'),
    message: 'Provide every required document and replace rejected ones first.',
  },
  HAS_REJECTED_ITEM: { passes: (f) => f.items.some((i) => i.status === 'REJECTED'), message: 'Reject at least one document before requesting corrections.' },
  ALL_VERIFIED: {
    passes: (f) => f.items.length > 0 && f.items.every((i) => i.status === 'VERIFIED' || (!i.required && i.status === 'MISSING')),
    message: 'Every required document must be verified first.',
  },
};

export type Decision =
  | { allowed: true; transition: Transition }
  | { allowed: false; code: 'INVALID_TRANSITION' | 'ROLE_NOT_PERMITTED' | 'REASON_REQUIRED' | 'GUARD_FAILED'; message: string };

export function evaluateTransition(
  from: ApplicationStatus, to: ApplicationStatus, role: ActorRole, reason: string | undefined, facts: GuardFacts,
): Decision {
  const transition = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!transition) return { allowed: false, code: 'INVALID_TRANSITION', message: `Cannot move from ${from} to ${to}.` };
  if (!transition.roles.includes(role)) return { allowed: false, code: 'ROLE_NOT_PERMITTED', message: 'Your role cannot perform this status change.' };
  if (transition.reasonRequired && !reason?.trim()) return { allowed: false, code: 'REASON_REQUIRED', message: 'A reason is required for this action.' };
  if (transition.guard && !GUARDS[transition.guard].passes(facts)) {
    return { allowed: false, code: 'GUARD_FAILED', message: GUARDS[transition.guard].message };
  }
  return { allowed: true, transition };
}

/** Actions a role may attempt now; used only to render buttons. The server re-checks on write. */
export function availableActions(from: ApplicationStatus, role: ActorRole, facts: GuardFacts) {
  return TRANSITIONS.filter((t) => t.from === from && t.roles.includes(role)).map((t) => {
    const guard = t.guard ? GUARDS[t.guard] : undefined;
    const enabled = !guard || guard.passes(facts);
    return { to: t.to, label: t.label, reasonRequired: !!t.reasonRequired, enabled, blockedBecause: enabled ? null : guard!.message };
  });
}
