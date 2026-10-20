'use client';
import { Card, CardHeader } from '@factoryos/ui';
import Link from 'next/link';

/** One list on a record page or in the Related panel: a title, up to ten rows that open the record, a link to all of them. */
export interface RecordSection {
  id: string;
  title: string;
  rows: { id: string; number: string; detail: string; href: string }[];
  href?: string;
}

export function RecordSections({ sections, columns = 2 }: { sections: RecordSection[]; columns?: 1 | 2 }) {
  return (
    <div className={columns === 2 ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'}>
      {sections.map((s) => (
        <Card key={s.id} className="min-w-0" data-section={s.id}>
          <CardHeader
            title={s.title}
            actions={
              s.href && (
                <Link href={s.href} className="text-[13px] text-accent hover:underline">
                  See all
                </Link>
              )
            }
          />
          <ul className="divide-y divide-line">
            {s.rows.map((r) => (
              <li key={`${r.id}-${r.number}`}>
                <Link href={r.href} className="flex items-baseline gap-3 px-4 py-2 text-[13px] hover:bg-surface-2">
                  <span className="shrink-0 font-mono font-medium">{r.number}</span>
                  <span className="min-w-0 truncate text-muted">{r.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

export interface Overview {
  needsEntity: boolean;
  sections: RecordSection[];
  outstandingHref?: string | null;
  /** Items only: own stock below the reorder level, and what to order to reach it. */
  belowReorder?: { onHand: string; shortfall: string } | null;
}
