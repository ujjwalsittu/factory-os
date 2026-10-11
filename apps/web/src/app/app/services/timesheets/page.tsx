'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { type TimesheetEntry, TIMESHEET_STATUS } from '@/lib/services';

type ProjectOption = { id: string; number: string; title: string; milestones: { id: string; name: string }[] };
type Dialog = { kind: 'entry'; entry: TimesheetEntry | null } | { kind: 'reject'; entry: TimesheetEntry } | { kind: 'reverse'; entry: TimesheetEntry };

const ist = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
/** Monday of the IST week containing `iso`, shifted by `weeks`. */
function weekStart(iso: string, weeks = 0) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + weeks * 7);
  return d.toISOString().slice(0, 10);
}
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Own hours on projects by week, submitted for approval; approvers review everyone's (decision 058). */
export default function TimesheetsPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const today = ist(new Date());
  const [from, setFrom] = useState(weekStart(today));
  const to = addDays(from, 6);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const approver = ws.can('services.timesheet.approve');
  const mine = useQuery({ queryKey: ['timesheets', ws.entityId, 'mine', from], queryFn: () => api<TimesheetEntry[]>(`/services/timesheets?from=${from}&to=${to}`, { scope: ws.scope }), enabled: !!ws.entityId });
  const queue = useQuery({ queryKey: ['timesheets', ws.entityId, 'queue'], queryFn: () => api<TimesheetEntry[]>('/services/timesheets?scope=all&status=submitted', { scope: ws.scope }), enabled: !!ws.entityId && approver });
  const approved = useQuery({ queryKey: ['timesheets', ws.entityId, 'approved', from], queryFn: () => api<TimesheetEntry[]>(`/services/timesheets?scope=all&status=approved&from=${from}&to=${to}`, { scope: ws.scope }), enabled: !!ws.entityId && approver });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['timesheets'] });
    void qc.invalidateQueries({ queryKey: ['project'] });
  };
  const submit = useMutation({ mutationFn: () => api(`/services/timesheets/submit`, { method: 'POST', scope: ws.scope, body: { from, to } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/services/timesheets/${id}`, { method: 'DELETE', scope: ws.scope }), onSuccess: refresh });
  const approve = useMutation({ mutationFn: (id: string) => api(`/services/timesheets/${id}/approve`, { method: 'POST', scope: ws.scope }), onSuccess: refresh });
  const entries = mine.data ?? [];
  const total = entries.reduce((s, e) => s + Number(e.hours), 0);
  const drafts = entries.filter((e) => e.status === 'draft').length;
  const error = submit.error ?? remove.error ?? approve.error;
  const others = (queue.data ?? []).filter((e) => !e.mine);
  return (
    <>
      <PageHeader
        title="Timesheets"
        description="Your hours on active projects, week by week. Submit the week for approval; approved hours are valued at your cost rate and count as project labour."
        actions={ws.entityId && ws.can('services.timesheet.create') && <Button onClick={() => setDialog({ kind: 'entry', entry: null })}>Add hours</Button>}
      />
      <EntityGate what="services">
        {error && <Alert tone="danger" className="mb-3">{error.message}</Alert>}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={`Week of ${formatDate(from)}`}
              description={`${total} h this week${drafts ? ` · ${drafts} draft ${drafts === 1 ? 'entry' : 'entries'} not yet submitted` : ''}`}
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setFrom(weekStart(from, -1))}>
                    ← Previous
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setFrom(weekStart(today))} disabled={from === weekStart(today)}>
                    This week
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setFrom(weekStart(from, 1))} disabled={from >= weekStart(today)}>
                    Next →
                  </Button>
                  {drafts > 0 && ws.can('services.timesheet.create') && (
                    <Button size="sm" loading={submit.isPending} onClick={() => submit.mutate()}>
                      Submit week
                    </Button>
                  )}
                </div>
              }
            />
            {entries.length === 0 ? (
              <p className="px-4 pb-4 text-[13px] text-muted">No hours this week.</p>
            ) : (
              <EntryTable
                entries={entries}
                actions={(e) =>
                  e.status === 'draft' && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'entry', entry: e })}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(e.id)}>
                        Delete
                      </Button>
                    </>
                  )
                }
              />
            )}
          </Card>

          {approver && (
            <Card>
              <CardHeader title="Awaiting your approval" description="Approval values the hours at the person’s cost rate on the day worked. Your own hours are approved by someone else." />
              {others.length === 0 ? (
                <p className="px-4 pb-4 text-[13px] text-muted">Nothing to approve.</p>
              ) : (
                <EntryTable
                  entries={others}
                  showPerson
                  actions={(e) => (
                    <>
                      <Button size="sm" loading={approve.isPending && approve.variables === e.id} onClick={() => approve.mutate(e.id)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'reject', entry: e })}>
                        Send back
                      </Button>
                    </>
                  )}
                />
              )}
            </Card>
          )}

          {approver && (approved.data?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Approved this week" description="Approved hours never change; a correction is a reversal." />
              <EntryTable
                entries={approved.data!}
                showPerson
                actions={(e) =>
                  !e.mine &&
                  !e.reversalOf &&
                  Number(e.hours) > 0 &&
                  !approved.data!.some((x) => x.reversalOf === e.id) && (
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'reverse', entry: e })}>
                      Reverse
                    </Button>
                  )
                }
              />
            </Card>
          )}
        </div>
      </EntityGate>
      {dialog?.kind === 'entry' && <EntryDialog entry={dialog.entry} defaultDate={today < to ? today : to} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'reject' && <ReasonDialog title="Send back" description="The hours return to the person as a draft with your reason." path={`/services/timesheets/${dialog.entry.id}/reject`} submitLabel="Send back" onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'reverse' && <ReasonDialog title="Reverse approved hours" description="A negative entry at the same rate cancels them out." path={`/services/timesheets/${dialog.entry.id}/reverse`} submitLabel="Reverse" onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

function EntryTable({ entries, showPerson, actions }: { entries: TimesheetEntry[]; showPerson?: boolean; actions: (e: TimesheetEntry) => React.ReactNode }) {
  const costs = entries.some((e) => e.costAmount !== null);
  return (
    <div className="overflow-x-auto">
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            {showPerson && <Th>Person</Th>}
            <Th>Project</Th>
            <Th className="text-right">Hours</Th>
            {costs && <Th className="text-right">Cost</Th>}
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-line text-[13px]">
              <Td className="whitespace-nowrap">{formatDate(e.workDate)}</Td>
              {showPerson && <Td>{e.personName}</Td>}
              <Td>
                <span className="font-mono">{e.projectNumber}</span> {e.projectTitle}
                {e.milestoneName && <span className="text-subtle"> · {e.milestoneName}</span>}
                {e.notes && <p className="text-[12px] text-muted">{e.notes}</p>}
                {e.rejectReason && <p className="text-[12px] text-danger">Sent back: {e.rejectReason}</p>}
              </Td>
              <Td className="text-right font-mono">{Number(e.hours)}</Td>
              {costs && <Td className="text-right font-mono">{e.costAmount === null ? '—' : formatMoney(e.costAmount)}</Td>}
              <Td>
                <Badge tone={TIMESHEET_STATUS[e.status].tone}>{TIMESHEET_STATUS[e.status].label}</Badge>
              </Td>
              <Td className="text-right whitespace-nowrap">{actions(e)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function EntryDialog({ entry, defaultDate, onClose, onDone }: { entry: TimesheetEntry | null; defaultDate: string; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const projects = useQuery({ queryKey: ['timesheet-projects', ws.entityId], queryFn: () => api<ProjectOption[]>('/services/timesheets/projects', { scope: ws.scope }) });
  const [f, setF] = useState({ projectId: entry?.projectId ?? '', milestoneId: entry?.milestoneId ?? '', workDate: entry?.workDate ?? defaultDate, hours: entry ? String(Number(entry.hours)) : '', notes: entry?.notes ?? '' });
  const m = useMutation({
    mutationFn: () => api(entry ? `/services/timesheets/${entry.id}` : '/services/timesheets', { method: entry ? 'PUT' : 'POST', scope: ws.scope, body: { ...f, milestoneId: f.milestoneId || null, notes: f.notes || null } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const project = projects.data?.find((p) => p.id === f.projectId);
  return (
    <FormDialog title={entry ? 'Change hours' : 'Add hours'} description="Quarter hours, up to 24 a day across projects." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Save">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project" error={err.projectId}>
          {(p) => (
            <Select {...p} value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value, milestoneId: '' })} required autoFocus>
              <option value="">{projects.data?.length === 0 ? 'No active projects' : 'Choose…'}</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number} · {p.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Milestone" error={err.milestoneId}>
          {(p) => (
            <Select {...p} value={f.milestoneId} onChange={set('milestoneId')} disabled={!project}>
              <option value="">Any</option>
              {project?.milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Date" error={err.workDate}>{(p) => <Input {...p} type="date" value={f.workDate} onChange={set('workDate')} required />}</Field>
        <Field label="Hours" error={err.hours}>{(p) => <Input {...p} value={f.hours} onChange={set('hours')} inputMode="decimal" required placeholder="7.5" />}</Field>
      </div>
      <Field label="What you worked on" error={err.notes}>{(p) => <Input {...p} value={f.notes} onChange={set('notes')} />}</Field>
    </FormDialog>
  );
}

function ReasonDialog({ title, description, path, submitLabel, onClose, onDone }: { title: string; description: string; path: string; submitLabel: string; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(path, { method: 'POST', scope: ws.scope, body: { reason } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={title} description={description} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel={submitLabel}>
      <Field label="Reason" error={err.reason}>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />}</Field>
    </FormDialog>
  );
}
