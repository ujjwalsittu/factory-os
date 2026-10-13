'use client';
import { Alert, Badge, Button, Card, CardHeader, DateInput, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { BookingDialog } from '@/components/booking-dialog';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { ProjectDialog } from '@/components/project-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { BOOKING_STATUS, CAMPAIGN_STATUS, COST_CATEGORY, type CostCategory, LINK_KIND, type LinkKind, type ProjectDetail, PROJECT_STATUS } from '@/lib/services';

type Milestone = ProjectDetail['milestones'][number];
type Dialog =
  | { kind: 'edit' }
  | { kind: 'milestone'; milestone: Milestone | null }
  | { kind: 'achieve'; milestone: Milestone }
  | { kind: 'release'; id: string; label: string }
  | { kind: 'budget' }
  | { kind: 'link' }
  | { kind: 'book' }
  | { kind: 'complete' }
  | { kind: 'cancel' };

/** One project: milestones and their invoices, retention, budget vs actual, linked work, hours and files. */
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const q = useQuery({ queryKey: ['project', ws.entityId, id], queryFn: () => api<ProjectDetail>(`/services/projects/${id}`, { scope: ws.scope }), enabled: !!ws.entityId });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['project'] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
  };
  const act = useMutation({
    mutationFn: (action: 'activate' | 'close') => api(`/services/projects/${id}/${action}`, { method: 'POST', scope: ws.scope }),
    onSuccess: refresh,
  });
  const invoice = useMutation({
    mutationFn: (mid: string) => api<{ invoiceId: string }>(`/services/milestones/${mid}/invoice`, { method: 'POST', scope: ws.scope, body: {} }),
    onSuccess: (r) => {
      refresh();
      router.push(`/app/selling/invoices/${r.invoiceId}`);
    },
  });
  const removeMilestone = useMutation({
    mutationFn: (mid: string) => api(`/services/milestones/${mid}`, { method: 'DELETE', scope: ws.scope }),
    onSuccess: refresh,
  });
  const unlink = useMutation({
    mutationFn: ({ kind, linkId }: { kind: LinkKind; linkId: string }) => api(`/services/projects/${id}/links/${kind}/${linkId}`, { method: 'DELETE', scope: ws.scope }),
    onSuccess: refresh,
  });
  const p = q.data;
  const can = (perm: string) => ws.can(perm);
  const edit = can('services.project.update');
  const approve = can('services.project.approve');
  const planning = p && (p.status === 'draft' || p.status === 'active');
  const linking = p && p.status !== 'closed' && p.status !== 'cancelled' && edit;
  const error = act.error ?? invoice.error ?? removeMilestone.error ?? unlink.error;
  return (
    <>
      <PageHeader
        title={p ? p.number : 'Project'}
        description={p ? `${p.customerName} · ${p.title}` : undefined}
        actions={
          p && (
            <div className="flex flex-wrap gap-2">
              {p.status === 'draft' && approve && (
                <Button loading={act.isPending && act.variables === 'activate'} onClick={() => act.mutate('activate')}>
                  Activate project
                </Button>
              )}
              {p.status === 'active' && approve && <Button onClick={() => setDialog({ kind: 'complete' })}>Complete project</Button>}
              {p.status === 'completed' && approve && (
                <Button loading={act.isPending && act.variables === 'close'} onClick={() => act.mutate('close')}>
                  Close project
                </Button>
              )}
              {planning && edit && (
                <Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}>
                  Edit
                </Button>
              )}
              {planning && approve && (
                <Button variant="ghost" onClick={() => setDialog({ kind: 'cancel' })}>
                  Cancel
                </Button>
              )}
            </div>
          )
        }
      />
      <EntityGate what="services">
        {error && <Alert tone="danger" className="mb-3">{error.message}</Alert>}
        {p && (
          <div className="space-y-4">
            <Card>
              <dl className="grid gap-x-6 gap-y-3 p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <Detail label="Status">
                  <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
                </Detail>
                <Detail label="Contract value">{formatMoney(p.contractValue)} before GST</Detail>
                <Detail label="Retention">{Number(p.retentionPct) ? `${Number(p.retentionPct)}% · ${p.dlpMonths} months defect liability` : 'None'}</Detail>
                <Detail label="Customer reference">{p.customerRef ?? '—'}</Detail>
                <Detail label="Invoiced">{formatMoney(p.revenue)}</Detail>
                <Detail label="Actual cost">{formatMoney(p.actualCost)}</Detail>
                <Detail label="Margin">
                  <span className={Number(p.margin) < 0 ? 'text-danger' : undefined}>{formatMoney(p.margin)}</span>
                </Detail>
                <Detail label="Manager">{p.managerName ?? '—'}</Detail>
                {p.completedOn && <Detail label="Completed">{formatDate(p.completedOn)}</Detail>}
                {p.cancelReason && <Detail label="Cancelled because">{p.cancelReason}</Detail>}
              </dl>
              {p.description && <p className="px-4 pb-4 text-[13px] text-muted">{p.description}</p>}
            </Card>

            <Card>
              <CardHeader
                title="Milestones"
                description={
                  p.status === 'draft'
                    ? `Add milestones adding up to the contract value (now ${formatMoney(p.milestoneTotal)} of ${formatMoney(p.contractValue)}), then activate.`
                    : 'Mark a milestone achieved with the customer’s acceptance, then invoice it at its full value.'
                }
                actions={
                  planning &&
                  edit && (
                    <Button size="sm" onClick={() => setDialog({ kind: 'milestone', milestone: null })}>
                      Add milestone
                    </Button>
                  )
                }
              />
              {p.milestones.length === 0 ? (
                <EmptyState size="compact" title="No milestones yet" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Milestone</Th>
                        <Th className="text-right">Amount</Th>
                        <Th>Achieved</Th>
                        <Th>Invoice</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {p.milestones.map((m) => (
                        <tr key={m.id} className="border-t border-line text-[13px]">
                          <Td>
                            <span className="font-mono">{m.seq}</span> {m.name}
                            {m.dueDate && <p className="text-[12px] text-subtle">Due {formatDate(m.dueDate)}</p>}
                          </Td>
                          <Td className="text-right font-mono">{formatMoney(m.amount)}</Td>
                          <Td>
                            {m.achievedOn ? (
                              <>
                                {formatDate(m.achievedOn)} · <span className="font-mono">{m.acceptanceRef}</span>
                              </>
                            ) : (
                              <Badge tone="neutral">Pending</Badge>
                            )}
                          </Td>
                          <Td>
                            {m.salesInvoiceId ? (
                              <Link href={`/app/selling/invoices/${m.salesInvoiceId}`} className="hover:text-accent">
                                {m.invoiceNumber ?? 'Draft invoice'}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </Td>
                          <Td className="text-right whitespace-nowrap">
                            {m.state === 'pending' && p.status === 'active' && edit && (
                              <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'achieve', milestone: m })}>
                                Mark achieved
                              </Button>
                            )}
                            {m.state === 'achieved' && (p.status === 'active' || p.status === 'completed') && can('services.billing.create') && can('selling.sales_invoice.create') && (
                              <Button size="sm" loading={invoice.isPending && invoice.variables === m.id} onClick={() => invoice.mutate(m.id)}>
                                Create invoice
                              </Button>
                            )}
                            {m.state === 'pending' && planning && edit && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'milestone', milestone: m })}>
                                  Edit
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => removeMilestone.mutate(m.id)}>
                                  Remove
                                </Button>
                              </>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card>

            {Number(p.retentionPct) > 0 && (
              <Card>
                <CardHeader
                  title="Retention"
                  description={`${Number(p.retentionPct)}% of each invoice total is withheld by the customer. ${p.retentionDueOn ? `Due for release on ${formatDate(p.retentionDueOn)}.` : `Due ${p.dlpMonths} months after completion.`} Record its release when the money arrives; the receipt itself goes in receivables.`}
                />
                {p.retention.length === 0 ? (
                  <EmptyState size="compact" title="Nothing invoiced yet" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <thead>
                        <tr>
                          <Th>Invoice</Th>
                          <Th className="text-right">Retention</Th>
                          <Th>Released</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody>
                        {p.retention.map((r) => (
                          <tr key={r.id} className="border-t border-line text-[13px]">
                            <Td>
                              <Link href={`/app/selling/invoices/${r.salesInvoiceId}`} className="hover:text-accent">
                                {r.invoiceNumber ?? 'Draft invoice'}
                              </Link>
                              <p className="text-[12px] text-subtle">{r.milestoneName}</p>
                            </Td>
                            <Td className="text-right font-mono">{formatMoney(r.amount)}</Td>
                            <Td>{r.releasedOn ? `${formatDate(r.releasedOn)} · ${r.releaseRef}` : <Badge tone="warning">Held</Badge>}</Td>
                            <Td className="text-right">
                              {!r.releasedOn && approve && r.invoiceStatus === 'submitted' && (
                                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'release', id: r.id, label: r.invoiceNumber ?? '' })}>
                                  Record release
                                </Button>
                              )}
                            </Td>
                          </tr>
                        ))}
                        <tr className="border-t border-line text-[13px] font-medium">
                          <Td>Held · released</Td>
                          <Td className="text-right font-mono">{formatMoney(p.retentionHeld)}</Td>
                          <Td className="font-mono">{formatMoney(p.retentionReleased)}</Td>
                          <Td />
                        </tr>
                      </tbody>
                    </Table>
                  </div>
                )}
              </Card>
            )}

            <Card>
              <CardHeader
                title="Budget and actual cost"
                description="Actual cost from linked work orders (material, machine time absorbed, job work), machine bookings at the work centre rate, tagged purchase lines (submitted invoices) and approved hours."
                actions={
                  planning &&
                  edit && (
                    <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'budget' })}>
                      Edit budget
                    </Button>
                  )
                }
              />
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>Category</Th>
                      <Th className="text-right">Budget</Th>
                      <Th className="text-right">Actual</Th>
                      <Th className="text-right">Remaining</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.budget.map((b) => (
                      <tr key={b.category} className="border-t border-line text-[13px]">
                        <Td>{COST_CATEGORY[b.category]}</Td>
                        <Td className="text-right font-mono">{formatMoney(b.budget)}</Td>
                        <Td className="text-right font-mono">{formatMoney(b.actual)}</Td>
                        <Td className={`text-right font-mono ${Number(b.variance) < 0 ? 'text-danger' : ''}`}>{formatMoney(b.variance)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {p.sources.length > 0 && (
                <details className="border-t border-line px-4 py-3 text-[13px]">
                  <summary className="cursor-pointer text-muted">Where the cost comes from ({p.sources.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {p.sources.map((s, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>
                          <span className="text-subtle">{COST_CATEGORY[s.category].split(' (')[0]} · </span>
                          {s.reference}
                        </span>
                        <span className="font-mono">{formatMoney(s.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Linked work"
                description="Bookings and test campaigns linked here are billed through the milestones, never on their own."
                actions={
                  linking && (
                    <div className="flex flex-wrap gap-2">
                      {planning && can('services.booking.create') && (
                        <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'book' })}>
                          Book machine
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setDialog({ kind: 'link' })}>
                        Link document
                      </Button>
                    </div>
                  )
                }
              />
              <LinkedWork p={p} canUnlink={!!linking} onUnlink={(kind, linkId) => unlink.mutate({ kind, linkId })} />
            </Card>

            <Card>
              <CardHeader title="Hours" description={p.hours.some((h) => h.cost !== null) ? 'Approved hours are valued at each person’s cost rate on the day worked.' : 'Approved hours count as labour; rates are visible only to those who manage them.'} />
              {p.hours.length === 0 ? (
                <EmptyState size="compact" title="No hours recorded" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Person</Th>
                        <Th className="text-right">Approved h</Th>
                        <Th className="text-right">Awaiting h</Th>
                        <Th className="text-right">Cost</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.hours.map((h) => (
                        <tr key={h.userId} className="border-t border-line text-[13px]">
                          <Td>{h.name}</Td>
                          <Td className="text-right font-mono">{Number(h.approvedHours)}</Td>
                          <Td className="text-right font-mono">{Number(h.pendingHours) || '—'}</Td>
                          <Td className="text-right font-mono">{h.cost === null ? '—' : formatMoney(h.cost)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card>

            {can('quality.attachment.read') && <AttachmentsPanel ownerType="project" ownerId={p.id} defaultKind="other" title="Contract, acceptances and deliverables" />}
          </div>
        )}
      </EntityGate>
      {p && dialog?.kind === 'edit' && <ProjectDialog project={p} onClose={() => setDialog(null)} onSaved={refresh} />}
      {p && dialog?.kind === 'milestone' && <MilestoneDialog projectId={p.id} milestone={dialog.milestone} onClose={() => setDialog(null)} onDone={refresh} />}
      {p && dialog?.kind === 'achieve' && <AchieveDialog milestone={dialog.milestone} onClose={() => setDialog(null)} onDone={refresh} />}
      {p && dialog?.kind === 'release' && <ReleaseDialog id={dialog.id} label={dialog.label} onClose={() => setDialog(null)} onDone={refresh} />}
      {p && dialog?.kind === 'budget' && <BudgetDialog p={p} onClose={() => setDialog(null)} onDone={refresh} />}
      {p && dialog?.kind === 'link' && <LinkDialog projectId={p.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {p && dialog?.kind === 'complete' && <CompleteDialog p={p} onClose={() => setDialog(null)} onDone={refresh} />}
      {p && dialog?.kind === 'cancel' && <CancelDialog id={p.id} number={p.number} onClose={() => setDialog(null)} onDone={refresh} />}
      {p && dialog?.kind === 'book' && <BookingDialog booking={null} project={{ id: p.id, number: p.number, customerId: p.customerId }} onClose={() => setDialog(null)} />}
    </>
  );
}

function LinkedWork({ p, canUnlink, onUnlink }: { p: ProjectDetail; canUnlink: boolean; onUnlink: (kind: LinkKind, id: string) => void }) {
  const { bookings, campaigns, workOrders, purchaseLines } = p.links;
  if (!bookings.length && !campaigns.length && !workOrders.length && !purchaseLines.length) return <EmptyState size="compact" title="Nothing linked yet" />;
  const Unlink = ({ kind, id }: { kind: LinkKind; id: string }) =>
    canUnlink ? (
      <Button size="sm" variant="ghost" onClick={() => onUnlink(kind, id)}>
        Unlink
      </Button>
    ) : null;
  return (
    <ul className="divide-y divide-line text-[13px]">
      {campaigns.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
          <span>
            <span className="text-subtle">Test campaign · </span>
            <Link href={`/app/services/campaigns/${c.id}`} className="font-mono font-medium hover:text-accent">
              {c.number}
            </Link>{' '}
            {c.title} <Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge>
          </span>
          {c.status !== 'closed' && <Unlink kind="campaign" id={c.id} />}
        </li>
      ))}
      {bookings.map((b) => (
        <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2">
          <span>
            <span className="text-subtle">Booking · </span>
            <Link href={`/app/services/bookings/${b.id}`} className="font-mono font-medium hover:text-accent">
              {b.number}
            </Link>{' '}
            {b.machineCode} <Badge tone={BOOKING_STATUS[b.status].tone}>{BOOKING_STATUS[b.status].label}</Badge>
            <span className="block text-muted">
              {formatDateTime(b.startsAt)} → {formatDateTime(b.endsAt)}
              {b.campaignId && ' · via its campaign'}
            </span>
          </span>
          {!b.campaignId && <Unlink kind="booking" id={b.id} />}
        </li>
      ))}
      {workOrders.map((w) => (
        <li key={w.id} className="flex items-center justify-between gap-2 px-4 py-2">
          <span>
            <span className="text-subtle">Work order · </span>
            <Link href={`/app/manufacturing/work-orders/${w.id}`} className="font-mono font-medium hover:text-accent">
              {w.number ?? 'Draft'}
            </Link>{' '}
            {w.itemCode} × {Number(w.plannedQty)} <Badge tone="neutral">{w.status}</Badge>
          </span>
          <Unlink kind="work_order" id={w.id} />
        </li>
      ))}
      {purchaseLines.map((l) => (
        <li key={l.id} className="flex items-center justify-between gap-2 px-4 py-2">
          <span>
            <span className="text-subtle">Purchase · </span>
            <Link href={`/app/buying/invoices/${l.invoiceId}`} className="font-mono font-medium hover:text-accent">
              {l.number ?? 'Draft'}
            </Link>{' '}
            {l.supplierName} · {l.itemCode} {l.itemName} <span className="font-mono">{l.currency === 'INR' ? formatMoney(l.taxableValue) : `${l.currency} ${l.taxableValue}`}</span>
            {l.status !== 'submitted' && <span className="text-muted"> (counts once submitted)</span>}
          </span>
          <Unlink kind="purchase_invoice_line" id={l.id} />
        </li>
      ))}
    </ul>
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

/** A small form posting to the project API, closing and refreshing on success. */
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

function MilestoneDialog({ projectId, milestone, onClose, onDone }: { projectId: string; milestone: Milestone | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: milestone?.name ?? '', amount: milestone ? String(Number(milestone.amount)) : '', dueDate: milestone?.dueDate ?? '' });
  const m = useAction(milestone ? `/services/milestones/${milestone.id}` : `/services/projects/${projectId}/milestones`, milestone ? 'PUT' : 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormDialog title={milestone ? `Change milestone ${milestone.seq}` : 'Add milestone'} description="Amounts are before GST; together they make up the contract value." onClose={onClose} onSubmit={() => m.mutate({ ...f, dueDate: f.dueDate || null })} pending={m.isPending} error={m.error} submitLabel={milestone ? 'Save' : 'Add milestone'}>
      <Field label="Milestone" error={err.name}>{(p) => <Input {...p} value={f.name} onChange={set('name')} required autoFocus placeholder="Design review (PDR)" />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount (₹)" error={err.amount}>{(p) => <Input {...p} value={f.amount} onChange={set('amount')} inputMode="decimal" required />}</Field>
        <Field label="Due" error={err.dueDate}>{(p) => <DateInput {...p} value={f.dueDate} onChange={set('dueDate')} />}</Field>
      </div>
    </FormDialog>
  );
}

function AchieveDialog({ milestone, onClose, onDone }: { milestone: Milestone; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ acceptanceRef: '', achievedOn: '' });
  const m = useAction(`/services/milestones/${milestone.id}/achieve`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Achieved: ${milestone.name}`} description="Attach the customer’s acceptance certificate to the project files." onClose={onClose} onSubmit={() => m.mutate({ acceptanceRef: f.acceptanceRef, ...(f.achievedOn ? { achievedOn: f.achievedOn } : {}) })} pending={m.isPending} error={m.error} submitLabel="Mark achieved">
      <Field label="Customer’s acceptance reference" error={err.acceptanceRef}>{(p) => <Input {...p} value={f.acceptanceRef} onChange={(e) => setF({ ...f, acceptanceRef: e.target.value })} required autoFocus placeholder="Minutes of meeting, acceptance certificate no." />}</Field>
      <Field label="Achieved on" hint="Today if left empty" error={err.achievedOn}>{(p) => <DateInput {...p} value={f.achievedOn} onChange={(e) => setF({ ...f, achievedOn: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function ReleaseDialog({ id, label, onClose, onDone }: { id: string; label: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ releaseRef: '', releasedOn: '' });
  const m = useAction(`/services/retention/${id}/release`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Retention released on ${label}`} description="Enter the customer’s payment as a receipt in receivables as usual; this records that the retention is no longer held." onClose={onClose} onSubmit={() => m.mutate({ releaseRef: f.releaseRef, ...(f.releasedOn ? { releasedOn: f.releasedOn } : {}) })} pending={m.isPending} error={m.error} submitLabel="Record release">
      <Field label="Receipt or reference" error={err.releaseRef}>{(p) => <Input {...p} value={f.releaseRef} onChange={(e) => setF({ ...f, releaseRef: e.target.value })} required autoFocus />}</Field>
      <Field label="Received on" hint="Today if left empty" error={err.releasedOn}>{(p) => <DateInput {...p} value={f.releasedOn} onChange={(e) => setF({ ...f, releasedOn: e.target.value })} />}</Field>
    </FormDialog>
  );
}

function BudgetDialog({ p, onClose, onDone }: { p: ProjectDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Record<CostCategory, string>>(Object.fromEntries(p.budget.map((b) => [b.category, Number(b.budget) ? String(Number(b.budget)) : ''])) as Record<CostCategory, string>);
  const m = useAction(`/services/projects/${p.id}/budget`, 'PUT', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Budget" description="Planned cost by category, before GST." onClose={onClose} onSubmit={() => m.mutate({ lines: (Object.keys(f) as CostCategory[]).filter((c) => f[c]).map((c) => ({ category: c, amount: f[c] })) })} pending={m.isPending} error={m.error} submitLabel="Save budget">
      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(COST_CATEGORY) as CostCategory[]).map((c) => (
          <Field key={c} label={`${COST_CATEGORY[c].split(' (')[0]} (₹)`} error={err.lines}>
            {(props) => <Input {...props} value={f[c] ?? ''} onChange={(e) => setF({ ...f, [c]: e.target.value })} inputMode="decimal" />}
          </Field>
        ))}
      </div>
    </FormDialog>
  );
}

function LinkDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [kind, setKind] = useState<LinkKind>('work_order');
  const [target, setTarget] = useState('');
  const options = useQuery({ queryKey: ['project-link-candidates', projectId, kind], queryFn: () => api<{ id: string; label: string }[]>(`/services/projects/${projectId}/link-candidates?kind=${kind}`, { scope: ws.scope }) });
  const m = useAction(`/services/projects/${projectId}/links`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title="Link a document" description="Its cost counts towards this project. Bookings and campaigns must be for the project’s customer and not billed on their own." onClose={onClose} onSubmit={() => m.mutate({ kind, id: target })} pending={m.isPending} error={m.error} submitLabel="Link" wide>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Kind" error={err.kind}>
          {(p) => (
            <Select
              {...p}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as LinkKind);
                setTarget('');
              }}
            >
              {(Object.keys(LINK_KIND) as LinkKind[]).map((k) => (
                <option key={k} value={k}>
                  {LINK_KIND[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Document" error={err.id} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)} required>
              <option value="">{options.data?.length === 0 ? 'Nothing to link' : 'Choose…'}</option>
              {options.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

function CompleteDialog({ p, onClose, onDone }: { p: ProjectDetail; onClose: () => void; onDone: () => void }) {
  const [completedOn, setCompletedOn] = useState('');
  const m = useAction(`/services/projects/${p.id}/complete`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog
      title={`Complete ${p.number}`}
      description={`Every milestone must be achieved and linked bookings and campaigns finished.${Number(p.retentionPct) ? ` Retention falls due ${p.dlpMonths} months after this date.` : ''}`}
      onClose={onClose}
      onSubmit={() => m.mutate(completedOn ? { completedOn } : {})}
      pending={m.isPending}
      error={m.error}
      submitLabel="Complete project"
    >
      <Field label="Completed on" hint="Today if left empty" error={err.completedOn}>{(props) => <DateInput {...props} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />}</Field>
    </FormDialog>
  );
}

function CancelDialog({ id, number, onClose, onDone }: { id: string; number: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const m = useAction(`/services/projects/${id}/cancel`, 'POST', onDone, onClose);
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={`Cancel ${number}`} description="Milestone invoices must be deleted or cancelled first, and open bookings cancelled." onClose={onClose} onSubmit={() => m.mutate({ reason })} pending={m.isPending} error={m.error} submitLabel="Cancel project">
      <Field label="Reason" error={err.reason}>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}</Field>
    </FormDialog>
  );
}
