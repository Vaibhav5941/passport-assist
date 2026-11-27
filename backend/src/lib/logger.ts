// Structured logs built from an allow-list of fields. Bodies, query strings,
// cookies and headers are never passed in, so they cannot leak.
import { config } from '../config.js';

type Fields = { correlationId?: string; method?: string; path?: string; status?: number; code?: string; error?: string };

export function log(level: 'info' | 'error', message: string, fields: Fields = {}) {
  if (config.isTest) return;
  console.log(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
}
