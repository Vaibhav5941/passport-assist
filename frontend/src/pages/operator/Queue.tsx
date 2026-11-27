import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { useResource } from '../../api';
import type { SessionUser } from '../../components/Layout';
import { Chip, Empty, Loaded, PageHeader } from '../../components/ui';
import { applicationTitle, dateTime, STATUS_LABEL } from '../../format';

const FILTERS = ['READY_FOR_REVIEW', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'SUBMITTED_SIMULATED', 'CLOSED'];

export function Queue() {
  const user = useOutletContext<SessionUser>();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const resource = useResource(`/operator/applications${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  return (
    <>
      <PageHeader title="Review queue" description={`Applications sent for review in your region (${user.region}). Oldest first.`} />
      <label className="label mb-4 max-w-xs">Filter by status
        <select className="input" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
          <option value="">All statuses</option>
          {FILTERS.map((f) => <option key={f} value={f}>{STATUS_LABEL[f]}</option>)}
        </select>
      </label>
      <Loaded resource={resource}>
        {(d: any) => d.applications.length ? (
          <ul className="space-y-3">
            {d.applications.map((a: any) => (
              <li key={a.id} className="card flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold">{a.reference} · {a.applicantName}</h2>
                  <p className="text-sm text-muted">{applicationTitle(a)} · {a.verifiedCount}/{a.itemCount} verified, {a.pendingCount} to review · Updated {dateTime(a.updatedAt)}</p>
                </div>
                <div className="flex items-center gap-3"><Chip status={a.status} /><Link className="btn-primary" to={`/operator/applications/${a.id}`}>Open<span className="sr-only"> {a.reference}</span></Link></div>
              </li>
            ))}
          </ul>
        ) : <Empty title="No applications here">Applications appear after an applicant sends them for review.</Empty>}
      </Loaded>
    </>
  );
}
