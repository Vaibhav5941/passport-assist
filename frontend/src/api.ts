// The browser keeps no application state of its own: everything is re-read from the API,
// and the only credential is an HttpOnly cookie that scripts cannot read.
import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, string[]> = {}) {
    super(message);
  }
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown; file?: File; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'passport-assist', ...options.headers };
  let body: BodyInit | undefined;
  if (options.file) { headers['content-type'] = options.file.type || 'application/octet-stream'; body = options.file; }
  else if (options.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(options.body); }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method: options.method ?? 'GET', headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check that the API is running.');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? 'The server is not responding.', data?.error?.details);
  }
  return data as T;
}

/** Loads a resource and refreshes it when the window regains focus (another device may have changed it). */
export function useResource<T = any>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: ApiError }>({ path: null });
  const reload = useCallback(async () => {
    if (!path) return;
    try { setState({ path, data: await api<T>(path) }); }
    catch (error) { setState({ path, error: error as ApiError }); }
  }, [path]);
  useEffect(() => {
    void reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  const current = state.path === path;
  return { data: current ? state.data : undefined, error: current ? state.error : undefined, loading: !current, reload };
}
