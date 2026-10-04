'use client';
import { Alert, Badge, Button, buttonClass, Card, CardHeader, Field, Input, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CircleSlash, FileText, PackageCheck, Plus, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CURRENCIES, errorText, GST_RATE_OPTIONS, poStateOf, useTaxPreview } from '@/lib/buying';
import { formatAmount, formatDate, formatDateTime, formatQty, today } from '@/lib/format';
import { STATUS_TONE } from '@/lib/stock';
import type { Item, LegalEntity, Party, PurchaseOrderDetail } from '@/lib/types';
import { fieldErrors, FormDialog } from './form-dialog';
import { ItemPicker } from './item-picker';
import { TaxSummary } from './tax-summary';
import { useWorkspace } from './workspace';

interface DraftLine {
  key: string;
  item: (Pick<Item, 'id' | 'code' | 'name'> & { uomCode?: string }) | null;
  description: string;
  qty: string;
  rate: string;
  /** '' = from the item's HSN/SAC. */
  gstRate: string;
}

let keySeq = 0;
const blank = (): DraftLine => ({ key: `p${++keySeq}`, item: null, description: '', qty: '', rate: '', gstRate: '' });

/** Our GSTINs for the active entity (shown only when there is more than one to choose from). */
export function useOurGstins() {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['entities', ws.tenantId],
    queryFn: () => api<LegalEntity[]>('/entities', { scope: { tenantId: ws.tenantId } }),
    enabled: ws.canTenant('settings.entity.read'),
  });
  return q.data?.find((e) => e.id === ws.entityId)?.gstRegistrations ?? [];
}

export function PurchaseOrderForm({ po }: { po?: PurchaseOrderDetail }) {
  const ws = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  const editable = !po || po.status === 'draft';
  const gstins = useOurGstins();
  const suppliers = useQuery({
    queryKey: ['parties', ws.tenantId, '', 'supplier'],
    queryFn: () => api<Party[]>('/parties?role=supplier&limit=500', { scope: ws.scope }),
    enabled: ws.can('masters.party.read'),
  });

  const [header, setHeader] = useState({
    supplierId: po?.supplierId ?? '',
    gstRegistrationId: po?.gstRegistrationId ?? '',
    orderDate: po?.orderDate ?? today(),
    expectedDate: po?.expectedDate ?? '',
    supplierQuoteRef: po?.supplierQuoteRef ?? '',
    paymentTermsDays: po?.paymentTermsDays != null ? String(po.paymentTermsDays) : '',
    remarks: po?.remarks ?? '',
    currency: po?.currency ?? 'INR',
    exchangeRate: po && po.currency !== 'INR' ? String(Number(po.exchangeRate)) : '',
  });
  const foreign = header.currency !== 'INR';
  const [lines, setLines] = useState<DraftLine[]>(() =>
    po?.lines.length
      ? po.lines.map((l) => ({
          key: l.id,
          item: { id: l.itemId, code: l.itemCode, name: l.itemName, uomCode: l.uomCode },
          description: l.description ?? '',
          qty: String(Number(l.qty)),
          rate: String(Number(l.rate)),
          gstRate: String(Number(l.gstRate)),
        }))
      : [blank()],
  );
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'cancel' | 'close' | null>(null);
  const supplier = suppliers.data?.find((s) => s.id === header.supplierId);

  const preview = useTaxPreview({
    supplierId: header.supplierId,
    gstRegistrationId: header.gstRegistrationId,
    date: header.orderDate,
    lines: lines.map((l) => ({ itemId: l.item?.id, qty: l.qty, rate: l.rate, gstRate: l.gstRate })),
  });
  const update = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const payload = () => ({
    supplierId: header.supplierId,
    gstRegistrationId: header.gstRegistrationId || null,
    orderDate: header.orderDate,
    expectedDate: header.expectedDate || null,
    supplierQuoteRef: header.supplierQuoteRef || null,
    paymentTermsDays: header.paymentTermsDays ? Number(header.paymentTermsDays) : null,
    remarks: header.remarks || null,
    currency: header.currency,
    exchangeRate: foreign ? header.exchangeRate || null : null,
    lines: lines.filter((l) => l.item).map((l) => ({ itemId: l.item!.id, description: l.description || null, qty: l.qty, rate: l.rate, ...(l.gstRate && { gstRate: l.gstRate }) })),
  });

  const save = useMutation({
    mutationFn: async (andSubmit: boolean) => {
      setError(null);
      const body = payload();
      if (!body.supplierId) throw new Error('Choose a supplier');
      if (body.lines.length === 0) throw new Error('Add at least one item');
      let id = po?.id ?? draftId;
      if (id) await api(`/purchase-orders/${id}`, { method: 'PUT', body, scope: ws.scope });
      else {
        id = (await api<{ id: string }>('/purchase-orders', { method: 'POST', body, scope: ws.scope })).id;
        setDraftId(id);
        window.history.replaceState(null, '', `/app/buying/orders/${id}`);
      }
      if (andSubmit) await api(`/purchase-orders/${id}/submit`, { method: 'POST', scope: ws.scope });
      return id;
    },
    onSuccess: (id, andSubmit) => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      void qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      if (!po && andSubmit) router.replace(`/app/buying/orders/${id}`);
    },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/purchase-orders/${po?.id ?? draftId}`, { method: 'DELETE', scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      router.replace('/app/buying/orders');
    },
    onError: (e) => setError(errorText(e)),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && editable && !save.isPending) {
        e.preventDefault();
        save.mutate(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, save]);

  // Preview lines line up with the valid rows only.
  const validKeys = lines.filter((l) => l.item && /^\d+(\.\d+)?$/.test(l.qty.trim()) && /^\d+(\.\d+)?$/.test(l.rate.trim())).map((l) => l.key);
  const previewRate = (key: string) => {
    const i = validKeys.indexOf(key);
    return i >= 0 ? preview.data?.gstRates[i] : undefined;
  };
  const state = po && po.status !== 'draft' ? poStateOf(po) : null;
  const open = po?.status === 'submitted' && !po.closedAt;
  const hasPending = po?.lines.some((l) => Number(l.pendingQty) > 0);
  const hasUnbilled = po?.lines.some((l) => Number(l.unbilledQty) > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">
            <Link href="/app/buying/orders" className="hover:text-fg">
              Purchase orders
            </Link>
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-[22px] font-semibold tracking-tight">
            <span className="font-mono">{po?.number ?? (draftId || po ? 'Draft purchase order' : 'New purchase order')}</span>
            {po && (state ? <Badge tone={state.tone} dot>{state.label}</Badge> : <Badge tone={STATUS_TONE[po.status]} dot>Draft</Badge>)}
          </h1>
          {po?.status === 'submitted' && <p className="mt-1 text-[13px] text-muted">{po.supplierName} · ordered {formatDate(po.orderDate)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (po || draftId) && ws.can('buying.purchase_order.create') && (
            <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 className="size-4" /> Delete draft
            </Button>
          )}
          {editable && ws.can('buying.purchase_order.create') && (
            <Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false}>
              Save draft <kbd className="ml-1 hidden rounded border border-line px-1 font-mono text-[10px] text-subtle sm:inline">Ctrl ↵</kbd>
            </Button>
          )}
          {editable && ws.can('buying.purchase_order.submit') && (
            <Button onClick={() => save.mutate(true)} loading={save.isPending && save.variables === true}>
              <Send className="size-4" /> Submit
            </Button>
          )}
          {open && hasPending && ws.can('inventory.stock_entry.create') && (
            <Link href={`/app/inventory/entries/new?purpose=receipt&po=${po.id}`} className={buttonClass('primary', 'md')}>
              <PackageCheck className="size-4" /> Receive goods
            </Link>
          )}
          {po?.status === 'submitted' && hasUnbilled && ws.can('buying.purchase_invoice.create') && (
            <Link href={`/app/buying/invoices/new?po=${po.id}`} className={buttonClass('secondary', 'md')}>
              <FileText className="size-4" /> Record invoice
            </Link>
          )}
          {open && ws.can('buying.purchase_order.submit') && (
            <Button variant="secondary" onClick={() => setDialog('close')}>
              <CircleSlash className="size-4" /> Short-close
            </Button>
          )}
          {po?.status === 'submitted' && ws.can('buying.purchase_order.cancel') && po.receipts.length === 0 && po.invoices.length === 0 && (
            <Button variant="secondary" onClick={() => setDialog('cancel')}>
              <Ban className="size-4" /> Cancel PO
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert tone="danger" title="Not saved">
          {error}
        </Alert>
      )}
      {po?.status === 'cancelled' && (
        <Alert tone="danger" title={`Cancelled ${po.cancelledAt ? formatDateTime(po.cancelledAt) : ''}`}>
          {po.cancelReason}
        </Alert>
      )}
      {po?.closedAt && <Alert tone="info">Short-closed on {formatDate(po.closedAt)}. No more goods will be received against it.</Alert>}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier" className="lg:col-span-2" hint={supplier ? [supplier.gstin ?? supplier.gstTreatment, supplier.msmeCategory && `MSME ${supplier.msmeCategory}`].filter(Boolean).join(' · ') : undefined}>
            {(p) => (
              <Select {...p} value={header.supplierId} onChange={(e) => setHeader({ ...header, supplierId: e.target.value })} disabled={!editable}>
                <option value="">{po && !editable ? po.supplierName : 'Choose…'}</option>
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Order date">{(p) => <Input {...p} type="date" value={header.orderDate} onChange={(e) => setHeader({ ...header, orderDate: e.target.value })} disabled={!editable} />}</Field>
          <Field label="Expected by">{(p) => <Input {...p} type="date" value={header.expectedDate} onChange={(e) => setHeader({ ...header, expectedDate: e.target.value })} disabled={!editable} />}</Field>
          {gstins.length > 1 && (
            <Field label="Bill to / ship to GSTIN">
              {(p) => (
                <Select {...p} value={header.gstRegistrationId} onChange={(e) => setHeader({ ...header, gstRegistrationId: e.target.value })} disabled={!editable}>
                  <option value="">Default</option>
                  {gstins.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.gstin}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Currency" hint={supplier && supplier.gstTreatment !== 'overseas' && foreign ? 'Only overseas suppliers bill in foreign currency' : undefined}>
            {(p) => (
              <Select {...p} value={header.currency} onChange={(e) => setHeader({ ...header, currency: e.target.value })} disabled={!editable}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {foreign && (
            <Field label={`Exchange rate (₹ per 1 ${header.currency})`} hint="Receipts are valued in rupees at this rate">
              {(p) => <Input {...p} className="tabular" inputMode="decimal" value={header.exchangeRate} onChange={(e) => setHeader({ ...header, exchangeRate: e.target.value })} disabled={!editable} />}
            </Field>
          )}
          <Field label="Supplier quotation ref.">{(p) => <Input {...p} value={header.supplierQuoteRef} onChange={(e) => setHeader({ ...header, supplierQuoteRef: e.target.value })} disabled={!editable} />}</Field>
          <Field label="Payment terms (days)" hint={!header.paymentTermsDays && supplier?.creditDays != null ? `Supplier default: ${supplier.creditDays}` : undefined}>
            {(p) => <Input {...p} inputMode="numeric" value={header.paymentTermsDays} onChange={(e) => setHeader({ ...header, paymentTermsDays: e.target.value.replace(/\D/g, '') })} disabled={!editable} />}
          </Field>
          <Field label="Remarks" className={gstins.length > 1 ? '' : 'lg:col-span-2'}>
            {(p) => <Input {...p} value={header.remarks} onChange={(e) => setHeader({ ...header, remarks: e.target.value })} disabled={!editable} />}
          </Field>
        </div>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th className="w-8">#</Th>
              <Th className="min-w-64">Item</Th>
              <Th className="w-32 text-right">Qty</Th>
              <Th className="w-32 text-right">Rate ({header.currency === 'INR' ? '₹' : header.currency})</Th>
              <Th className="w-28">GST %</Th>
              <Th className="text-right">Amount</Th>
              {!editable && <Th className="text-right">Received</Th>}
              {!editable && <Th className="text-right">Billed</Th>}
              {editable && <Th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {editable
              ? lines.map((l, i) => (
                  <tr key={l.key} className="align-top">
                    <Td className="pt-4 text-[12px] text-subtle">{i + 1}</Td>
                    <Td>
                      <ItemPicker value={l.item} stockOnly={false} autoFocus={i === lines.length - 1 && i > 0} onChange={(it) => update(l.key, { item: { id: it.id, code: it.code, name: it.name, uomCode: it.uomCode } })} />
                      <Input className="mt-1 text-[12px]" placeholder="Description / drawing rev. (optional)" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} aria-label="Description" />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Input className="tabular text-right" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} aria-label="Quantity" />
                        <span className="w-9 text-[11px] text-subtle">{l.item?.uomCode}</span>
                      </div>
                    </Td>
                    <Td>
                      <Input className="tabular text-right" inputMode="decimal" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} aria-label="Rate" />
                    </Td>
                    <Td>
                      <Select value={l.gstRate} onChange={(e) => update(l.key, { gstRate: e.target.value })} aria-label="GST rate">
                        <option value="">{previewRate(l.key) ? `${previewRate(l.key)} (HSN)` : 'From HSN'}</option>
                        {GST_RATE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td className="tabular pt-4 text-right text-[13px]">{Number(l.qty) && Number(l.rate) ? formatAmount(String(Number(l.qty) * Number(l.rate)), header.currency) : '—'}</Td>
                    <Td>
                      <Button variant="ghost" size="icon" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1}>
                        <Trash2 className="size-4" />
                      </Button>
                    </Td>
                  </tr>
                ))
              : po!.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="text-[12px] text-subtle">{l.lineNo}</Td>
                    <Td>
                      <span className="font-mono text-[13px] font-medium">{l.itemCode}</span> <span className="text-[13px] text-muted">{l.itemName}</span>
                      {l.description && <p className="text-[12px] text-subtle">{l.description}</p>}
                    </Td>
                    <Td className="tabular text-right whitespace-nowrap">
                      {formatQty(l.qty)} <span className="text-[11px] text-subtle">{l.uomCode}</span>
                    </Td>
                    <Td className="tabular text-right text-[13px]">{formatAmount(l.rate, header.currency)}</Td>
                    <Td className="tabular text-[13px]">{Number(l.gstRate)}%</Td>
                    <Td className="tabular text-right text-[13px]">{formatAmount(l.taxableValue, header.currency)}</Td>
                    <Td className={`tabular text-right text-[13px] ${Number(l.pendingQty) > 0 ? '' : 'text-success'}`}>{formatQty(l.receivedQty)}</Td>
                    <Td className="tabular text-right text-[13px]">{formatQty(l.billedQty)}</Td>
                  </tr>
                ))}
          </tbody>
        </Table>
        {editable && (
          <div className="border-t border-line px-4 py-2">
            <Button variant="link" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
              <Plus className="size-3.5" /> Add line
            </Button>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {po && po.status !== 'draft' && (
            <Card>
              <CardHeader title="Receipts and invoices" />
              <div className="divide-y divide-line">
                {po.receipts.length === 0 && po.invoices.length === 0 && <p className="px-5 py-4 text-[13px] text-muted">Nothing received or billed yet.</p>}
                {po.receipts.map((r) => (
                  <Link key={r.id} href={`/app/inventory/entries/${r.id}`} className="flex items-center gap-3 px-5 py-3 text-[13px] hover:bg-surface-2">
                    <PackageCheck className="size-4 text-muted" />
                    <span className="font-mono">{r.number ?? 'Draft receipt'}</span>
                    <span className="text-muted">{formatDate(r.postingDate)}</span>
                    {r.reference && <span className="text-muted">· {r.reference}</span>}
                    <Badge tone={STATUS_TONE[r.status]} className="ml-auto">
                      {r.status}
                    </Badge>
                  </Link>
                ))}
                {po.invoices.map((inv) => (
                  <Link key={inv.id} href={`/app/buying/invoices/${inv.id}`} className="flex items-center gap-3 px-5 py-3 text-[13px] hover:bg-surface-2">
                    <FileText className="size-4 text-muted" />
                    <span className="font-mono">{inv.number ?? 'Draft invoice'}</span>
                    <span className="text-muted">supplier inv. {inv.supplierInvoiceNo}</span>
                    <span className="tabular ml-auto">{formatAmount(inv.grandTotal, header.currency)}</span>
                    <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
        <TaxSummary
          preview={editable ? preview.data : undefined}
          fixed={!editable && po ? { taxableValue: po.taxableValue, totalTax: po.totalTax, grandTotal: po.grandTotal } : undefined}
          loading={editable && preview.isFetching}
          error={editable ? preview.error : null}
          currency={header.currency}
        />
      </div>

      {dialog && po && <PoActionDialog po={po} action={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function PoActionDialog({ po, action, onClose }: { po: PurchaseOrderDetail; action: 'cancel' | 'close'; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/purchase-orders/${po.id}/${action}`, { method: 'POST', body: { reason }, scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-order', po.id] });
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      onClose();
    },
  });
  return (
    <FormDialog
      title={action === 'cancel' ? `Cancel ${po.number}` : `Short-close ${po.number}`}
      description={action === 'cancel' ? 'Nothing has been received or billed, so the order is withdrawn.' : 'The remaining quantity will not be delivered. Receipts and invoices so far stay as they are.'}
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel={action === 'cancel' ? 'Cancel PO' : 'Short-close'}
    >
      <Field label="Reason (recorded in the audit log)" error={fieldErrors(m.error).reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
