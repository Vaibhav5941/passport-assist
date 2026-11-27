import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useResource } from '../../api';
import { ActionError, Chip, Empty, Loaded, PageHeader, useAction } from '../../components/ui';
import { dateTime, SOURCE_LABEL } from '../../format';

function DocumentRow({ doc }: { doc: any }) {
  const [metadata, setMetadata] = useState<any>();
  const action = useAction();
  const revoked = !!doc.accessRevokedAt;
  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">{doc.name}</h2>
          <p className="text-sm text-muted">{doc.reference} · {revoked ? 'DigiLocker access withdrawn' : `${SOURCE_LABEL[doc.source]}${doc.maskedIdentifier ? ` · ${doc.maskedIdentifier}` : ''}`} · {dateTime(doc.updatedAt)}</p>
        </div>
        <Chip status={doc.status} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {revoked ? <p className="text-sm text-wait">Consent withdrawn. These details were deleted.</p> : (
          <button className="btn-secondary" aria-expanded={!!metadata} disabled={action.busy} onClick={() => (metadata ? setMetadata(undefined) : void action.run(async () => setMetadata((await api(`/documents/${doc.id}`)).document)))}>
            {metadata ? 'Hide details' : 'View details'}
          </button>
        )}
        <Link className="link text-sm" to={`/applications/${doc.applicationId}/checklist`}>Open checklist</Link>
      </div>
      <ActionError error={action.error} />
      {metadata && !revoked && (
        <dl className="mt-3 grid gap-2 border-t border-line pt-3 text-sm sm:grid-cols-2">
          {[['Issuer', metadata.issuer], ['Masked identifier', metadata.maskedIdentifier], ['Issue date', metadata.issuedOn], ['Valid until', metadata.validUntil],
            ['File type', metadata.mimeType], ['File size', metadata.sizeBytes && `${metadata.sizeBytes} bytes`], ['Reason', metadata.rejectionReason]]
            .filter(([, v]) => v).map(([k, v]) => <div key={k as string}><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
    </li>
  );
}

export function MyDocuments() {
  const resource = useResource('/documents');
  return (
    <>
      <PageHeader title="My documents" description="Details about your documents. File contents are never stored or shown." />
      <Loaded resource={resource}>
        {(d: any) => d.documents.length
          ? <ul className="space-y-3">{d.documents.map((doc: any) => <DocumentRow key={`${doc.id}${doc.updatedAt}`} doc={doc} />)}</ul>
          : <Empty title="No documents yet">Open an application checklist to add one.</Empty>}
      </Loaded>
    </>
  );
}
