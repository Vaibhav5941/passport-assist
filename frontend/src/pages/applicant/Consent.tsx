import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useResource } from '../../api';
import { ActionError, Alert, Loaded, PageHeader, useAction } from '../../components/ui';
import { dateTime } from '../../format';

const WITHDRAW_TEXT = 'You can withdraw consent at any time. Linked documents will no longer be accessible to this application.';

function ConsentView({ d, reload }: { d: any; reload: () => Promise<void> }) {
  const id = d.application.id;
  const navigate = useNavigate();
  const action = useAction();
  const [scopes, setScopes] = useState<string[]>(d.checklist.map((i: any) => i.code));
  const [agreed, setAgreed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const active = d.consent && !d.consent.withdrawnAt;
  const nameOf = (code: string) => d.checklist.find((i: any) => i.code === code)?.name ?? code;

  return (
    <div className="space-y-4">
      {d.consent?.withdrawnAt && <Alert tone="wait">Consent withdrawn on {dateTime(d.consent.withdrawnAt)}. Linked DigiLocker documents are no longer accessible. You can <Link className="link" to={`/applications/${id}/checklist`}>upload instead</Link> or grant consent again.</Alert>}
      <section className="card">
        <h2 className="text-lg font-bold">Consent to use DigiLocker (simulated)</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div><dt className="font-bold">Why we ask</dt><dd>To fetch document details and prepare this one passport assistance application. They are not used for anything else.</dd></div>
          <div><dt className="font-bold">What is accessed</dt><dd>For the document types you select: title, issuer, masked identifier, issue date, validity date and holder name (used once for the name check). Document files, passwords, OTPs and access tokens are never stored.</dd></div>
          <div><dt className="font-bold">How long it is kept</dt><dd>References and metadata stay with this application until you withdraw consent. This demo has no automatic expiry. Audit records of actions are kept and contain no document details.</dd></div>
          <div><dt className="font-bold">How withdrawal works</dt><dd>Linked references and metadata are deleted immediately. Those checklist items return to Missing, even if verified. If your application was in review, it returns to Documents Pending. Files you uploaded yourself are not affected.</dd></div>
        </dl>
        <p className="mt-4 rounded-lg bg-brand-soft p-3 font-semibold">{WITHDRAW_TEXT}</p>

        {active ? (
          <div className="mt-4 space-y-3">
            <Alert tone="ok">Consent granted on {dateTime(d.consent.grantedAt)} for: {d.consent.scopes.map(nameOf).join(', ')}.</Alert>
            {confirming ? (
              <div className="rounded-lg border border-bad/40 p-3">
                <p className="font-semibold">Withdraw consent and delete linked DigiLocker details?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn-danger" disabled={action.busy} onClick={() => void action.run(async () => { await api(`/applications/${id}/consent/withdraw`, { method: 'POST' }); setConfirming(false); await reload(); window.dispatchEvent(new Event('notifications-changed')); })}>Yes, withdraw consent</button>
                  <button className="btn-secondary" onClick={() => setConfirming(false)}>Keep consent</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {d.editable && <Link className="btn-primary" to={`/applications/${id}/digilocker`}>Continue to DigiLocker</Link>}
                <button className="btn-danger" onClick={() => setConfirming(true)}>Withdraw consent</button>
              </div>
            )}
          </div>
        ) : d.editable ? (
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void action.run(async () => { await api(`/applications/${id}/consent`, { method: 'POST', body: { accepted: agreed, scopes } }); navigate(`/applications/${id}/digilocker`); }); }}>
            <fieldset>
              <legend className="font-bold">Document types to share</legend>
              {d.checklist.map((i: any) => (
                <label key={i.code} className="mt-2 flex gap-2"><input type="checkbox" className="mt-1 size-4" checked={scopes.includes(i.code)} onChange={(e) => setScopes(e.target.checked ? [...scopes, i.code] : scopes.filter((s) => s !== i.code))} />{i.name}</label>
              ))}
            </fieldset>
            <label className="flex gap-2 border-t border-line pt-3 font-semibold"><input type="checkbox" className="mt-1 size-4" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />I give consent for the purpose and document types above.</label>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={!agreed || !scopes.length || action.busy}>Give consent</button>
              <Link className="btn-secondary" to={`/applications/${id}/checklist`}>Not now, I will upload</Link>
            </div>
          </form>
        ) : <p className="mt-4 text-sm text-muted">Consent can be granted while documents are pending or a correction is required.</p>}
        <div className="mt-3"><ActionError error={action.error} /></div>
      </section>
      <Link className="link" to={`/applications/${id}/checklist`}>Back to checklist</Link>
    </div>
  );
}

export function Consent() {
  const { id } = useParams();
  const resource = useResource(`/applications/${id}`);
  return (
    <>
      <PageHeader title="Consent" description="You decide what is shared, and you can change your mind." />
      <Loaded resource={resource}>{(d: any) => <ConsentView key={d.application.id} d={d} reload={resource.reload} />}</Loaded>
    </>
  );
}
