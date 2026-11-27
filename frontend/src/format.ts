export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', DOCUMENTS_PENDING: 'Documents Pending', READY_FOR_REVIEW: 'Ready for Review', UNDER_REVIEW: 'Under Review',
  CORRECTION_REQUIRED: 'Correction Required', SUBMITTED_SIMULATED: 'Submitted (simulated)', CLOSED: 'Closed',
  MISSING: 'Missing', PENDING: 'Pending', VERIFIED: 'Verified', REJECTED: 'Rejected',
};
export const TYPE_LABEL: Record<string, string> = {
  FRESH: 'Fresh passport', REISSUE: 'Re-issue', STANDARD: 'Standard', EXPIRING: 'Expiring or expired', LOST_OR_DAMAGED: 'Lost or damaged',
};
export const SOURCE_LABEL: Record<string, string> = { DIGILOCKER: 'DigiLocker (simulated)', UPLOAD: 'Upload' };
export const dateTime = (value: string) => new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const sentence = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_', ' ');
export const applicationTitle = (a: { type: string; scenario: string }) =>
  a.type === 'FRESH' ? TYPE_LABEL.FRESH! : `${TYPE_LABEL.REISSUE}: ${TYPE_LABEL[a.scenario]!.toLowerCase()}`;
