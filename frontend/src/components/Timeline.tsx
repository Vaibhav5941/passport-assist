import { dateTime, sentence, STATUS_LABEL } from '../format';

export function Timeline({ events }: { events: any[] }) {
  return (
    <ol className="relative ml-2 border-l-2 border-line">
      {[...events].reverse().map((e, index) => (
        <li key={e.id} className="relative pb-6 pl-6 last:pb-0" aria-current={index === 0 ? 'step' : undefined}>
          <span aria-hidden className={`absolute -left-[9px] top-1 size-4 rounded-full border-2 ${index === 0 ? 'border-brand bg-brand ring-4 ring-brand-soft' : 'border-line bg-white'}`} />
          <div className={index === 0 ? 'rounded-lg bg-brand-soft p-3' : ''}>
            <p className="font-bold">
              {STATUS_LABEL[e.newStatus]}
              {index === 0 && <span className="ml-2 text-xs font-bold uppercase text-brand-dark">Current status</span>}
            </p>
            <p className="text-sm">{e.reason}</p>
            <p className="mt-1 text-sm text-muted">{e.actorName} ({sentence(e.actorRole)}) · {dateTime(e.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
