export type Role = 'APPLICANT' | 'OPERATOR';
export type ActorRole = Role | 'SYSTEM';
export type ApplicationStatus =
  | 'DRAFT' | 'DOCUMENTS_PENDING' | 'READY_FOR_REVIEW' | 'UNDER_REVIEW'
  | 'CORRECTION_REQUIRED' | 'SUBMITTED_SIMULATED' | 'CLOSED';
export type ChecklistStatus = 'MISSING' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface User { id: string; email: string; displayName: string; role: Role; region: string }

export interface RequestContext { user: User; correlationId: string }

export interface Application {
  id: string; reference: string; applicantId: string; type: 'FRESH' | 'REISSUE';
  scenario: 'STANDARD' | 'EXPIRING' | 'LOST_OR_DAMAGED'; region: string;
  status: ApplicationStatus; version: number; sentForReviewAt: Date | null;
  createdAt: Date; updatedAt: Date;
}

export interface ChecklistItem {
  id: string; applicationId: string; requirementId: string; code: string; name: string;
  description: string; required: boolean; rules: RequirementRules; status: ChecklistStatus;
  source: 'DIGILOCKER' | 'UPLOAD' | null; providerDocRef: string | null; consentId: string | null;
  issuer: string | null; maskedIdentifier: string | null; issuedOn: string | null;
  validUntil: string | null; mimeType: string | null; sizeBytes: number | null;
  rejectionReason: string | null; accessRevokedAt: Date | null; updatedAt: Date;
}

export interface RequirementRules { notExpired?: boolean; maxAgeMonths?: number; nameMustMatch?: boolean }
