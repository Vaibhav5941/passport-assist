import { useState } from 'react';
import { api } from '../api';
import type { SessionUser } from '../components/Layout';
import { ActionError, useAction } from '../components/ui';

const DEMO = [
  ['Asha (applicant)', 'asha.applicant@example.test'], ['Bilal (applicant)', 'bilal.applicant@example.test'],
  ['Meera (operator, North)', 'meera.operator@example.test'], ['Sam (operator, South)', 'sam.operator@example.test'],
];

export function SignIn({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();
  return (
    <main className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 p-4 md:grid-cols-2">
      <section>
        <p className="text-sm font-bold uppercase tracking-wide text-brand">Passport Assist · demo</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight md:text-4xl">Prepare your passport documents and know your next step.</h1>
        <p className="mt-4 text-muted">An independent assistance demo with a simulated DigiLocker. It is not a government service. All accounts and documents are synthetic.</p>
      </section>
      <section className="card">
        <h2 className="text-xl font-bold">Sign in</h2>
        <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void action.run(async () => onSignedIn((await api('/auth/login', { method: 'POST', body: { email, password } })).user)); }}>
          <label className="label">Email<input className="input" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="label">Password<input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <ActionError error={action.error} />
          <button className="btn-primary w-full" disabled={action.busy}>{action.busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        {import.meta.env.DEV && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm font-semibold">Local demo accounts</p>
            <p className="text-sm text-muted">Password for all: <code>Demo@12345</code>. Select one to fill the form.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {DEMO.map(([label, value]) => <button key={value} type="button" className="btn-secondary" onClick={() => { setEmail(value!); setPassword('Demo@12345'); }}>{label}</button>)}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
