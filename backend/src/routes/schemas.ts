import { z } from 'zod';

const text = (min: number, max: number) => z.string().trim().min(min, `Enter at least ${min} characters.`).max(max, `Use at most ${max} characters.`);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v), 'Enter a valid date.');

export const loginSchema = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().min(1).max(200) }).strict();

export const profileSchema = z.object({
  fullName: text(2, 100),
  dateOfBirth: isoDate.refine((v) => v <= new Date().toISOString().slice(0, 10) && v >= '1900-01-01', 'Enter a date between 1900 and today.'),
  phone: z.string().trim().regex(/^[0-9]{10}$/, 'Enter a 10 digit phone number.'),
  addressLine: text(5, 200),
  city: text(2, 80),
  state: text(2, 80),
  postalCode: z.string().trim().regex(/^[0-9]{6}$/, 'Enter a 6 digit PIN code.'),
}).strict();

export const createApplicationSchema = z.object({
  type: z.enum(['FRESH', 'REISSUE']),
  scenario: z.enum(['STANDARD', 'EXPIRING', 'LOST_OR_DAMAGED']),
}).strict().refine((v) => (v.type === 'FRESH') === (v.scenario === 'STANDARD'), { message: 'The scenario does not match the application type.', path: ['scenario'] });

const status = z.enum(['DRAFT', 'DOCUMENTS_PENDING', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'SUBMITTED_SIMULATED', 'CLOSED']);

export const transitionSchema = z.object({ to: status, reason: z.string().trim().max(500).optional(), expectedVersion: z.number().int().positive() }).strict();
export const queueSchema = z.object({ status: status.optional() });
export const consentSchema = z.object({ accepted: z.literal(true, { message: 'Consent must be given explicitly.' }), scopes: z.array(z.string().max(40)).min(1, 'Select at least one document type.').max(10) }).strict();
export const callbackSchema = z.object({ state: z.string().max(500), code: z.string().max(200), signature: z.string().max(200) }).strict();
export const authorizeSchema = z.object({ state: z.string().max(500) }).strict();
export const linkSchema = z.object({ docRefs: z.array(z.string().max(60)).min(1).max(10) }).strict();
export const reviewSchema = z.object({ decision: z.enum(['ACCEPT', 'REJECT']), reason: z.string().trim().max(500).optional(), seenUpdatedAt: z.string().max(40) }).strict();
export const uploadDateSchema = isoDate.nullable();
export const outageSchema = z.object({ unavailable: z.boolean() }).strict();
