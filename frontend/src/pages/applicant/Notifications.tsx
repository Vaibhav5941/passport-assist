import { Link } from 'react-router-dom';
import { api, useResource } from '../../api';
import { ActionError, Empty, Loaded, PageHeader, useAction } from '../../components/ui';
import { dateTime } from '../../format';

export function Notifications() {
  const resource = useResource('/notifications');
  const action = useAction();
  const markRead = (id: string) => action.run(async () => { await api(`/notifications/${id}/read`, { method: 'POST' }); await resource.reload(); window.dispatchEvent(new Event('notifications-changed')); });
  return (
    <>
      <PageHeader title="Notifications" description="Updates that need your attention." />
      <ActionError error={action.error} />
      <Loaded resource={resource}>
        {(d: any) => d.notifications.length ? (
          <ul className="space-y-3">
            {d.notifications.map((n: any) => (
              <li key={n.id} className={`card ${n.readAt ? '' : 'border-l-4 border-l-brand'}`}>
                <div className="flex flex-wrap justify-between gap-2"><h2 className={n.readAt ? 'font-semibold' : 'font-bold'}>{n.title}</h2><span className="text-sm text-muted">{n.readAt ? 'Read' : 'Unread'} · {dateTime(n.createdAt)}</span></div>
                <p className="mt-1">{n.message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link className="btn-primary" to={n.link} onClick={() => void (n.readAt || markRead(n.id))}>Open</Link>
                  {!n.readAt && <button className="btn-secondary" disabled={action.busy} onClick={() => void markRead(n.id)}>Mark as read</button>}
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty title="You are all caught up">New notifications will appear here.</Empty>}
      </Loaded>
    </>
  );
}
