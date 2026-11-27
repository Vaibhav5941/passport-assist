import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useResource } from '../../api';
import { ActionError, Alert, Chip, Loaded, PageHeader, useAction } from '../../components/ui';

const MAX = 2 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export function Upload() {
  const { id, itemId } = useParams();
  const resource = useResource(`/applications/${id}`);
  const [file, setFile] = useState<File>();
  const [issuedOn, setIssuedOn] = useState('');
  const [result, setResult] = useState<{ status: string; reason: string | null }>();
  const action = useAction();
  const back = `/applications/${id}/checklist`;
  const problem = file && (!TYPES.includes(file.type) ? 'Choose a PDF, PNG or JPEG file.' : file.size > MAX ? 'The file must be 2 MB or smaller.' : undefined);

  return (
    <>
      <PageHeader title="Upload document" description="Use this instead of DigiLocker for any checklist item." />
      <Loaded resource={resource}>
        {(d: any) => {
          const item = d.checklist.find((i: any) => i.id === itemId);
          if (!item) return <Alert tone="bad">Checklist item not found. <Link className="link" to={back}>Back to checklist</Link></Alert>;
          if (result) {
            return (<section className="card space-y-3"><div className="flex items-center justify-between"><h2 className="font-bold">{item.name}</h2><Chip status={result.status} /></div>
              {result.reason ? <Alert tone="bad">{result.reason}</Alert> : <Alert tone="ok">Added. An operator will verify it.</Alert>}
              <div className="flex gap-2"><Link className="btn-primary" to={back}>Back to checklist</Link>{result.reason && <button className="btn-secondary" onClick={() => { setResult(undefined); setFile(undefined); }}>Try another</button>}</div></section>);
          }
          if (!item.canProvide) return <Alert>This item cannot be changed now. <Link className="link" to={back}>Back to checklist</Link></Alert>;
          const needsDate: boolean = item.requiresIssueDate;
          return (
            <form className="card space-y-4" onSubmit={(e) => { e.preventDefault(); if (!file) return; void action.run(async () => {
              setResult(await api(`/applications/${id}/documents/${itemId}/upload`, { method: 'PUT', file, headers: issuedOn ? { 'x-issued-on': issuedOn } : {} }));
              window.dispatchEvent(new Event('notifications-changed'));
            }); }}>
              <div><h2 className="font-bold">{item.name}</h2><p className="text-sm text-muted">{item.description}</p></div>
              <Alert>Demo only: use a made-up file. The server checks its type and size in memory, then discards it. Only type, size and issue date are saved, not the file or its name.</Alert>
              <label className="label">File (PDF, PNG or JPEG, up to 2 MB)<input className="input" type="file" accept={TYPES.join(',')} required onChange={(e) => setFile(e.target.files?.[0])} /></label>
              {problem && <p role="alert" className="text-sm text-bad">{problem}</p>}
              <label className="label">Issue date{!needsDate && ' (optional)'}<input className="input" type="date" required={needsDate} max={new Date().toISOString().slice(0, 10)} value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} /></label>
              <ActionError error={action.error} />
              <div className="flex gap-2"><button className="btn-primary" disabled={!file || !!problem || action.busy}>{action.busy ? 'Uploading…' : 'Upload'}</button><Link className="btn-secondary" to={back}>Cancel</Link></div>
            </form>
          );
        }}
      </Loaded>
    </>
  );
}
