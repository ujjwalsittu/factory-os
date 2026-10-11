'use client';
import { Alert, Badge, Button, buttonClass, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { BookingDialog } from '@/components/booking-dialog';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { BOOKING_STATUS, CAMPAIGN_STATUS, type CampaignDetail, STEP_RESULT, type StepResult } from '@/lib/services';

type Dialog = { kind: 'step' } | { kind: 'result'; stepId: string } | { kind: 'receive' } | { kind: 'return'; itemId: string; label: string } | { kind: 'extra' } | { kind: 'approve' } | { kind: 'cancel' } | { kind: 'book' };

/** One test campaign: steps and results, payload custody, chamber bookings, extras, files, sign-off and invoice. */
export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const q = useQuery({ queryKey: ['campaign', ws.entityId, id], queryFn: () => api<CampaignDetail>(`/services/campaigns/${id}`, { scope: ws.scope }), enabled: !!ws.entityId });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['campaign'] });
    void qc.invalidateQueries({ queryKey: ['campaigns'] });
  };
  const act = useMutation({
    mutationFn: (action: 'accept' | 'close') => api(`/services/campaigns/${id}/${action}`, { method: 'POST', scope: ws.scope }),
    onSuccess: refresh,
  });
  const invoice = useMutation({
    mutationFn: () => api<{ invoiceId: string }>(`/services/campaigns/${id}/invoice`, { method: 'POST', scope: ws.scope, body: {} }),
    onSuccess: (r) => {
      refresh();
      router.push(`/app/selling/invoices/${r.invoiceId}`);
    },
  });
  const removeExtra = useMutation({
    mutationFn: (extraId: string) => api(`/services/extras/${extraId}`, { method: 'DELETE', scope: ws.scope }),
    onSuccess: refresh,
  });
  const c = q.data;
  const can = (p: string) => ws.can(p);
  const edit = can('services.campaign.update');
  const open = c && (c.status === 'draft' || c.status === 'active');
  const invoiced = c && (c.invoiceStatus === 'draft' || c.invoiceStatus === 'submitted');
  return (
    <>
      <PageHeader
        title={c ? c.number : 'Campaign'}
        description={c ? `${c.customerName} · ${c.title}` : undefined}
        actions={
          c && (
            <div className="flex flex-wrap gap-2">
              {c.status === 'draft' && edit && (
                <Button loading={act.isPending && act.variables === 'accept'} onClick={() => act.mutate('accept')}>
                  Accept campaign
                </Button>
              )}
              {c.status === 'active' && can('services.campaign.approve') && (
                <Button onClick={() => setDialog({ kind: 'approve' })} disabled={c.pendingSteps > 0}>
                  Approve report
                </Button>
              )}
              {(c.status === 'reported' || c.status === 'closed') && (
                <Link href={`/app/services/campaigns/${c.id}/report`} className={buttonClass('secondary')}>
                  Test report
                </Link>
              )}
              {c.status === 'reported' && !invoiced && !c.projectId && can('services.billing.create') && can('selling.sales_invoice.create') && (
                <Button loading={invoice.isPending} onClick={() => invoice.mutate()}>
                  Create invoice
                </Button>
              )}
              {c.status === 'reported' && edit && (
                <Button variant="secondary" loading={act.isPending && act.variables === 'close'} onClick={() => act.mutate('close')}>
                  Close campaign
                </Button>
              )}
              {open && edit && (
                <Button variant="ghost" onClick={() => setDialog({ kind: 'cancel' })}>
                  Cancel
                </Button>
              )}
            </div>
          )
        }
      />
      <EntityGate what="services">
        {(act.error || invoice.error || removeExtra.error) && <Alert tone="danger" className="mb-3">{(act.error ?? invoice.error ?? removeExtra.error)!.message}</Alert>}
        {c && (
          <div className="space-y-4">
            <Card>
              <dl className="grid gap-x-6 gap-y-3 p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Status">
                  <Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge>
                </Detail>
                <Detail label="Price">
                  {formatMoney(c.quotedAmount)} quoted{c.extras.length > 0 && ` · ${formatMoney(c.totalAmount)} with extras`}
                </Detail>
                <Detail label="Customer reference">{c.customerRef ?? '—'}</Detail>
                <Detail label={c.projectId ? 'Billed through' : 'Invoice'}>
                  {c.projectId ? (
                    <Link href={`/app/services/projects/${c.projectId}`} className="font-mono hover:text-accent">
                      Project {c.projectNumber}
                    </Link>
                  ) : c.salesInvoiceId && invoiced ? (
                    <Link href={`/app/selling/invoices/${c.salesInvoiceId}`} className="hover:text-accent">
                      {c.invoiceNumber ?? 'Draft invoice'}
                    </Link>
                  ) : (
                    'Not invoiced'
                  )}
                </Detail>
                {c.scope && (
                  <div className="sm:col-span-2 lg:col-span-4">
                    <dt className="text-[12px] text-subtle">Scope</dt>
                    <dd className="mt-0.5">{c.scope}</dd>
                  </div>
                )}
                {c.cancelReason && <Detail label="Cancelled because">{c.cancelReason}</Detail>}
              </dl>
              {c.status === 'reported' && !invoiced && <p className="px-4 pb-4 text-[12px] text-subtle">{c.projectId ? 'Report approved. Return the payload to close the campaign; it is billed through the project.' : 'Report approved. Invoice the campaign and return the payload to close it.'}</p>}
            </Card>

            <Card>
              <CardHeader
                title="Test steps and results"
                description={c.status === 'draft' ? 'Add the steps the customer agreed; accept the campaign to start testing.' : c.status === 'active' ? 'Record a result for every step, then quality approves the report.' : 'Results are frozen with the approved report.'}
                actions={
                  open &&
                  edit && (
                    <Button size="sm" onClick={() => setDialog({ kind: 'step' })}>
                      Add step
                    </Button>
                  )
                }
              />
              {c.steps.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-muted">No steps yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Step</Th>
                        <Th>Requirement</Th>
                        <Th>Result</Th>
                        <Th>Measured</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {c.steps.map((s) => (
                        <tr key={s.id} className="border-t border-line text-[13px]">
                          <Td>
                            <span className="font-mono">{s.seq}</span> {s.name}
                          </Td>
                          <Td>{s.requirement ?? '—'}</Td>
                          <Td>
                            <Badge tone={STEP_RESULT[s.result].tone}>{STEP_RESULT[s.result].label}</Badge>
                            {s.notes && <p className="mt-1 text-[12px] text-muted">{s.notes}</p>}
                          </Td>
                          <Td>{s.measured ?? '—'}</Td>
                          <Td className="text-right">
                            {c.status === 'active' && edit && (
                              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'result', stepId: s.id })}>
                                Record result
                              </Button>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
              {c.reportApprovedAt && (
                <div className="border-t border-line p-4 text-[13px]">
                  <p className="font-medium">Report approved by {c.approvedByName} on {formatDateTime(c.reportApprovedAt)}</p>
                  <p className="mt-1 text-muted">{c.reportSummary}</p>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Payload in custody"
                description="The customer's goods held for the test: recorded here, never in stock. Each item goes back on an outward challan."
                actions={
                  c.status === 'active' &&
                  edit && (
                    <Button size="sm" onClick={() => setDialog({ kind: 'receive' })}>
                      Receive payload
                    </Button>
                  )
                }
              />
              {c.custody.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-muted">Nothing received.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Item</Th>
                        <Th>Received</Th>
                        <Th>Returned</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {c.custody.map((i) => (
                        <tr key={i.id} className="border-t border-line text-[13px]">
                          <Td>
                            {i.description} {i.qty > 1 && <span className="text-muted">× {i.qty}</span>}
                            {i.serialNo && <p className="font-mono text-[12px] text-muted">S/N {i.serialNo}</p>}
                          </Td>
                          <Td>
                            {formatDate(i.receivedAt)} · challan <span className="font-mono">{i.inwardChallanNo}</span>
                            <p className="text-[12px] text-muted">{i.receivedCondition}</p>
                          </Td>
                          <Td>
                            {i.returnedAt ? (
                              <>
                                {formatDate(i.returnedAt)} · <span className="font-mono">{i.outwardChallanNo}</span>
                                <p className="text-[12px] text-muted">{i.returnCondition}</p>
                              </>
                            ) : (
                              <Badge tone="warning">In custody</Badge>
                            )}
                          </Td>
                          <Td className="text-right">
                            {!i.returnedAt && edit && (
                              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'return', itemId: i.id, label: i.description })}>
                                Return
                              </Button>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Chamber bookings"
                  description="Billed with the campaign, never by the hour."
                  actions={
                    open &&
                    can('services.booking.create') && (
                      <Button size="sm" onClick={() => setDialog({ kind: 'book' })}>
                        Book chamber
                      </Button>
                    )
                  }
                />
                {c.bookings.length === 0 ? (
                  <p className="px-4 pb-4 text-[13px] text-muted">No bookings.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {c.bookings.map((b) => (
                      <li key={b.id} className="px-4 py-2 text-[13px]">
                        <Link href={`/app/services/bookings/${b.id}`} className="font-mono font-medium hover:text-accent">
                          {b.number}
                        </Link>{' '}
                        · {b.machineCode} <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
                        <span className="block text-muted">
                          {formatDateTime(b.startsAt)} → {formatDateTime(b.endsAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader
                  title="Extras"
                  description={c.projectId ? 'Recorded for the project; billed through its milestones.' : 'Added to the invoice after the quoted amount.'}
                  actions={
                    c.status !== 'closed' &&
                    c.status !== 'cancelled' &&
                    !invoiced &&
                    edit && (
                      <Button size="sm" onClick={() => setDialog({ kind: 'extra' })}>
                        Add extra
                      </Button>
                    )
                  }
                />
                {c.extras.length === 0 ? (
                  <p className="px-4 pb-4 text-[13px] text-muted">None.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {c.extras.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                        <span>
                          {e.description}
                          <span className="block text-muted">
                            {Number(e.qty)} × {formatMoney(e.rate)}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono">{formatMoney(e.amount)}</span>
                          {!invoiced && c.status !== 'closed' && edit && (
                            <Button size="sm" variant="ghost" onClick={() => removeExtra.mutate(e.id)}>
                              Remove
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {can('quality.attachment.read') && <AttachmentsPanel ownerType="test_campaign" ownerId={c.id} defaultKind="other" title="Test logs, photos and files" />}
          </div>
        )}
      </EntityGate>
      {c && dialog?.kind === 'step' && <StepDialog id={c.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {c && dialog?.kind === 'result' && <ResultDialog step={c.steps.find((s) => s.id === dialog.stepId)!} onClose={() => setDialog(null)} onDone={refresh} />}
      {c && dialog?.kind === 'receive' && <ReceiveDialog id={c.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {c && dialog?.kind === 'return' && <ReturnDialog itemId={dialog.itemId} label={dialog.label} onClose={() => setDialog(null)} onDone={refresh} />}
      {c && dialog?.kind === 'extra' && <ExtraDialog id={c.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {c && dialog?.kind === 'approve' && <ApproveDialog id={c.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {c && dialog?.kind === 'cancel' && <CancelDialog id={c.id} number={c.number} onClose={() => setDialog(null)} onDone={refresh} />}
      {c && dialog?.kind === 'book' && <BookingDialog booking={null} campaign={{ id: c.id, number: c.number, customerId: c.customerId }} onClose={() => setDialog(null)} />}
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-subtle">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** A small form posting to the campaign API, closing and refreshing on success. */
function useAction(path: string, method: string, onDone: () => void, onClose: () => void) {
  const ws = useWorkspace();
  return useMutation({
    mutationFn: (body: unknown) => api(path, { method, scope: ws.scope, body }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
}

function StepDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', requirement: '' });
  const m = useAction(`/services/campaigns/${id}/steps`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Add test step" onClose={onClose} onSubmit={() => m.mutate({ name: f.name, requirement: f.requirement || null })} pending={m.isPending} error={m.error} submitLabel="Add step">
      <Field label="Step" error={err.name}>{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus placeholder="Thermal cycling" />}</Field>
      <Field label="Requirement" error={err.requirement}>{(p) => <Input {...p} value={f.requirement} onChange={(e) => setF({ ...f, requirement: e.target.value })} placeholder="8 cycles, dwell 2 h at each extreme" />}</Field>
    </FormDialog>
  );
}

function ResultDialog({ step, onClose, onDone }: { step: CampaignDetail['steps'][number]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ result: (step.result === 'pending' ? 'pass' : step.result) as StepResult, measured: step.measured ?? '', notes: step.notes ?? '' });
  const m = useAction(`/services/steps/${step.id}/result`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Result: ${step.seq} ${step.name}`} description={step.requirement ?? undefined} onClose={onClose} onSubmit={() => m.mutate({ result: f.result, measured: f.measured || null, notes: f.notes || null })} pending={m.isPending} error={m.error} submitLabel="Record">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Result" error={err.result}>
          {(p) => (
            <Select {...p} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as StepResult })}>
              {(Object.keys(STEP_RESULT) as StepResult[]).map((r) => (
                <option key={r} value={r}>
                  {STEP_RESULT[r].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Measured" error={err.measured}>{(p) => <Input {...p} value={f.measured} onChange={(e) => setF({ ...f, measured: e.target.value })} placeholder="7.8e-6 mbar" />}</Field>
      </div>
      <Field label="Notes" error={err.notes}>{(p) => <Input {...p} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function ReceiveDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ description: '', serialNo: '', qty: '1', inwardChallanNo: '', receivedCondition: '' });
  const m = useAction(`/services/campaigns/${id}/custody`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="Receive payload" description="Goods held for the customer, not stock. Attach condition photos below." onClose={onClose} onSubmit={() => m.mutate({ ...f, qty: Number(f.qty), serialNo: f.serialNo || null })} pending={m.isPending} error={m.error} submitLabel="Receive" wide>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Item" error={err.description} className="sm:col-span-2">{(p) => <Input {...p} value={f.description} onChange={set('description')} required autoFocus placeholder="6U satellite bus (flight model)" />}</Field>
        <Field label="Quantity" error={err.qty}>{(p) => <Input {...p} type="number" step={1} min={1} value={f.qty} onChange={set('qty')} required />}</Field>
        <Field label="Serial no." error={err.serialNo}>{(p) => <Input {...p} value={f.serialNo} onChange={set('serialNo')} className="font-mono" />}</Field>
        <Field label="Customer’s challan no." error={err.inwardChallanNo}>{(p) => <Input {...p} value={f.inwardChallanNo} onChange={set('inwardChallanNo')} required className="font-mono" />}</Field>
        <Field label="Condition on receipt" error={err.receivedCondition}>{(p) => <Input {...p} value={f.receivedCondition} onChange={set('receivedCondition')} required placeholder="Crate sealed" />}</Field>
      </div>
    </FormDialog>
  );
}

function ReturnDialog({ itemId, label, onClose, onDone }: { itemId: string; label: string; onClose: () => void; onDone: () => void }) {
  const [condition, setCondition] = useState('');
  const m = useAction(`/services/custody/${itemId}/return`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Return ${label}`} description="An outward challan number is issued for the return." onClose={onClose} onSubmit={() => m.mutate({ returnCondition: condition })} pending={m.isPending} error={m.error} submitLabel="Return">
      <Field label="Condition on return" error={err.returnCondition}>{(p) => <Input {...p} value={condition} onChange={(e) => setCondition(e.target.value)} required autoFocus />}</Field>
    </FormDialog>
  );
}

function ExtraDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ description: '', qty: '1', rate: '' });
  const m = useAction(`/services/campaigns/${id}/extras`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title="Add extra" description="Invoiced on the campaign's service item after the quoted amount." onClose={onClose} onSubmit={() => m.mutate(f)} pending={m.isPending} error={m.error} submitLabel="Add">
      <Field label="Description" error={err.description}>{(p) => <Input {...p} value={f.description} onChange={set('description')} required autoFocus placeholder="Additional chamber time" />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantity" error={err.qty}>{(p) => <Input {...p} value={f.qty} onChange={set('qty')} inputMode="decimal" required />}</Field>
        <Field label="Rate (₹)" error={err.rate}>{(p) => <Input {...p} value={f.rate} onChange={set('rate')} inputMode="decimal" required />}</Field>
      </div>
    </FormDialog>
  );
}

function ApproveDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [summary, setSummary] = useState('');
  const m = useAction(`/services/campaigns/${id}/approve`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Approve test report" description="Your sign-off freezes the steps and results and releases the report to the customer." onClose={onClose} onSubmit={() => m.mutate({ summary })} pending={m.isPending} error={m.error} submitLabel="Approve report">
      <Field label="Summary" error={err.summary}>{(p) => <Input {...p} value={summary} onChange={(e) => setSummary(e.target.value)} required autoFocus placeholder="All steps met the requirement" />}</Field>
    </FormDialog>
  );
}

function CancelDialog({ id, number, onClose, onDone }: { id: string; number: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useAction(`/services/campaigns/${id}/cancel`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Cancel ${number}`} description="Return any payload first. Chamber bookings are cancelled from their own pages." onClose={onClose} onSubmit={() => m.mutate({ reason })} pending={m.isPending} error={m.error} submitLabel="Cancel campaign">
      <Field label="Reason" error={err.reason}>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}</Field>
    </FormDialog>
  );
}
