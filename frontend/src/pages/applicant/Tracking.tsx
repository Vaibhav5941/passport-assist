import { Link, useParams } from 'react-router-dom';
import { api, useResource } from '../../api';
import { Timeline } from '../../components/Timeline';
import { ActionError, Chip, Loaded, PageHeader, SimulatedBadge, SimulatedWarning, Transitions, useAction } from '../../components/ui';
import { applicationTitle } from '../../format';

export function Tracking() {
  const { id } = useParams();
  const resource = useResource(`/applications/${id}`);
  const action = useAction();
  return (
    <Loaded resource={resource}>
      {(d: any) => (
        <>
          <PageHeader title="Application tracking" description={`${applicationTitle(d.application)} · ${d.application.reference}`}><SimulatedBadge /></PageHeader>
          <div className="space-y-4">
            <SimulatedWarning />
            <section className="card">
              <div className="mb-4 flex items-center justify-between gap-2"><h2 className="font-bold">Timeline (simulated)</h2><Chip status={d.application.status} /></div>
              <Timeline events={d.timeline} />
            </section>
            <section className="card space-y-3">
              <h2 className="font-bold">Your actions</h2>
              <ActionError error={action.error} />
              <Transitions actions={d.actions} busy={action.busy} onRun={async (to, reason) => {
                const ok = await action.run(() => api(`/applications/${id}/transitions`, { method: 'POST', body: { to, reason, expectedVersion: d.application.version } }));
                await resource.reload(); window.dispatchEvent(new Event('notifications-changed'));
                return ok;
              }} />
              <Link className="link block text-sm" to={`/applications/${id}/checklist`}>Open document checklist</Link>
            </section>
          </div>
        </>
      )}
    </Loaded>
  );
}
