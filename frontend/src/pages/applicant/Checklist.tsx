import { Link, useParams } from 'react-router-dom';
import { api, useResource } from '../../api';
import { ActionError, Alert, Chip, Loaded, PageHeader, Transitions, useAction } from '../../components/ui';
import { applicationTitle, dateTime, SOURCE_LABEL } from '../../format';

export function Checklist() {
  const { id } = useParams();
  const resource = useResource(`/applications/${id}`);
  const action = useAction();
  return (
    <Loaded resource={resource}>
      {(d: any) => {
        const withdrawn = !!d.consent?.withdrawnAt;
        const active = d.consent && !withdrawn;
        return (
          <>
            <PageHeader title="Document checklist" description={`${applicationTitle(d.application)} · ${d.application.reference}`}>
              <Chip status={d.application.status} />
            </PageHeader>
            <div className="space-y-4">
              {withdrawn && <Alert tone="wait"><strong>Consent withdrawn on {dateTime(d.consent.withdrawnAt)}.</strong> Linked DigiLocker documents are no longer accessible. You can upload instead, or grant consent again.</Alert>}
              {d.application.status === 'DRAFT' && <Alert>Start document collection below to add documents.</Alert>}
              <div className="card flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold">DigiLocker (simulated)</h2>
                  <p className="text-sm text-muted">{active ? (d.connection?.status === 'CONNECTED' ? 'Connected with your consent.' : 'Consent given. Not connected yet.') : 'Fetch document details with your consent, or upload each file.'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {d.editable && <Link className="btn-primary" to={`/applications/${id}/${active ? 'digilocker' : 'consent'}`}>{active ? 'Open DigiLocker' : 'Review consent'}</Link>}
                  {active && <Link className="btn-secondary" to={`/applications/${id}/consent`}>Manage consent</Link>}
                </div>
              </div>
              <ul className="space-y-3">
                {d.checklist.map((item: any) => (
                  <li key={item.id} className="card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold">{item.name}</h3>
                        <p className="text-sm text-muted">{item.description}</p>
                      </div>
                      <Chip status={item.status} />
                    </div>
                    <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                      <div><dt className="text-muted">Source</dt><dd>{item.source ? SOURCE_LABEL[item.source] : 'Not added'}{item.maskedIdentifier && ` · ${item.maskedIdentifier}`}</dd></div>
                      <div><dt className="text-muted">Last updated</dt><dd>{dateTime(item.updatedAt)}</dd></div>
                      <div><dt className="text-muted">Next action</dt><dd className="font-semibold">{item.nextAction}</dd></div>
                    </dl>
                    {item.rejectionReason && <div className="mt-3"><Alert tone="bad"><strong>Reason:</strong> {item.rejectionReason}</Alert></div>}
                    {item.canProvide && <Link className="btn-secondary mt-3" to={`/applications/${id}/upload/${item.id}`}>Upload instead<span className="sr-only"> for {item.name}</span></Link>}
                  </li>
                ))}
              </ul>
              <section className="card space-y-3">
                <h2 className="font-bold">Application actions</h2>
                <ActionError error={action.error} />
                <Transitions actions={d.actions} busy={action.busy} onRun={async (to, reason) => {
                  const ok = await action.run(() => api(`/applications/${id}/transitions`, { method: 'POST', body: { to, reason, expectedVersion: d.application.version } }));
                  await resource.reload();
                  return ok;
                }} />
                <Link className="link block text-sm" to={`/applications/${id}/tracking`}>View tracking timeline</Link>
              </section>
            </div>
          </>
        );
      }}
    </Loaded>
  );
}
