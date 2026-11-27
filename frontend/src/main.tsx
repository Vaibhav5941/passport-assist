import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { api } from './api';
import { Layout, type SessionUser } from './components/Layout';
import { Empty } from './components/ui';
import { SignIn } from './pages/SignIn';
import { Home } from './pages/applicant/Home';
import { Profile } from './pages/applicant/Profile';
import { Checklist } from './pages/applicant/Checklist';
import { Consent } from './pages/applicant/Consent';
import { Authorize, DigiLocker } from './pages/applicant/DigiLocker';
import { Upload } from './pages/applicant/Upload';
import { MyDocuments } from './pages/applicant/MyDocuments';
import { Tracking } from './pages/applicant/Tracking';
import { Notifications } from './pages/applicant/Notifications';
import { Queue } from './pages/operator/Queue';
import { Review } from './pages/operator/Review';
import { AuditTrail } from './pages/operator/AuditTrail';

function App() {
  const [user, setUser] = useState<SessionUser | null>();
  useEffect(() => {
    api('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
    const expired = () => setUser(null);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);

  if (user === undefined) return <p role="status" className="p-8 text-muted">Loading…</p>;
  // The URL is kept, so signing in returns the user to the page they asked for.
  if (!user) return <SignIn onSignedIn={setUser} />;
  const home = user.role === 'OPERATOR' ? '/operator' : '/';

  return (
    <Routes>
      <Route element={<Layout user={user} onSignOut={() => { window.history.replaceState(null, '', '/'); setUser(null); }} />}>
        {user.role === 'APPLICANT' ? (
          <>
            <Route path="/" element={<Home />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/applications/:id/checklist" element={<Checklist />} />
            <Route path="/applications/:id/consent" element={<Consent />} />
            <Route path="/applications/:id/digilocker" element={<DigiLocker />} />
            <Route path="/digilocker/authorize" element={<Authorize />} />
            <Route path="/applications/:id/upload/:itemId" element={<Upload />} />
            <Route path="/documents" element={<MyDocuments />} />
            <Route path="/applications/:id/tracking" element={<Tracking />} />
            <Route path="/notifications" element={<Notifications />} />
          </>
        ) : (
          <>
            <Route path="/" element={<Navigate to={home} replace />} />
            <Route path="/operator" element={<Queue />} />
            <Route path="/operator/applications/:id" element={<Review />} />
            <Route path="/operator/applications/:id/audit" element={<AuditTrail />} />
          </>
        )}
        <Route path="*" element={<Empty title="Page not found"><Link className="link" to={home}>Go to your home page</Link></Empty>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);
