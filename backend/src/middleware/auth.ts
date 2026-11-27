import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { one, pool, query } from '../lib/db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { AppError, forbidden } from '../lib/errors.js';
import type { RequestContext, Role, User } from '../domain/types.js';

const COOKIE = 'pa_session';
const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: config.isProduction, path: '/api' };

export function readSessionToken(req: Request) {
  return req.headers.cookie?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

export async function startSession(res: Response, userId: string) {
  const token = randomToken(32);
  await query(pool, 'DELETE FROM sessions WHERE expires_at < now()');
  await query(pool, 'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)',
    [sha256(token), userId, new Date(Date.now() + config.sessionTtlMs)]);
  res.cookie(COOKIE, token, { ...cookieOptions, maxAge: config.sessionTtlMs });
}

export async function endSession(req: Request, res: Response) {
  const token = readSessionToken(req);
  if (token) await query(pool, 'DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.clearCookie(COOKIE, cookieOptions);
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = readSessionToken(req);
  const user = token
    ? await one<User>(pool, `SELECT u.id, u.email, u.display_name, u.role, u.region FROM sessions s
        JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)])
    : undefined;
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
  res.locals.user = user;
  next();
}

export const requireRole = (role: Role) => (_req: Request, res: Response, next: NextFunction) => {
  if ((res.locals.user as User).role !== role) throw forbidden();
  next();
};

export const contextOf = (res: Response): RequestContext => ({
  user: res.locals.user as User,
  correlationId: res.locals.correlationId as string,
});
