import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useResource } from '../../api';
import { ActionError, Alert, Loaded, PageHeader, useAction } from '../../components/ui';

const FIELDS = [
  { key: 'fullName', label: 'Full name', type: 'text', hint: 'Must match the name on your documents.', auto: 'name' },
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date', auto: 'bday' },
  { key: 'phone', label: 'Phone (10 digits)', type: 'tel', auto: 'tel-national' },
  { key: 'addressLine', label: 'Address', type: 'text', auto: 'street-address' },
  { key: 'city', label: 'City', type: 'text', auto: 'address-level2' },
  { key: 'state', label: 'State', type: 'text', auto: 'address-level1' },
  { key: 'postalCode', label: 'PIN code (6 digits)', type: 'text', auto: 'postal-code' },
];

function ProfileForm({ initial }: { initial: Record<string, string> | null }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, initial?.[f.key] ?? ''])));
  const [saved, setSaved] = useState(false);
  const action = useAction();
  return (
    <form className="card grid gap-4 sm:grid-cols-2" noValidate onSubmit={(e) => {
      e.preventDefault(); setSaved(false);
      void action.run(async () => { await api('/profile', { method: 'PUT', body: values }); setSaved(true); });
    }}>
      {FIELDS.map((f) => {
        const problem = action.error?.details?.[f.key]?.[0];
        return (
          <label key={f.key} className="label">{f.label}
            <input className={`input ${problem ? 'border-bad' : ''}`} type={f.type} autoComplete={f.auto} value={values[f.key]}
              aria-invalid={!!problem} aria-describedby={`${f.key}-note`}
              onChange={(e) => { setSaved(false); setValues({ ...values, [f.key]: e.target.value }); }} />
            <span id={`${f.key}-note`} className={`mt-1 block text-sm font-normal ${problem ? 'text-bad' : 'text-muted'}`}>{problem ?? f.hint}</span>
          </label>
        );
      })}
      <div className="space-y-3 sm:col-span-2">
        <p className="text-sm text-muted">Use made-up details only. This demo does not ask for any government identity number.</p>
        <ActionError error={action.error} />
        {saved && <Alert tone="ok">Profile saved. <Link className="link" to="/">Back to home</Link></Alert>}
        <button className="btn-primary" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save profile'}</button>
      </div>
    </form>
  );
}

export function Profile() {
  const resource = useResource('/profile');
  return (
    <>
      <PageHeader title="Applicant profile" description="These details are used to check that your documents match." />
      <Loaded resource={resource}>{(d: any) => <ProfileForm initial={d.profile} />}</Loaded>
    </>
  );
}
