import { useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { STATUS_LABEL } from '../format';

const TONE: Record<string, string> = {
  VERIFIED: 'bg-ok-soft text-ok', SUBMITTED_SIMULATED: 'bg-ok-soft text-ok',
  PENDING: 'bg-wait-soft text-wait', DOCUMENTS_PENDING: 'bg-wait-soft text-wait', CORRECTION_REQUIRED: 'bg-wait-soft text-wait',
  REJECTED: 'bg-bad-soft text-bad', DENIED: 'bg-bad-soft text-bad', FAILURE: 'bg-wait-soft text-wait', SUCCESS: 'bg-ok-soft text-ok',
  READY_FOR_REVIEW: 'bg-brand-soft text-brand-dark', UNDER_REVIEW: 'bg-brand-soft text-brand-dark',
};

export const Chip = ({ status, label }: { status: string; label?: string }) => (
  <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${TONE[status] ?? 'bg-slate-100 text-slate-700'}`}>
    {label ?? STATUS_LABEL[status] ?? status}
  </span>
);

export const SimulatedBadge = () => (
  <p className="inline-flex items-center gap-2 rounded-lg border border-wait/30 bg-wait-soft px-3 py-1.5 text-sm font-bold text-wait">
    <span aria-hidden className="size-2 rounded-full bg-wait" />
    Simulated. Not the official passport system
  </p>
);

export const SimulatedWarning = () => (
  <Alert tone="wait">Simulated submission. No real application has been filed.</Alert>
);

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'wait' | 'bad'; children: ReactNode }) {
  const style = { info: 'bg-brand-soft border-brand/30', ok: 'bg-ok-soft border-ok/30', wait: 'bg-wait-soft border-wait/30', bad: 'bg-bad-soft border-bad/30' }[tone];
  return <div role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${style}`}>{children}</div>;
}

export const PageHeader = ({ title, description, children }: { title: string; description: string; children?: ReactNode }) => (
  <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 max-w-2xl text-muted">{description}</p>
    </div>
    {children}
  </header>
);

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="card text-center">
    <p className="font-semibold">{title}</p>
    {children && <div className="mt-2 text-sm text-muted">{children}</div>}
  </div>
);

/** Shared loading and error states. */
export function Loaded<T>({ resource, children }: { resource: { data?: T; error?: ApiError; loading: boolean; reload: () => void }; children: (data: T) => ReactNode }) {
  if (resource.error) {
    return (
      <Alert tone="bad">
        <p>{resource.error.message}</p>
        <button className="btn-secondary mt-2" onClick={resource.reload}>Try again</button>
      </Alert>
    );
  }
  if (resource.data === undefined) return <p role="status" className="card animate-pulse text-muted">Loading…</p>;
  return <>{children(resource.data)}</>;
}

/** Tracks one in-flight action so buttons disable and errors are shown. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(undefined);
    try { await work(); return true; }
    catch (e) { setError(e as ApiError); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}

export const ActionError = ({ error }: { error?: ApiError }) => (error ? <Alert tone="bad">{error.message}</Alert> : null);

export interface ServerAction { to: string; label: string; reasonRequired: boolean; enabled: boolean; blockedBecause: string | null }

/** Renders the actions the server offers. The server validates again on submit. */
export function Transitions({ actions, onRun, busy }: { actions: ServerAction[]; busy: boolean; onRun: (to: string, reason?: string) => Promise<boolean> }) {
  const [open, setOpen] = useState<string>();
  const [reason, setReason] = useState('');
  if (!actions.length) return <p className="text-sm text-muted">No status actions are available to you right now.</p>;
  return (
    <div className="space-y-3">
      {actions.map((a) => (
        <div key={a.to}>
          <button
            className={a.to === 'CLOSED' ? 'btn-danger' : 'btn-primary'} disabled={!a.enabled || busy}
            onClick={() => (a.reasonRequired ? (setOpen(a.to), setReason('')) : void onRun(a.to))}
          >{a.label}</button>
          {a.blockedBecause && <p className="mt-1 text-sm text-muted">{a.blockedBecause}</p>}
          {open === a.to && (
            <form className="mt-2 space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await onRun(a.to, reason)) setOpen(undefined); }}>
              <label className="label">Reason (shown to the applicant)
                <textarea className="input" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </label>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy || !reason.trim()}>Confirm</button>
                <button type="button" className="btn-secondary" onClick={() => setOpen(undefined)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
