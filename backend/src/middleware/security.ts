import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { log } from '../lib/logger.js';

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const correlationId = randomUUID(); // always server-generated
  res.locals.correlationId = correlationId;
  res.set({
    'X-Correlation-Id': correlationId,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  const path = req.path; // no query string
  res.on('finish', () => log('info', 'request', { correlationId, method: req.method, path, status: res.statusCode }));
  next();
}

/** CSRF defence on top of SameSite=Strict: a custom header plus an Origin check. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (req.get('x-requested-with') !== 'passport-assist' || (origin && origin !== config.webOrigin)) {
    throw new AppError(403, 'CSRF_REJECTED', 'The request could not be verified.');
  }
  next();
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const correlationId = res.locals.correlationId as string;
  let status = 500;
  let body: { code: string; message: string; details?: unknown } = { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' };

  if (error instanceof AppError) {
    status = error.status;
    body = { code: error.code, message: error.message, details: error.details };
  } else if (error instanceof ZodError) {
    status = 400;
    body = { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', details: error.flatten().fieldErrors };
  } else if ((error as { type?: string }).type === 'entity.too.large') {
    status = 413;
    body = { code: 'FILE_TOO_LARGE', message: 'The request is too large.' };
  } else if ((error as { type?: string }).type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'INVALID_JSON', message: 'The request body is not valid.' };
  } else {
    // Only the error class is logged: database messages can contain row values.
    log('error', 'unhandled', { correlationId, error: error instanceof Error ? error.name : 'unknown' });
  }
  res.status(status).json({ error: { ...body, correlationId } });
}
