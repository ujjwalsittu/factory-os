'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { RecordSections, type RecordSection } from './record-sections';
import { useWorkspace } from './workspace';

export type RelatedType = 'quotation' | 'sales_order' | 'sales_invoice' | 'purchase_order' | 'stock_entry' | 'purchase_invoice' | 'work_order' | 'maintenance_order' | 'job_work_order';

/**
 * The chain around a document, up and down (decision 070). Only records the person may read are listed; nothing is shown
 * when there is no chain, and a failed read never gets in the way of the document.
 */
export function RelatedPanel({ type, id }: { type: RelatedType; id: string }) {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['related', ws.tenantId, ws.entityId, type, id],
    queryFn: () => api<{ sections: RecordSection[] }>(`/related/${type}/${id}`, { scope: ws.scope }),
    enabled: !!ws.entityId,
    retry: false,
  });
  if (!q.data || q.data.sections.length === 0) return null;
  return (
    <section aria-label="Related documents" data-related={type}>
      <h3 className="mb-2 text-[13px] font-medium text-muted">Related</h3>
      <RecordSections sections={q.data.sections} />
    </section>
  );
}
