import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useResource } from '../../api';
import { ActionError, Chip, Empty, Loaded, PageHeader, useAction } from '../../components/ui';
import { applicationTitle } from '../../format';

/** One clear next step, worked out from server data. */
function nextStep(detail: any): { text: string; to: string; button: string } {
  const { application: a, checklist, consent } = detail;
  const base = `/applications/${a.id}`;
  const rejected = checklist.filter((i: any) => i.status === 'REJECTED');
  const missing = checklist.filter((i: any) => i.required && i.status === 'MISSING');
  const view = { to: `${base}/tracking`, button: 'View tracking' };
  if (a.status === 'DRAFT') return { text: 'Start document collection for this application.', ...view, button: 'Continue' };
  if (a.status === 'DOCUMENTS_PENDING' || a.status === 'CORRECTION_REQUIRED') {
    const to = `${base}/checklist`;
    if (rejected.length) return { text: `Replace rejected: ${rejected.map((i: any) => i.name).join(', ')}.`, to, button: 'Fix documents' };
    if (missing.length) {
      const note = consent?.withdrawnAt ? 'You withdrew consent. ' : '';
      return { text: `${note}Add: ${missing.map((i: any) => i.name).join(', ')}.`, to, button: 'Open checklist' };
    }
    return { text: 'All required documents are added. Send your application for review.', to, button: 'Review and send' };
  }
  if (a.status === 'SUBMITTED_SIMULATED') return { text: 'Nothing to do. The simulated submission is recorded.', ...view };
  if (a.status === 'CLOSED') return { text: 'This application is closed.', ...view };
  return { text: 'Nothing to do. An operator will review your documents.', ...view };
}

function ApplicationCard({ id }: { id: string }) {
  const resource = useResource(`/applications/${id}`);
  return (
    <Loaded resource={resource}>
      {(d: any) => {
        const step = nextStep(d);
        const verified = d.checklist.filter((i: any) => i.status === 'VERIFIED').length;
        return (
          <article className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">{applicationTitle(d.application)}</h2>
                <p className="text-sm text-muted">{d.application.reference} · {verified} of {d.checklist.length} documents verified</p>
              </div>
              <Chip status={d.application.status} />
            </div>
            <div className="mt-4 rounded-lg bg-brand-soft p-4">
              <p className="text-xs font-bold uppercase text-brand-dark">Next step</p>
              <p className="mt-1">{step.text}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <Link className="btn-primary" to={step.to}>{step.button}</Link>
                <Link className="link text-sm" to={`/applications/${id}/checklist`}>Checklist</Link>
                <Link className="link text-sm" to={`/applications/${id}/tracking`}>Tracking</Link>
              </div>
            </div>
          </article>
        );
      }}
    </Loaded>
  );
}

export function Home() {
  const apps = useResource('/applications');
  const profile = useResource('/profile');
  const navigate = useNavigate();
  const action = useAction();
  const [choice, setChoice] = useState('FRESH:STANDARD');

  return (
    <>
      <PageHeader title="Home" description="Your passport assistance applications and what needs your attention." />
      <div className="space-y-4">
        {profile.data && !profile.data.profile && (
          <div className="card border-wait/40">
            <h2 className="font-bold">Step 1: complete your profile</h2>
            <p className="mt-1 text-muted">Your profile is needed before you can collect documents.</p>
            <Link className="btn-primary mt-3" to="/profile">Complete profile</Link>
          </div>
        )}
        <Loaded resource={apps}>
          {(d: any) => d.applications.length
            ? d.applications.map((a: any) => <ApplicationCard key={a.id} id={a.id} />)
            : <Empty title="No applications yet">Create one below.</Empty>}
        </Loaded>
        <form className="card" onSubmit={(e) => {
          e.preventDefault();
          const [type, scenario] = choice.split(':');
          void action.run(async () => {
            const { application } = await api('/applications', { method: 'POST', body: { type, scenario } });
            navigate(`/applications/${application.id}/tracking`);
          });
        }}>
          <h2 className="font-bold">New application</h2>
          <label className="label mt-3">Application type
            <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="FRESH:STANDARD">Fresh passport</option>
              <option value="REISSUE:EXPIRING">Re-issue: expiring or expired</option>
              <option value="REISSUE:LOST_OR_DAMAGED">Re-issue: lost or damaged</option>
            </select>
          </label>
          <div className="mt-3 space-y-3"><ActionError error={action.error} /><button className="btn-secondary" disabled={action.busy}>Create application</button></div>
        </form>
      </div>
    </>
  );
}
