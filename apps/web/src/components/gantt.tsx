'use client';
import { cn } from '@factoryos/ui';
import { Pin } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';
import { type Bar, barColour, type ScheduleView } from '@/lib/scheduling';

const MIN = 60000;
const SNAP = 15;

/** Hour and day labels in the calendar's time zone. */
function labels(timeZone: string) {
  const hour = new Intl.DateTimeFormat('en-IN', { timeZone, hour: '2-digit', hour12: false });
  const day = new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'short', day: '2-digit', month: 'short' });
  return { hour: (d: Date) => hour.format(d), day: (d: Date) => day.format(d) };
}

/**
 * One row per machine, grouped by work centre, plus a "Job work" lane. Non-working time is shaded and downtime
 * hatched. Bars drag along time and between machines of the same work centre, snapping to 15 minutes.
 */
export function Gantt({
  view,
  from,
  hours,
  pxPerHour,
  canMove,
  selected,
  onSelect,
  onMove,
}: {
  view: ScheduleView;
  from: Date;
  hours: number;
  pxPerHour: number;
  canMove: boolean;
  selected: string | null;
  onSelect: (b: Bar | null) => void;
  onMove: (b: Bar, machineId: string, start: Date) => void;
}) {
  const t0 = from.getTime();
  const t1 = t0 + hours * 3600e3;
  const width = hours * pxPerHour;
  const x = (iso: string | Date) => ((new Date(iso).getTime() - t0) / 3600e3) * pxPerHour;
  const l = labels(view.timeZone);
  const rows = view.machines;
  const centres = [...new Map(rows.map((m) => [m.workCentreId, m.workCentre])).entries()];
  const outsourced = view.bars.filter((b) => !b.machineId);
  const [drag, setDrag] = useState<{ bar: Bar; dx: number; dy: number; startX: number; startY: number } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const tickEvery = pxPerHour >= 40 ? 1 : pxPerHour >= 12 ? 4 : 12;
  const ticks: Date[] = [];
  for (let t = t0; t <= t1; t += tickEvery * 3600e3) ticks.push(new Date(t));

  const targetRow = (bar: Bar, clientY: number) => {
    for (const m of rows) {
      const el = rowRefs.current.get(m.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) {
        const own = rows.find((o) => o.id === bar.machineId);
        return own && m.workCentreId === own.workCentreId ? m.id : bar.machineId;
      }
    }
    return bar.machineId;
  };

  const barEl = (b: Bar) => {
    const left = Math.max(0, x(b.startsAt));
    const right = Math.min(width, x(b.endsAt));
    if (right <= 0 || left >= width) return null;
    const dragging = drag?.bar.operationId === b.operationId;
    const movable = canMove && !!b.machineId && !b.running;
    return (
      <button
        key={b.operationId}
        type="button"
        aria-label={`${b.number} operation ${b.seq} ${b.name}`}
        title={`${b.number} · ${b.seq} ${b.name} · ${b.itemCode}${b.late ? ' · late' : ''}${b.noMaterial ? ' · no material issued' : ''}`}
        className={cn(
          'absolute top-1 bottom-1 flex items-center gap-1 overflow-hidden rounded-md border-l-4 px-1.5 text-left text-[11px] leading-tight whitespace-nowrap text-fg shadow-sm',
          barColour(b.workOrderId),
          b.late && 'ring-2 ring-danger',
          b.conflict && 'outline-2 outline-warning outline-dashed',
          b.running && 'animate-pulse',
          selected === b.operationId && 'ring-2 ring-ring',
          movable ? 'cursor-grab touch-none' : 'cursor-pointer',
          dragging && 'z-10 cursor-grabbing opacity-80',
        )}
        style={{ left, width: Math.max(4, right - left), transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined }}
        onPointerDown={(e) => {
          if (!movable) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setDrag({ bar: b, dx: 0, dy: 0, startX: e.clientX, startY: e.clientY });
        }}
        onPointerMove={(e) => drag?.bar.operationId === b.operationId && setDrag({ ...drag, dx: e.clientX - drag.startX, dy: e.clientY - drag.startY })}
        onPointerUp={(e) => {
          if (drag?.bar.operationId !== b.operationId) return onSelect(b);
          const moved = Math.abs(drag.dx) > 3 || Math.abs(drag.dy) > 3;
          setDrag(null);
          if (!moved) return onSelect(b);
          const minutes = Math.round(((drag.dx / pxPerHour) * 60) / SNAP) * SNAP;
          const start = new Date(new Date(b.startsAt).getTime() + minutes * MIN);
          onMove(b, targetRow(b, e.clientY) ?? b.machineId!, start);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        {b.pinned && <Pin className="size-3 shrink-0" aria-label="Pinned" />}
        <span className="font-mono font-medium">{b.number}</span>
        <span className="text-muted">
          {b.seq} {b.name}
        </span>
      </button>
    );
  };

  const shade = (calendarId: string) => {
    const working = view.working[calendarId] ?? [];
    const out: { left: number; w: number }[] = [];
    let cursor = 0;
    for (const w of working) {
      const a = Math.max(0, x(w.start));
      const b = Math.min(width, x(w.end));
      if (a > cursor) out.push({ left: cursor, w: a - cursor });
      cursor = Math.max(cursor, b);
    }
    if (cursor < width) out.push({ left: cursor, w: width - cursor });
    return out.map((s, i) => <div key={i} className="absolute inset-y-0 bg-surface-2" style={{ left: s.left, width: s.w }} aria-hidden />);
  };

  const now = x(new Date());
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface" onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
      <div className="grid min-w-max" style={{ gridTemplateColumns: `9rem ${width}px` }}>
        <div className="sticky left-0 z-20 border-b border-line bg-surface" />
        <div className="relative h-8 border-b border-line text-[11px] text-muted">
          {ticks.map((t) => {
            const h = l.hour(t);
            return (
              <div key={t.getTime()} className="absolute top-0 h-full border-l border-line pl-1" style={{ left: x(t) }}>
                {h === '00' ? <span className="font-medium text-fg">{l.day(t)}</span> : `${h}:00`}
              </div>
            );
          })}
        </div>
        {centres.map(([centreId, centre]) => (
          <Fragment key={centreId}>
            <div className="sticky left-0 z-20 col-span-1 border-b border-line bg-surface-2 px-2 py-1 text-[11px] font-medium text-muted uppercase">{centre}</div>
            <div className="border-b border-line bg-surface-2" />
            {rows
              .filter((m) => m.workCentreId === centreId)
              .map((m) => (
                <Fragment key={m.id}>
                  <div className="sticky left-0 z-20 flex h-11 items-center border-b border-line bg-surface px-2 text-[13px]">
                    <span className="font-mono font-medium">{m.code}</span>
                    <span className="ml-1 truncate text-muted">{m.name}</span>
                  </div>
                  <div
                    ref={(el) => {
                      if (el) rowRefs.current.set(m.id, el);
                    }}
                    className="relative h-11 border-b border-line"
                    data-machine={m.code}
                  >
                    {shade(m.calendarId)}
                    {view.blocks
                      .filter((b) => b.machineId === m.id)
                      .map((b) => (
                        <div
                          key={b.id}
                          className="absolute inset-y-0 border-x border-danger bg-danger-soft bg-[repeating-linear-gradient(45deg,transparent_0_6px,var(--color-surface)_6px_9px)]"
                          style={{ left: Math.max(0, x(b.startsAt)), width: Math.max(2, Math.min(width, x(b.endsAt)) - Math.max(0, x(b.startsAt))) }}
                          title={b.reason}
                          aria-label={`Downtime: ${b.reason}`}
                        />
                      ))}
                    {now >= 0 && now <= width && <div className="absolute inset-y-0 w-px bg-danger" style={{ left: now }} aria-hidden />}
                    {view.bars.filter((b) => b.machineId === m.id).map(barEl)}
                  </div>
                </Fragment>
              ))}
          </Fragment>
        ))}
        {outsourced.length > 0 && (
          <>
            <div className="sticky left-0 z-20 flex h-11 items-center border-b border-line bg-surface px-2 text-[13px] text-muted">Job work</div>
            <div className="relative h-11 border-b border-line">{outsourced.map(barEl)}</div>
          </>
        )}
      </div>
    </div>
  );
}
