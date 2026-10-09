'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { WorkCentre } from '@/lib/manufacturing';
import { BLOCK_KIND, type Calendar, type MachineBlock, type Shift, WEEKDAYS } from '@/lib/scheduling';

export default function CalendarsPage() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<Calendar | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Working calendars"
        description="Shifts and holidays decide when machines work. Work centres use the default calendar unless they name another; downtime takes a machine out of the schedule."
        actions={ws.entityId && ws.can('manufacturing.calendar.update') && <Button onClick={() => setEditing('new')}>New calendar</Button>}
      />
      <EntityGate what="manufacturing">
        <div className="space-y-4">
          <Calendars onEdit={setEditing} />
          <Downtime />
        </div>
      </EntityGate>
      {editing && <CalendarDialog calendar={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Weekly hours of a calendar, for the summary. */
const weeklyHours = (shifts: Shift[]) =>
  shifts.reduce((s, sh) => {
    const [a, b] = [sh.start, sh.end].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
    return s + ((b! - a! + 1440) % 1440 || 1440) / 60;
  }, 0);

function Calendars({ onEdit }: { onEdit: (c: Calendar) => void }) {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['calendars', ws.entityId], queryFn: () => api<Calendar[]>('/manufacturing/calendars', { scope: ws.scope }) });
  if (q.data?.length === 0)
    return (
      <Card>
        <EmptyState icon={<CalendarClock className="size-5" />} title="No calendars yet" description="Add your plant's shift pattern, e.g. two shifts Monday to Saturday, and its holidays." />
      </Card>
    );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {q.data?.map((c) => (
        <Card key={c.id}>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                {c.name}
                {c.isDefault && <Badge tone="info">Default</Badge>}
                {!c.isActive && <Badge tone="neutral">Inactive</Badge>}
              </span>
            }
            description={`${weeklyHours(c.shifts)} h a week · ${c.timeZone}${c.workCentres.length ? ` · ${c.workCentres.join(', ')}` : ''}`}
            actions={
              ws.can('manufacturing.calendar.update') && (
                <Button size="sm" variant="secondary" onClick={() => onEdit(c)}>
                  Edit
                </Button>
              )
            }
          />
          <ul className="px-4 py-3 text-[13px]">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const day = c.shifts.filter((s) => s.weekday === d);
              return (
                <li key={d} className="flex gap-2">
                  <span className="w-10 text-muted">{WEEKDAYS[d]}</span>
                  <span>{day.length ? day.map((s) => `${s.start}–${s.end}`).join(', ') : <span className="text-subtle">Off</span>}</span>
                </li>
              );
            })}
          </ul>
          {c.holidays.length > 0 && (
            <p className="border-t border-line px-4 py-2 text-[13px] text-muted">
              {c.holidays.length} holiday{c.holidays.length === 1 ? '' : 's'}, next{' '}
              {(() => {
                const today = new Date().toISOString().slice(0, 10);
                const n = c.holidays.find((h) => h.date >= today);
                return n ? `${n.name} on ${formatDate(n.date)}` : 'none this year';
              })()}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

const TIME_ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'UTC'];

function CalendarDialog({ calendar, onClose }: { calendar: Calendar | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: calendar?.name ?? '', timeZone: calendar?.timeZone ?? 'Asia/Kolkata', isDefault: calendar?.isDefault ?? false, isActive: calendar?.isActive ?? true });
  const [shifts, setShifts] = useState<Shift[]>(calendar?.shifts ?? [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '17:30' })));
  const [holidays, setHolidays] = useState(calendar?.holidays ?? []);
  const m = useMutation({
    mutationFn: () => api(calendar ? `/manufacturing/calendars/${calendar.id}` : '/manufacturing/calendars', { method: calendar ? 'PUT' : 'POST', scope: ws.scope, body: { ...f, shifts, holidays } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendars'] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  const setShift = (i: number, p: Partial<Shift>) => setShifts(shifts.map((s, k) => (k === i ? { ...s, ...p } : s)));
  /** Copies every holiday a year forward, for next year's list. */
  const rollForward = () => {
    const next = holidays.map((h) => ({ date: `${Number(h.date.slice(0, 4)) + 1}${h.date.slice(4)}`, name: h.name }));
    setHolidays([...holidays, ...next.filter((n) => !holidays.some((h) => h.date === n.date))].sort((a, b) => a.date.localeCompare(b.date)));
  };
  return (
    <FormDialog title={calendar ? `Edit ${calendar.name}` : 'New calendar'} description="A shift that ends at or before its start runs past midnight and counts on the day it starts." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Save" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={err.name}>
          {(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus placeholder="Two shifts" />}
        </Field>
        <Field label="Time zone" error={err.timeZone}>
          {(p) => (
            <Select {...p} value={f.timeZone} onChange={(e) => setF({ ...f, timeZone: e.target.value })}>
              {TIME_ZONES.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
          Default calendar
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Active
        </label>
      </div>
      {err.isDefault && <Alert tone="danger">{err.isDefault}</Alert>}
      <div>
        <p className="mb-1 text-[13px] font-medium">Shifts</p>
        {err.shifts && <p className="mb-1 text-[13px] text-danger">{(m.error as Error).message}</p>}
        <div className="space-y-2">
          {shifts.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label={`Day of shift ${i + 1}`} className="w-24" value={s.weekday} onChange={(e) => setShift(i, { weekday: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAYS[d]}
                  </option>
                ))}
              </Select>
              <Input aria-label={`Start of shift ${i + 1}`} type="time" className="w-32" value={s.start} onChange={(e) => setShift(i, { start: e.target.value })} required />
              <span className="text-muted">to</span>
              <Input aria-label={`End of shift ${i + 1}`} type="time" className="w-32" value={s.end} onChange={(e) => setShift(i, { end: e.target.value })} required />
              <Button size="icon" variant="ghost" aria-label={`Remove shift ${i + 1}`} onClick={() => setShifts(shifts.filter((_, k) => k !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShifts([...shifts, { weekday: 1, start: '14:00', end: '22:00' }])}>
            <Plus className="size-4" /> Add shift
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Repeat Monday's shifts on Tuesday to Saturday.
              const mon = shifts.filter((s) => s.weekday === 1);
              setShifts([...mon, ...[2, 3, 4, 5, 6].flatMap((weekday) => mon.map((s) => ({ ...s, weekday })))]);
            }}
          >
            Copy Monday to Tue–Sat
          </Button>
        </div>
      </div>
      <div>
        <p className="mb-1 text-[13px] font-medium">Holidays</p>
        <div className="space-y-2">
          {holidays.map((h, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input aria-label={`Holiday ${i + 1} date`} type="date" className="w-44" value={h.date} onChange={(e) => setHolidays(holidays.map((x, k) => (k === i ? { ...x, date: e.target.value } : x)))} required />
              <Input aria-label={`Holiday ${i + 1} name`} className="min-w-40 flex-1" value={h.name} onChange={(e) => setHolidays(holidays.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} required />
              <Button size="icon" variant="ghost" aria-label={`Remove holiday ${i + 1}`} onClick={() => setHolidays(holidays.filter((_, k) => k !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setHolidays([...holidays, { date: '', name: '' }])}>
            <Plus className="size-4" /> Add holiday
          </Button>
          {holidays.length > 0 && (
            <Button size="sm" variant="ghost" onClick={rollForward}>
              Copy to next year
            </Button>
          )}
        </div>
      </div>
    </FormDialog>
  );
}

function Downtime() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MachineBlock | 'new' | null>(null);
  const from = new Date(Date.now() - 86400e3).toISOString();
  const q = useQuery({ queryKey: ['machine-blocks', ws.entityId], queryFn: () => api<MachineBlock[]>(`/manufacturing/machine-blocks?from=${encodeURIComponent(from)}`, { scope: ws.scope }) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/manufacturing/machine-blocks/${id}`, { method: 'DELETE', scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['machine-blocks'] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
  const canEdit = ws.can('manufacturing.calendar.update');
  return (
    <Card>
      <CardHeader
        title="Machine downtime"
        description="Maintenance and breakdowns. The scheduler leaves this time free; reschedule after adding one."
        actions={
          canEdit && (
            <Button size="sm" onClick={() => setEditing('new')}>
              Add downtime
            </Button>
          )
        }
      />
      {del.error && <Alert tone="danger" className="mx-4 mb-2">{del.error.message}</Alert>}
      {q.data?.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted">No downtime planned.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Machine</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Reason</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((b) => (
                <tr key={b.id} className="border-t border-line text-[13px]">
                  <Td>
                    <span className="font-mono">{b.machineCode}</span> <Badge tone={b.kind === 'breakdown' ? 'danger' : 'warning'}>{BLOCK_KIND[b.kind]}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(b.startsAt)}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(b.endsAt)}</Td>
                  <Td>{b.reason}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {canEdit && b.kind !== 'booking' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>
                          Edit
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={`Remove downtime ${b.reason}`} onClick={() => del.mutate(b.id)}>
                          <Trash2 className="size-4" />
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
      {editing && <BlockDialog block={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/** `datetime-local` value in IST for an instant, and back. */
const toLocal = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16);
const fromLocal = (v: string) => new Date(`${v}:00+05:30`).toISOString();

function BlockDialog({ block, onClose }: { block: MachineBlock | null; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const centres = useQuery({ queryKey: ['work-centres', ws.entityId], queryFn: () => api<WorkCentre[]>('/manufacturing/work-centres', { scope: ws.scope }) });
  const hour = new Date();
  hour.setMinutes(0, 0, 0);
  const [f, setF] = useState({
    machineId: block?.machineId ?? '',
    kind: (block?.kind === 'breakdown' ? 'breakdown' : 'maintenance') as 'maintenance' | 'breakdown',
    startsAt: toLocal(block?.startsAt ?? new Date(hour.getTime() + 3600e3).toISOString()),
    endsAt: toLocal(block?.endsAt ?? new Date(hour.getTime() + 5 * 3600e3).toISOString()),
    reason: block?.reason ?? '',
  });
  const m = useMutation({
    mutationFn: () => api(block ? `/manufacturing/machine-blocks/${block.id}` : '/manufacturing/machine-blocks', { method: block ? 'PUT' : 'POST', scope: ws.scope, body: { ...f, startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['machine-blocks'] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      onClose();
    },
  });
  const err = fieldErrors(m.error);
  return (
    <FormDialog title={block ? 'Edit downtime' : 'Add downtime'} description="Times are in IST." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Save">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Machine" error={err.machineId}>
          {(p) => (
            <Select {...p} value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })} required autoFocus>
              <option value="">Choose…</option>
              {centres.data?.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.machines.map((mc) => (
                    <option key={mc.id} value={mc.id}>
                      {mc.code} · {mc.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Kind">
          {(p) => (
            <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>
              <option value="maintenance">Maintenance</option>
              <option value="breakdown">Breakdown</option>
            </Select>
          )}
        </Field>
        <Field label="From" error={err.startsAt}>
          {(p) => <Input {...p} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required />}
        </Field>
        <Field label="To" error={err.endsAt}>
          {(p) => <Input {...p} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} required />}
        </Field>
      </div>
      <Field label="Reason" error={err.reason}>
        {(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required placeholder="Spindle service" />}
      </Field>
    </FormDialog>
  );
}
