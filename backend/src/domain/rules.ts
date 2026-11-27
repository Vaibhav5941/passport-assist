// Checklist rules, applied to document metadata. Pure functions.
import type { RequirementRules } from './types.js';

export interface DocumentFacts { holderName?: string; issuedOn?: string | null; validUntil?: string | null }

const normalise = (name: string) => name.toLowerCase().replace(/\(synthetic\)/g, '').replace(/[^a-z]/g, '');

/** Returns plain-language failures. An empty list means the rules pass. */
export function checkRules(rules: RequirementRules, doc: DocumentFacts, profileName: string, now = new Date()): string[] {
  const failures: string[] = [];
  const today = now.toISOString().slice(0, 10);

  if (rules.nameMustMatch && doc.holderName !== undefined && normalise(doc.holderName) !== normalise(profileName)) {
    failures.push('The name on this document does not match the name in your profile.');
  }
  if (doc.validUntil && doc.validUntil < today) {
    failures.push(`This document expired on ${doc.validUntil}.`);
  } else if (rules.notExpired && !doc.validUntil) {
    failures.push('This document needs a validity date.');
  }
  if (rules.maxAgeMonths) {
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - rules.maxAgeMonths);
    if (!doc.issuedOn) failures.push('This document needs an issue date.');
    else if (doc.issuedOn < cutoff.toISOString().slice(0, 10)) {
      failures.push(`This document was issued on ${doc.issuedOn}. It must be from the last ${rules.maxAgeMonths} months.`);
    }
  }
  if (doc.issuedOn && doc.issuedOn > today) failures.push('The issue date cannot be in the future.');
  return failures;
}
