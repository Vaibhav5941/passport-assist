import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, useResource } from '../../api';
import { ActionError, Alert, Chip, Loaded, PageHeader, useAction } from '../../components/ui';

const STEPS = ['Consent', 'Connect', 'Authorise', 'Select documents', 'Done'];

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-5 flex flex-wrap gap-2" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} aria-current={i === current ? 'step' : undefined}
          className={`rounded-full border px-3 py-1 text-sm font-semibold ${i < current ? 'border-ok/30 bg-ok-soft text-ok' : i === current ? 'border-brand bg-brand text-white' : 'border-line bg-white text-muted'}`}>
          {i + 1}. {label}{i < current && <span className="sr-only"> complete</span>}
        </li>
      ))}
    </ol>
  );
}

function Unavailable({ message, onRetry, uploadTo, busy }: { message: string; onRetry: () => void; uploadTo: string; busy?: boolean }) {
  return (
    <div className="card border-bad/40" role="alert">
      <h2 className="text-lg font-bold text-bad">Provider unavailable</h2>
      <p className="mt-1">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={onRetry} disabled={busy}>Retry</button>
        <Link className="btn-secondary" to={uploadTo}>Upload instead</Link>
      </div>
    </div>
  );
}

function OutageSwitch() {
  const [down, setDown] = useState(false);
  const action = useAction();
  return (
    <div className="mt-6 rounded-lg border border-dashed border-line p-3 text-sm">
      <label className="flex gap-2"><input type="checkbox" checked={down} disabled={action.busy} onChange={(e) => { const next = e.target.checked; setDown(next); void action.run(() => api('/mock-provider/outage', { method: 'POST', body: { unavailable: next } })).then((ok) => ok || setDown(!next)); }} />
        Demo control: simulate provider outage for my account</label>
      <ActionError error={action.error} />
    </div>
  );
}

function Selection({ d, reload }: { d: any; reload: () => Promise<void> }) {
  const id = d.application.id;
  const found = useResource(`/applications/${id}/digilocker/documents`);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [results, setResults] = useState<any[]>();
  const action = useAction();
  const checklist = `/applications/${id}/checklist`;

  if (results) {
    return (<><Stepper current={4} /><section className="card space-y-3"><h2 className="font-bold">Documents linked</h2>
      {results.map((r) => (<div key={r.code} className="border-t border-line pt-3">
        <div className="flex items-center justify-between gap-2"><span>{d.checklist.find((i: any) => i.code === r.code)?.name}</span><Chip status={r.status} /></div>
        {r.reason && <p className="mt-1 text-sm text-bad">{r.reason}</p>}</div>))}
      <p className="text-sm text-muted">Pending means an operator still has to verify it.</p>
      <div className="flex flex-wrap gap-2"><Link className="btn-primary" to={checklist}>Go to checklist</Link><button className="btn-secondary" onClick={() => { setResults(undefined); setPicked({}); }}>Choose again</button></div>
    </section></>);
  }
  const unavailable = [found.error, action.error].find((e) => e?.code === 'PROVIDER_UNAVAILABLE');
  const chosen = Object.values(picked).filter(Boolean);
  const link = () => void action.run(async () => { setResults((await api(`/applications/${id}/digilocker/link`, { method: 'POST', body: { docRefs: chosen } })).results); await reload(); window.dispatchEvent(new Event('notifications-changed')); });
  return (
    <>
      <Stepper current={3} />
      {unavailable ? <Unavailable message={unavailable.message} uploadTo={checklist} onRetry={() => void (found.error ? found.reload() : link())} /> : (
        <Loaded resource={found}>
          {(f: any) => (
            <section className="card space-y-4">
              <h2 className="font-bold">Select one document per item</h2>
              {d.checklist.filter((i: any) => d.consent.scopes.includes(i.code)).map((item: any) => (
                <fieldset key={item.id} className="border-t border-line pt-3" disabled={item.status === 'VERIFIED'}>
                  <legend className="font-semibold">{item.name} {item.status === 'VERIFIED' && <Chip status="VERIFIED" />}</legend>
                  {f.documents.filter((x: any) => x.code === item.code).map((x: any) => (
                    <label key={x.docRef} className="mt-2 flex gap-3 rounded-lg border border-line p-3">
                      <input type="radio" className="mt-1 size-4" name={item.code} checked={picked[item.code] === x.docRef} onChange={() => setPicked({ ...picked, [item.code]: x.docRef })} />
                      <span><span className="font-semibold">{x.title}</span><span className="block text-sm text-muted">{x.issuer} · {x.maskedIdentifier} · Issued {x.issuedOn}{x.validUntil && ` · Valid until ${x.validUntil}`}</span></span>
                    </label>
                  ))}
                </fieldset>
              ))}
              <ActionError error={action.error} />
              <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={!chosen.length || action.busy} onClick={link}>Link selected ({chosen.length})</button><Link className="btn-secondary" to={checklist}>Upload instead</Link></div>
            </section>
          )}
        </Loaded>
      )}
    </>
  );
}

export function DigiLocker() {
  const { id } = useParams();
  const resource = useResource(`/applications/${id}`);
  const navigate = useNavigate();
  const action = useAction();
  const checklist = `/applications/${id}/checklist`;
  const connect = () => void action.run(async () => {
    const r = await api(`/applications/${id}/digilocker/connect`, { method: 'POST' });
    if (r.alreadyConnected) await resource.reload();
    else navigate(r.authorizationUrl);
  });
  return (
    <>
      <PageHeader title="DigiLocker (simulated)" description="A mock provider with synthetic documents. No real DigiLocker account is used." />
      <Loaded resource={resource}>
        {(d: any) => {
          const active = d.consent && !d.consent.withdrawnAt;
          if (!active) return (<><Stepper current={0} /><div className="card"><p>Consent is required before connecting.</p><Link className="btn-primary mt-3" to={`/applications/${id}/consent`}>Review consent</Link></div></>);
          if (!d.editable) return <Alert>Documents cannot be changed at this stage. <Link className="link" to={checklist}>Back to checklist</Link></Alert>;
          return (
            <>
              {d.connection?.status === 'CONNECTED' ? <Selection d={d} reload={resource.reload} /> : (
                <>
                  <Stepper current={1} />
                  {action.error?.code === 'PROVIDER_UNAVAILABLE'
                    ? <Unavailable message={action.error.message} onRetry={connect} busy={action.busy} uploadTo={checklist} />
                    : <section className="card space-y-3"><h2 className="font-bold">Connect your account</h2><p>You will be sent to a simulated provider page to authorise access.</p><ActionError error={action.error} />
                        <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={action.busy} onClick={connect}>{action.busy ? 'Connecting…' : 'Connect DigiLocker'}</button><Link className="btn-secondary" to={checklist}>Upload instead</Link></div></section>}
                </>
              )}
              <OutageSwitch />
            </>
          );
        }}
      </Loaded>
    </>
  );
}

/** Stands in for the provider's own consent page. The callback is returned in a POST body, not a URL. */
export function Authorize() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const action = useAction();
  const [callback, setCallback] = useState<object>();
  const state = params.get('state') ?? '';
  const applicationId = state.split('.')[1] ?? '';
  const approve = () => void action.run(async () => {
    // Kept in memory so a retry redelivers the same callback, which the server treats idempotently.
    const payload = callback ?? (await api('/mock-provider/authorize', { method: 'POST', body: { state } }));
    setCallback(payload);
    await api('/digilocker/callback', { method: 'POST', body: payload });
    navigate(`/applications/${applicationId}/digilocker`, { replace: true });
  });
  const error = action.error as ApiError | undefined;
  return (
    <>
      <Stepper current={2} />
      <section className="card mx-auto max-w-lg border-2 border-dashed border-brand/50">
        <p className="text-sm font-bold uppercase text-wait">Mock provider page · not DigiLocker</p>
        <h1 className="mt-2 text-xl font-bold">Allow Passport Assist to read document details?</h1>
        <p className="mt-2 text-muted">Requested: {(params.get('scope') ?? '').split(' ').map((c) => c.replaceAll('_', ' ').toLowerCase()).join(', ')}. No password or OTP is asked for.</p>
        <div className="mt-3"><ActionError error={error} /></div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={action.busy || !state} onClick={approve}>{error ? 'Retry' : 'Allow access'}</button>
          <Link className="btn-secondary" to={applicationId ? `/applications/${applicationId}/checklist` : '/'}>{error ? 'Upload instead' : 'Cancel'}</Link>
        </div>
      </section>
    </>
  );
}
