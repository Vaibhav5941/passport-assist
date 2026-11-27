import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, useResource } from '../api';

export interface SessionUser { id: string; displayName: string; email: string; role: 'APPLICANT' | 'OPERATOR'; region: string }

export function Layout({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const notices = useResource<{ notifications: any[] }>(user.role === 'APPLICANT' ? '/notifications' : null);
  useEffect(() => { setOpen(false); void notices.reload(); }, [pathname]); // eslint-disable-line
  useEffect(() => {
    const refresh = () => void notices.reload();
    window.addEventListener('notifications-changed', refresh);
    return () => window.removeEventListener('notifications-changed', refresh);
  }, [notices.reload]);
  const unread = notices.data?.notifications.filter((n) => !n.readAt).length ?? 0;
  const links = user.role === 'APPLICANT'
    ? [['/', 'Home'], ['/profile', 'Profile'], ['/documents', 'My documents'], ['/notifications', 'Notifications']]
    : [['/operator', 'Review queue']];

  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-white focus:p-2">Skip to content</a>
      <aside className="bg-ink text-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col">
        <div className="flex items-center justify-between p-4">
          <div>
            <p className="text-lg font-bold">Passport Assist</p>
            <p className="text-sm text-slate-300">{user.role === 'APPLICANT' ? 'Applicant portal' : 'Operator portal'} · demo</p>
          </div>
          <button className="btn border border-white/30 md:hidden" aria-expanded={open} aria-controls="menu" onClick={() => setOpen(!open)}>Menu</button>
        </div>
        <div id="menu" className={`${open ? 'block' : 'hidden'} md:flex md:flex-1 md:flex-col`}>
          <nav aria-label="Main" className="space-y-1 px-2">
            {links.map(([to, label]) => (
              <NavLink key={to} to={to!} end={to === '/' || to === '/operator'}
                className={({ isActive }) => `flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold ${isActive ? 'bg-white text-ink' : 'text-slate-200 hover:bg-white/10'}`}>
                {label}
                {label === 'Notifications' && unread > 0 && (
                  <span className="rounded-full bg-brand px-2 text-xs text-white">{unread}<span className="sr-only"> unread</span></span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="mt-4 border-t border-white/15 p-4 md:mt-auto">
            <p className="text-sm font-semibold">{user.displayName}</p>
            <p className="break-all text-sm text-slate-300">{user.email}</p>
            <button className="btn mt-3 w-full border border-white/30 hover:bg-white/10" onClick={async () => { await api('/auth/logout', { method: 'POST' }).catch(() => undefined); onSignOut(); }}>Sign out</button>
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-5xl"><Outlet context={user} /></div>
      </main>
    </div>
  );
}
