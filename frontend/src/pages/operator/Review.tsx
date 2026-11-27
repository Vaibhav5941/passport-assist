import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useResource } from '../../api';
import { Timeline } from '../../components/Timeline';
import { ActionError, Alert, Chip, Loaded, PageHeader, SimulatedBadge, SimulatedWarning, Transitions, useAction } from '../../components/ui';
import { applicationTitle, dateTime, SOURCE_LABEL } from '../../format';

function ReviewItem({ applicationId, item, canDecide, reload }: { applicationId: string; item: any; canDecide: boolean; reload: () => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const action = useAction();
  const decide = async (decision: 'ACCEPT' | 'REJECT') => {
    const ok = await action.run(() => api(`/operator/applications/${applicationId}/documents/${item.id}/review`, { method: 'POST', body: { decision, reason: decision === 'REJECT' ? reason : undefined, seenUpdatedAt: item.updatedAt } }));
    if (ok) setRejecting(false);
    await reload();
  };
  return (
    <li className="card">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{item.name}</h3><Chip status={item.status} /></div>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">Source</dt><dd>{item.source ? SOURCE_LABEL[item.source] : 'Not provided'}</dd></div>
        <div><dt className="text-muted">Details</dt><dd>{[item.issuer, item.maskedIdentifier, item.issuedOn && `Issued ${item.issuedOn}`, item.validUntil && `Valid to ${item.validUntil}`, item.mimeType, item.sizeBytes && `${item.sizeBytes} bytes`].filter(Boolean).join(' · ') || 'None'}</dd></div>
        <div><dt className="text-muted">Last updated</dt><dd>{dateTime(item.updatedAt)}</dd></div>
      </dl>
      <p className="mt-2 text-sm"><span className="text-muted">Next action: </span>{item.nextAction}</p>
      {item.source === 'UPLOAD' && <p className="mt-2 text-sm text-wait">Uploaded file contents are not stored, so only metadata can be reviewed in this demo.</p>}
      {item.rejectionReason && <div className="mt-2"><Alert tone="bad"><strong>Reason:</strong> {item.rejectionReason}</Alert></div>}
      {canDecide && item.status !== 'MISSING' && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <button className="btn-primary" disabled={action.busy || item.status !== 'PENDING'} onClick={() => void decide('ACCEPT')}>Accept</button>
            <button className="btn-danger" disabled={action.busy} aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>Reject</button>
          </div>
          {rejecting && (
            <form onSubmit={(e) => { e.preventDefault(); void decide('REJECT'); }}>
              <label className="label">Reason for rejection (the applicant will see this)<textarea className="input" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
              <button className="btn-primary mt-2" disabled={action.busy || !reason.trim()}>Confirm rejection</button>
            </form>
          )}
        </div>
      )}
      <ActionError error={action.error} />
    </li>
  );
}

export function Review() {
  const { id } = useParams();
  const resource = useResource(`/applications/${id}`);
  const action = useAction();
  return (
    <Loaded resource={resource}>
      {(d: any) => (
        <>
          <PageHeader title={`Package review · ${d.application.reference}`} description={applicationTitle(d.application)}><SimulatedBadge /></PageHeader>
          <div className="space-y-4">
            <SimulatedWarning />
            <section className="card">
              <div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold">Applicant</h2><Chip status={d.application.status} /></div>
              {d.profile && <p className="mt-1">{d.profile.fullName} · Born {d.profile.dateOfBirth} · {d.profile.city}, {d.profile.state}</p>}
              <p className="mt-1 text-sm text-muted">DigiLocker consent: {!d.consent ? 'not granted' : d.consent.withdrawnAt ? `withdrawn on ${dateTime(d.consent.withdrawnAt)}` : `granted on ${dateTime(d.consent.grantedAt)}`}</p>
              <Link className="link mt-2 inline-block" to={`/operator/applications/${id}/audit`}>View history and audit trail</Link>
            </section>
            <section className="card space-y-3">
              <h2 className="font-bold">Status actions</h2>
              <ActionError error={action.error} />
              <Transitions actions={d.actions} busy={action.busy} onRun={async (to, reason) => {
                const ok = await action.run(() => api(`/applications/${id}/transitions`, { method: 'POST', body: { to, reason, expectedVersion: d.application.version } }));
                await resource.reload();
                return ok;
              }} />
            </section>
            <ul className="space-y-3">{d.checklist.map((item: any) => <ReviewItem key={item.id} applicationId={id!} item={item} canDecide={d.application.status === 'UNDER_REVIEW'} reload={resource.reload} />)}</ul>
            <section className="card"><h2 className="mb-4 font-bold">Application history (simulated)</h2><Timeline events={d.timeline} /></section>
          </div>
        </>
      )}
    </Loaded>
  );
}
