'use client';
import type { BadgeTone } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/workspace';
import { api, ApiError } from './api';
import type { PurchaseOrderDetail, PurchaseOrderRow, TaxPreview } from './types';

/** GST slabs the server accepts (packages/compliance-in GST_RATES). */
export const GST_RATE_OPTIONS = ['0', '0.1', '0.25', '1.5', '3', '5', '6', '7.5', '12', '18', '28', '40'];

export const MSME_LABELS: Record<string, string> = { micro: 'Micro', small: 'Small', medium: 'Medium' };

/** A PO's state as people talk about it: draft, open, received, closed, cancelled. */
export function poState(po: Pick<PurchaseOrderRow, 'status' | 'closedAt'> & { orderedQty?: string; receivedQty?: string }): { label: string; tone: BadgeTone } {
  if (po.status === 'draft') return { label: 'Draft', tone: 'neutral' };
  if (po.status === 'cancelled') return { label: 'Cancelled', tone: 'danger' };
  if (po.closedAt) return { label: 'Closed', tone: 'neutral' };
  if (po.orderedQty && po.receivedQty && Number(po.receivedQty) >= Number(po.orderedQty)) return { label: 'Received', tone: 'success' };
  return { label: 'Open', tone: 'accent' };
}

export const poStateOf = (po: PurchaseOrderDetail) =>
  poState({
    ...po,
    orderedQty: String(po.lines.reduce((s, l) => s + Number(l.qty), 0)),
    receivedQty: String(po.lines.reduce((s, l) => s + Number(l.receivedQty), 0)),
  });

export const errorText = (e: unknown) => (e instanceof ApiError && e.issues.length ? `${e.message} (${e.issues.map((i) => i.message).join('; ')})` : (e as Error).message);

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const isQty = (s: string) => /^\d+(\.\d{1,6})?$/.test(s.trim());

/** GST for a draft, computed by the server (the only place tax is calculated). Lines missing qty or rate are skipped. */
export function useTaxPreview(input: {
  supplierId: string;
  gstRegistrationId: string;
  date: string;
  reverseCharge?: boolean;
  lines: { itemId?: string; qty: string; rate: string; gstRate: string }[];
}) {
  const ws = useWorkspace();
  const lines = input.lines.filter((l) => l.itemId && isQty(l.qty) && isQty(l.rate));
  const body = useDebounced(
    JSON.stringify({
      supplierId: input.supplierId,
      gstRegistrationId: input.gstRegistrationId || null,
      date: input.date,
      reverseCharge: !!input.reverseCharge,
      lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty.trim(), rate: l.rate.trim(), ...(l.gstRate && { gstRate: l.gstRate }) })),
    }),
  );
  return useQuery({
    queryKey: ['tax-preview', ws.entityId, body],
    queryFn: () => api<TaxPreview>('/buying/tax-preview', { method: 'POST', body: JSON.parse(body), scope: ws.scope }),
    enabled: !!input.supplierId && !!input.date && lines.length > 0,
    placeholderData: (prev) => prev,
    retry: false,
  });
}
