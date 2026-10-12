'use client';
import { formatDateTime } from '@/lib/format';
import { MACHINE_STATE, type Segment } from '@/lib/iot';

/** A machine's states over a window as one horizontal bar, with a legend (decision 063). */
export function StateStrip({ segments, label = 'Machine states' }: { segments: Segment[]; label?: string }) {
  if (!segments.length) return <p className="text-[13px] text-muted">No data for this window.</p>;
  const t0 = Date.parse(segments[0]!.from);
  const t1 = Date.parse(segments.at(-1)!.to);
  const span = Math.max(1, t1 - t0);
  const totals = new Map<Segment['state'], number>();
  for (const s of segments) totals.set(s.state, (totals.get(s.state) ?? 0) + Date.parse(s.to) - Date.parse(s.from));
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded border border-line" role="img" aria-label={label}>
        {segments.map((s, i) => (
          <div
            key={i}
            className={MACHINE_STATE[s.state].bar}
            style={{ width: `${((Date.parse(s.to) - Date.parse(s.from)) / span) * 100}%` }}
            title={`${MACHINE_STATE[s.state].label}: ${formatDateTime(s.from)} → ${formatDateTime(s.to)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-subtle">
        <span>{formatDateTime(segments[0]!.from)}</span>
        <span>{formatDateTime(segments.at(-1)!.to)}</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {[...totals.entries()].map(([state, ms]) => (
          <li key={state} className="flex items-center gap-1.5">
            <span className={`inline-block size-2.5 rounded-sm ${MACHINE_STATE[state].bar}`} />
            {MACHINE_STATE[state].label} <span className="text-muted">{Math.round(ms / 60_000)} min</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
