'use client';
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { type ApprovalKind, type ApprovalRow, KIND_LABEL, KINDS, useApprovals, waited } from '@/lib/approvals';
import { formatDate } from '@/lib/format';

export default function ApprovalsPage() {
  return (
    <>
      <PageHeader title="Approvals" description="Everything waiting on you in every entity you can open, and what you sent that is still waiting on someone else." />
      <InboxView />
    </>
  );
}

type Tab = 'needsMe' | 'waitingOnOthers';

function InboxView() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const q = useApprovals();
  const [tab, setTab] = useState<Tab>('needsMe');
  const [kind, setKind] = useState<ApprovalKind | ''>((KINDS as readonly string[]).includes(params.get('kind') ?? '') ? (params.get('kind') as ApprovalKind) : '');
  const [entity, setEntity] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [sendingBack, setSendingBack] = useState<ApprovalRow | null>(null);

  const data = q.data;
  const rows = (data?.[tab] ?? []).filter((r) => (!kind || r.kind === kind) && (!entity || r.entityId === entity));
  const entities = [...new Map([...(data?.needsMe ?? []), ...(data?.waitingOnOthers ?? [])].map((r) => [r.entityId, r.entityName])).entries()];
  const multiEntity = entities.length > 1;
  const scopeOf = (r: ApprovalRow) => ({ tenantId: ws.tenantId, entityId: r.entityId });
  const idOf = (r: ApprovalRow) => `${r.entityId}:${r.key}`;
  const refresh = () => qc.invalidateQueries({ queryKey: ['approvals'] });

  // Documents open in their own entity: switch to it first.
  const open = (r: ApprovalRow) => {
    if (ws.entityId !== r.entityId) ws.setEntityId(r.entityId);
    router.push(r.href);
  };

  /** Runs one call per id and keeps each refusal, so one closed project never hides the rest of a week. */
  const run = async (r: ApprovalRow, calls: { path: string; body?: unknown }[], done: string) => {
    setBusy(idOf(r));
    const refused: string[] = [];
    for (const c of calls) {
      try {
        await api(c.path, { method: 'POST', scope: scopeOf(r), body: c.body ?? {} });
      } catch (e) {
        refused.push(e instanceof Error ? e.message : String(e));
      }
    }
    setResults((x) => ({ ...x, [idOf(r)]: refused.length ? `${calls.length - refused.length} of ${calls.length} done. ${[...new Set(refused)].join(' ')}` : done }));
    setBusy(null);
    void refresh();
    void qc.invalidateQueries({ queryKey: ['home'] });
  };

  const approveWeek = (r: ApprovalRow) => r.action?.kind === 'timesheets' && run(r, r.action.entryIds.map((id) => ({ path: `/services/timesheets/${id}/approve` })), 'Approved');
  const verify = (r: ApprovalRow) => r.action?.kind === 'verify' && run(r, [{ path: `/maintenance/orders/${r.action.orderId}/verify` }], 'Verified');

  const count = (t: Tab) => data?.[t].length ?? 0;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Approvals">
          {(
            [
              ['needsMe', 'Needs me'],
              ['waitingOnOthers', 'Waiting on others'],
            ] as const
          ).map(([k, label]) => (
            <Button key={k} role="tab" aria-selected={tab === k} size="sm" variant={tab === k ? 'secondary' : 'ghost'} onClick={() => setTab(k)}>
              {label} <span className="tabular ml-1 text-subtle">{count(k)}</span>
            </Button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-3">
          <Field label="Kind">
            {(f) => (
              <Select {...f} value={kind} onChange={(e) => setKind(e.target.value as ApprovalKind | '')}>
                <option value="">All kinds</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {multiEntity && (
            <Field label="Entity">
              {(f) => (
                <Select {...f} value={entity} onChange={(e) => setEntity(e.target.value)}>
                  <option value="">All entities</option>
                  {entities.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      </Card>
      {q.error && <Alert tone="danger">{q.error.message}</Alert>}
      {!!data?.errors.length && <Alert tone="warning">Some approvals could not be loaded ({[...new Set(data.errors.map((e) => KIND_LABEL[e.kind]))].join(', ')}). The rest are shown.</Alert>}
      {data && rows.length === 0 && (
        <Card>
          <EmptyState
            icon={<Inbox className="size-5" />}
            title={tab === 'needsMe' ? 'Nothing waiting on you' : 'Nothing waiting on others'}
            description={tab === 'needsMe' ? 'GST returns, NCR dispositions, first articles, CAPA checks, maintenance, timesheets, return claims, test reports and usage reviews show here when they need your decision.' : 'What you prepare or submit for someone else to approve shows here until it is decided.'}
          />
        </Card>
      )}
      {KINDS.filter((k) => rows.some((r) => r.kind === k)).map((k) => (
        <Card key={k} data-kind={k}>
          <CardHeader title={KIND_LABEL[k]} description={`${rows.filter((r) => r.kind === k).length} waiting`} />
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Document</Th>
                  {multiEntity && <Th>Entity</Th>}
                  <Th>{tab === 'needsMe' ? 'From' : 'Sent by'}</Th>
                  <Th>Waiting</Th>
                  <Th className="relative text-right">
                    <span className="sr-only">Action</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.kind === k)
                  .map((r) => (
                    <tr key={idOf(r)} className="border-t border-line text-[13px]" data-row={r.key}>
                      <Td className="min-w-0">
                        <a
                          href={r.href}
                          onClick={(e) => {
                            e.preventDefault();
                            open(r);
                          }}
                          className="font-mono font-medium hover:text-accent"
                        >
                          {r.number}
                        </a>
                        <span className="block max-w-[28rem] truncate text-muted">{r.title}</span>
                        {results[idOf(r)] && <span className="block text-[12px] text-subtle">{results[idOf(r)]}</span>}
                      </Td>
                      {multiEntity && <Td className="whitespace-nowrap">{r.entityName}</Td>}
                      <Td className="whitespace-nowrap">{r.from ?? '—'}</Td>
                      <Td className="whitespace-nowrap">{r.dueOn ? `Due ${formatDate(r.dueOn)}` : waited(r.since)}</Td>
                      <Td className="text-right whitespace-nowrap">
                        {tab === 'needsMe' && r.action?.kind === 'timesheets' && (
                          <span className="inline-flex gap-2">
                            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setSendingBack(r)}>
                              Send back…
                            </Button>
                            <Button size="sm" loading={busy === idOf(r)} disabled={busy !== null && busy !== idOf(r)} onClick={() => void approveWeek(r)}>
                              Approve {r.action.hours} h
                            </Button>
                          </span>
                        )}
                        {tab === 'needsMe' && r.action?.kind === 'verify' && (
                          <Button size="sm" loading={busy === idOf(r)} disabled={busy !== null && busy !== idOf(r)} onClick={() => void verify(r)}>
                            Verify
                          </Button>
                        )}
                        {!(tab === 'needsMe' && r.action) && (
                          <Button size="sm" variant="ghost" onClick={() => open(r)}>
                            Open
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </div>
        </Card>
      ))}
      {sendingBack?.action?.kind === 'timesheets' && (
        <SendBackDialog
          row={sendingBack}
          onClose={() => setSendingBack(null)}
          onSend={(reason) => {
            const r = sendingBack;
            setSendingBack(null);
            if (r.action?.kind === 'timesheets') void run(r, r.action.entryIds.map((id) => ({ path: `/services/timesheets/${id}/reject`, body: { reason } })), 'Sent back');
          }}
        />
      )}
    </div>
  );
}

function SendBackDialog({ row, onClose, onSend }: { row: ApprovalRow; onClose: () => void; onSend: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <FormDialog
      title={`Send back ${row.number}`}
      description={`${row.title}. The hours go back to draft so they can be corrected; the reason is kept with them.`}
      onClose={onClose}
      onSubmit={() => onSend(reason.trim())}
      pending={false}
      error={null}
      submitLabel="Send back"
      submitDisabled={reason.trim().length < 3}
    >
      <Field label="Reason">{(f) => <Input {...f} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} autoFocus />}</Field>
    </FormDialog>
  );
}
