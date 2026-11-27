import { Link, useParams } from 'react-router-dom';
import { useResource } from '../../api';
import { Chip, Empty, Loaded, PageHeader, SimulatedBadge } from '../../components/ui';
import { dateTime, sentence, STATUS_LABEL } from '../../format';

export function AuditTrail() {
  const { id } = useParams();
  const resource = useResource(`/operator/applications/${id}/audit`);
  return (
    <>
      <PageHeader title="Audit trail" description="Append-only record of actions on this application, newest first."><SimulatedBadge /></PageHeader>
      <Link className="link mb-4 inline-block" to={`/operator/applications/${id}`}>Back to package review</Link>
      <Loaded resource={resource}>
        {(d: any) => (
          <div className="space-y-4">
            <section className="card">
              <h2 className="font-bold">Status history</h2>
              <ul className="mt-2 divide-y divide-line text-sm">
                {d.history.map((h: any) => <li key={h.id} className="py-2"><strong>{h.previousStatus ? STATUS_LABEL[h.previousStatus] : 'New'} → {STATUS_LABEL[h.newStatus]}</strong> · {h.actorName} · {dateTime(h.createdAt)}<br />{h.reason}</li>)}
              </ul>
            </section>
            {d.events.length ? (
              <ul className="space-y-2">
                {d.events.map((e: any) => (
                  <li key={e.id} className="card !p-4 text-sm">
                    <div className="flex flex-wrap justify-between gap-2"><strong>{sentence(e.action)}</strong><Chip status={e.outcome} label={sentence(e.outcome)} /></div>
                    <p>{e.actorName} ({sentence(e.actorRole)}) · {dateTime(e.createdAt)}{e.detail && ` · ${e.detail}`}</p>
                    <p className="break-all text-muted">Resource: {e.resourceType} {e.resourceId}<br />Correlation ID: {e.correlationId}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty title="No audit events" />}
          </div>
        )}
      </Loaded>
    </>
  );
}
