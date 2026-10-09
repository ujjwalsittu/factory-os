'use client';
import { InvoiceBalance } from './invoice-balance';
import { AccountingSourceLinks } from './accounting-source-links';
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { CURRENCIES, errorText, GST_RATE_OPTIONS, MSME_LABELS, useTaxPreview } from '@/lib/buying';
import { formatAmount, formatDate, formatDateTime, formatQty, today } from '@/lib/format';
import { STATUS_TONE } from '@/lib/stock';
import type { Item, Party, PurchaseInvoiceDetail, PurchaseOrderDetail, PurchaseOrderRow } from '@/lib/types';
import { fieldErrors, FormDialog } from './form-dialog';
import { ItemPicker } from './item-picker';
import { useOurGstins } from './purchase-order-form';
import { TaxSummary } from './tax-summary';
import { useWorkspace } from './workspace';

interface DraftLine {
  key: string;
  item: (Pick<Item, 'id' | 'code' | 'name'> & { uomCode?: string; isStockItem?: boolean }) | null;
  poLineId: string | null;
  /** Service lines may charge a job work receipt of this supplier (decision 047). */
  jobWorkReceiptId: string;
  /** For PO lines: the ordered rate and what is still billable, to flag variances before submit. */
  poRate: string | null;
  billable: string | null;
  qty: string;
  rate: string;
  gstRate: string;
}

let keySeq = 0;
const blank = (): DraftLine => ({
  key: `i${++keySeq}`,
  item: null,
  poLineId: null,
  jobWorkReceiptId: '',
  poRate: null,
  billable: null,
  qty: '',
  rate: '',
  gstRate: '',
});
const fromPo = (po: PurchaseOrderDetail): DraftLine[] =>
  po.lines
    .filter((l) => Number(l.unbilledQty) > 0)
    .map((l) => ({
      key: `i${++keySeq}`,
      item: {
        id: l.itemId,
        code: l.itemCode,
        name: l.itemName,
        uomCode: l.uomCode,
      },
      poLineId: l.id,
      jobWorkReceiptId: '',
      poRate: l.rate,
      billable: l.unbilledQty,
      qty: String(Number(l.unbilledQty)),
      rate: String(Number(l.rate)),
      gstRate: String(Number(l.gstRate)),
    }));

export function PurchaseInvoiceForm({ invoice, fromPoId }: { invoice?: PurchaseInvoiceDetail; fromPoId?: string }) {
  const ws = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  const editable = !invoice || invoice.status === 'draft';
  const gstins = useOurGstins();
  const suppliers = useQuery({
    queryKey: ['parties', ws.tenantId, '', 'supplier'],
    queryFn: () => api<Party[]>('/parties?role=supplier&limit=500', { scope: ws.scope }),
    enabled: ws.can('masters.party.read'),
  });

  const [header, setHeader] = useState({
    supplierId: invoice?.supplierId ?? '',
    gstRegistrationId: invoice?.gstRegistrationId ?? '',
    purchaseOrderId: invoice?.purchaseOrderId ?? fromPoId ?? '',
    supplierInvoiceNo: invoice?.supplierInvoiceNo ?? '',
    supplierInvoiceDate: invoice?.supplierInvoiceDate ?? today(),
    postingDate: invoice?.postingDate ?? today(),
    reverseCharge: invoice?.reverseCharge ?? false,
    itcEligible: invoice?.itcEligible ?? true,
    remarks: invoice?.remarks ?? '',
    currency: invoice?.currency ?? 'INR',
    exchangeRate: invoice && invoice.currency !== 'INR' ? String(Number(invoice.exchangeRate)) : '',
  });
  const [lines, setLines] = useState<DraftLine[]>(() =>
    invoice?.lines.length
      ? invoice.lines.map((l) => ({
          key: l.id,
          item: {
            id: l.itemId,
            code: l.itemCode,
            name: l.itemName,
            uomCode: l.uomCode,
          },
          poLineId: l.poLineId,
          jobWorkReceiptId: l.jobWorkReceiptId ?? '',
          poRate: l.poRate,
          billable: null,
          qty: String(Number(l.qty)),
          rate: String(Number(l.rate)),
          gstRate: String(Number(l.gstRate)),
        }))
      : [blank()],
  );
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variance, setVariance] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const openPOs = useQuery({
    queryKey: ['purchase-orders', ws.entityId, 'billable', header.supplierId],
    queryFn: () => api<PurchaseOrderRow[]>(`/purchase-orders?status=submitted&supplierId=${header.supplierId}`, { scope: ws.scope }),
    enabled: editable && !!header.supplierId,
  });
  const linkedPo = useQuery({
    queryKey: ['purchase-order', header.purchaseOrderId],
    queryFn: () =>
      api<PurchaseOrderDetail>(`/purchase-orders/${header.purchaseOrderId}`, {
        scope: ws.scope,
      }),
    enabled: !!header.purchaseOrderId,
  });

  // Coming from a PO: take its supplier and the received-but-unbilled lines, once.
  const [prefilled, setPrefilled] = useState(!!invoice);
  useEffect(() => {
    if (prefilled || !linkedPo.data) return;
    setPrefilled(true);
    // The invoice is in the PO's currency; its exchange rate starts at the PO's and is edited to the invoice's.
    setHeader((h) => ({ ...h, supplierId: linkedPo.data.supplierId, currency: linkedPo.data.currency, exchangeRate: linkedPo.data.currency !== 'INR' ? String(Number(linkedPo.data.exchangeRate)) : '' }));
    const ls = fromPo(linkedPo.data);
    setLines(ls.length ? ls : [blank()]);
  }, [linkedPo.data, prefilled]);
  // Billable quantities for lines of a saved draft.
  useEffect(() => {
    if (!linkedPo.data) return;
    const by = new Map(linkedPo.data.lines.map((l) => [l.id, l]));
    setLines((ls) =>
      ls.map((l) =>
        l.poLineId && by.get(l.poLineId) && l.billable === null
          ? {
              ...l,
              billable: by.get(l.poLineId)!.unbilledQty,
              poRate: by.get(l.poLineId)!.rate,
            }
          : l,
      ),
    );
  }, [linkedPo.data]);

  const choosePo = (id: string) => {
    setHeader((h) => ({ ...h, purchaseOrderId: id }));
    setPrefilled(!id);
    if (!id) setLines((ls) => ls.map((l) => ({ ...l, poLineId: null, poRate: null, billable: null })));
  };

  const preview = useTaxPreview({
    supplierId: header.supplierId,
    gstRegistrationId: header.gstRegistrationId,
    date: header.supplierInvoiceDate,
    reverseCharge: header.reverseCharge,
    lines: lines.map((l) => ({
      itemId: l.item?.id,
      qty: l.qty,
      rate: l.rate,
      gstRate: l.gstRate,
    })),
  });
  const update = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const supplier = suppliers.data?.find((s) => s.id === header.supplierId);
  const jobWorkReceipts = useQuery({
    queryKey: ['job-work-receipts', ws.entityId, header.supplierId],
    queryFn: () => api<{ id: string; number: string; postingDate: string; orderNumber: string; natureOfWork: string | null; chargedBy: string | null }[]>(`/manufacturing/job-work-receipts?supplierId=${header.supplierId}`, { scope: ws.scope }),
    enabled: editable && !!header.supplierId && !!supplier?.isJobWorker && ws.can('manufacturing.job_work.read'),
  });

  const payload = () => ({
    supplierId: header.supplierId,
    gstRegistrationId: header.gstRegistrationId || null,
    purchaseOrderId: header.purchaseOrderId || null,
    supplierInvoiceNo: header.supplierInvoiceNo,
    supplierInvoiceDate: header.supplierInvoiceDate,
    postingDate: header.postingDate,
    reverseCharge: header.reverseCharge,
    itcEligible: header.itcEligible,
    remarks: header.remarks || null,
    currency: header.currency,
    exchangeRate: header.currency !== 'INR' ? header.exchangeRate || null : null,
    lines: lines
      .filter((l) => l.item)
      .map((l) => ({
        itemId: l.item!.id,
        poLineId: l.poLineId,
        jobWorkReceiptId: l.jobWorkReceiptId || null,
        qty: l.qty,
        rate: l.rate,
        ...(l.gstRate && { gstRate: l.gstRate }),
      })),
  });

  const save = useMutation({
    mutationFn: async (mode: 'draft' | 'submit' | 'accept') => {
      setError(null);
      const body = payload();
      if (!body.supplierId) throw new Error('Choose a supplier');
      if (body.lines.length === 0) throw new Error('Add at least one item');
      let id = invoice?.id ?? draftId;
      if (id)
        await api(`/purchase-invoices/${id}`, {
          method: 'PUT',
          body,
          scope: ws.scope,
        });
      else {
        id = (
          await api<{ id: string }>('/purchase-invoices', {
            method: 'POST',
            body,
            scope: ws.scope,
          })
        ).id;
        setDraftId(id);
        window.history.replaceState(null, '', `/app/buying/invoices/${id}`);
      }
      if (mode !== 'draft')
        await api(`/purchase-invoices/${id}/submit`, {
          method: 'POST',
          body: { acceptRateVariance: mode === 'accept' },
          scope: ws.scope,
        });
      return id;
    },
    onSuccess: (id, mode) => {
      setVariance(null);
      void qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      void qc.invalidateQueries({ queryKey: ['purchase-invoice', id] });
      void qc.invalidateQueries({ queryKey: ['purchase-order'] });
      if (!invoice && mode !== 'draft') router.replace(`/app/buying/invoices/${id}`);
    },
    onError: (e) => {
      // A rate different from the PO is allowed, but only when someone confirms it.
      if (e instanceof ApiError && e.issues.some((i) => i.path === 'acceptRateVariance')) setVariance(e.message);
      else setError(errorText(e));
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      api(`/purchase-invoices/${invoice?.id ?? draftId}`, {
        method: 'DELETE',
        scope: ws.scope,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      router.replace('/app/buying/invoices');
    },
    onError: (e) => setError(errorText(e)),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && editable && !save.isPending) {
        e.preventDefault();
        save.mutate('draft');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, save]);

  const canSubmit = ws.can('buying.purchase_invoice.submit');
  return (
    <div className="space-y-6">
      {invoice && invoice.status !== 'draft' && <AccountingSourceLinks type="purchase_invoice" id={invoice.id} />}
      {invoice && invoice.status !== 'draft' && <InvoiceBalance type="purchase" id={invoice.id} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">
            <Link href="/app/buying/invoices" className="hover:text-fg">
              Purchase invoices
            </Link>
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-[22px] font-semibold tracking-tight">
            <span className="font-mono">{invoice?.number ?? (draftId || invoice ? 'Draft purchase invoice' : 'New purchase invoice')}</span>
            {invoice && (
              <Badge tone={STATUS_TONE[invoice.status]} dot>
                {invoice.status[0]!.toUpperCase() + invoice.status.slice(1)}
              </Badge>
            )}
            {invoice?.msmeCategory && invoice.status === 'submitted' && <Badge tone="warning">MSME {MSME_LABELS[invoice.msmeCategory] ?? invoice.msmeCategory}</Badge>}
          </h1>
          {invoice?.status === 'submitted' && (
            <p className="mt-1 text-[13px] text-muted">
              {invoice.supplierName} · invoice {invoice.supplierInvoiceNo} of {formatDate(invoice.supplierInvoiceDate)}
              {invoice.dueDate && <> · due {formatDate(invoice.dueDate)}</>}
              {invoice.poNumber && (
                <>
                  {' '}
                  · against{' '}
                  <Link href={`/app/buying/orders/${invoice.purchaseOrderId}`} className="font-mono hover:text-accent">
                    {invoice.poNumber}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {invoice?.status === 'submitted' && ws.can('buying.return_claim.create') && <Link className="text-accent" href={`/app/buying/return-claims/new?invoiceId=${invoice.id}`}>Create return claim</Link>}
          {invoice?.status === 'submitted' && ws.can('buying.supplier_note.create') && <Link className="text-accent" href={`/app/buying/supplier-notes/new?invoiceId=${invoice.id}`}>Record supplier note</Link>}
          {editable && (invoice || draftId) && ws.can('buying.purchase_invoice.create') && (
            <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 className="size-4" /> Delete draft
            </Button>
          )}
          {editable && ws.can('buying.purchase_invoice.create') && (
            <Button variant="secondary" onClick={() => save.mutate('draft')} loading={save.isPending && save.variables === 'draft'}>
              Save draft <kbd className="ml-1 hidden rounded border border-line px-1 font-mono text-[10px] text-subtle sm:inline">Ctrl ↵</kbd>
            </Button>
          )}
          {editable && canSubmit && (
            <Button onClick={() => save.mutate('submit')} loading={save.isPending && save.variables === 'submit'}>
              <Send className="size-4" /> Submit
            </Button>
          )}
          {invoice?.status === 'submitted' && ws.can('buying.purchase_invoice.cancel') && (
            <Button variant="secondary" onClick={() => setCancelling(true)}>
              <Ban className="size-4" /> Cancel invoice
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert tone="danger" title="Not posted">
          {error}
        </Alert>
      )}
      {variance && (
        <Alert tone="warning" title="Confirm the rate variance">
          <p>{variance}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => save.mutate('accept')} loading={save.isPending && save.variables === 'accept'}>
              Accept variance and submit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setVariance(null)}>
              Review rates
            </Button>
          </div>
        </Alert>
      )}
      {invoice?.status === 'cancelled' && (
        <Alert tone="danger" title={`Cancelled ${invoice.cancelledAt ? formatDateTime(invoice.cancelledAt) : ''}`}>
          {invoice.cancelReason}
        </Alert>
      )}
      {editable && supplier && ['micro', 'small'].includes(supplier.msmeCategory ?? '') && (
        <Alert tone="info">
          {supplier.name} is a {supplier.msmeCategory} enterprise: payment is due within 45 days of the invoice (Sec 43B(h)), whatever the agreed terms.
        </Alert>
      )}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier" className="lg:col-span-2" hint={supplier ? (supplier.gstin ?? supplier.gstTreatment) : undefined}>
            {(p) => (
              <Select {...p} value={header.supplierId} onChange={(e) => (setHeader({ ...header, supplierId: e.target.value }), choosePo(''))} disabled={!editable || !!header.purchaseOrderId}>
                <option value="">{invoice && !editable ? invoice.supplierName : 'Choose…'}</option>
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Against purchase order" hint={editable ? 'Lines are matched to what was received' : undefined}>
            {(p) => (
              <Select {...p} value={header.purchaseOrderId} onChange={(e) => choosePo(e.target.value)} disabled={!editable || !header.supplierId}>
                <option value="">{invoice?.poNumber ?? 'None'}</option>
                {openPOs.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number} · {formatDate(o.orderDate)}
                  </option>
                ))}
                {linkedPo.data && !openPOs.data?.some((o) => o.id === linkedPo.data.id) && <option value={linkedPo.data.id}>{linkedPo.data.number}</option>}
              </Select>
            )}
          </Field>
          {gstins.length > 1 && (
            <Field label="Our GSTIN">
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
          <Field label="Supplier invoice no.">
            {(p) => (
              <Input
                {...p}
                className="font-mono uppercase"
                maxLength={16}
                value={header.supplierInvoiceNo}
                onChange={(e) => setHeader({ ...header, supplierInvoiceNo: e.target.value })}
                disabled={!editable}
              />
            )}
          </Field>
          <Field label="Supplier invoice date">
            {(p) => <Input {...p} type="date" value={header.supplierInvoiceDate} onChange={(e) => setHeader({ ...header, supplierInvoiceDate: e.target.value })} disabled={!editable} />}
          </Field>
          <Field label="Posting date">
            {(p) => <Input {...p} type="date" value={header.postingDate} onChange={(e) => setHeader({ ...header, postingDate: e.target.value })} disabled={!editable} />}
          </Field>
          <Field label="Currency">
            {(p) => (
              <Select {...p} value={header.currency} onChange={(e) => setHeader({ ...header, currency: e.target.value })} disabled={!editable || !!header.purchaseOrderId}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {header.currency !== 'INR' && (
            <Field label={`Exchange rate (₹ per 1 ${header.currency})`} hint="Rate on the invoice date; a difference from the PO rate is forex, not stock value">
              {(p) => <Input {...p} className="tabular" inputMode="decimal" value={header.exchangeRate} onChange={(e) => setHeader({ ...header, exchangeRate: e.target.value })} disabled={!editable} />}
            </Field>
          )}
          <Field label="Remarks">{(p) => <Input {...p} value={header.remarks} onChange={(e) => setHeader({ ...header, remarks: e.target.value })} disabled={!editable} />}</Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-6 text-[13px]">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={header.reverseCharge}
              onChange={(e) => setHeader({ ...header, reverseCharge: e.target.checked })}
              disabled={!editable}
            />
            Reverse charge (we pay the GST)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={header.itcEligible}
              onChange={(e) => setHeader({ ...header, itcEligible: e.target.checked })}
              disabled={!editable}
            />
            Input tax credit eligible
            <span className="text-subtle">(untick for blocked credits u/s 17(5))</span>
          </label>
        </div>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th className="w-8">#</Th>
              <Th className="min-w-56">Item</Th>
              <Th className="w-32 text-right">Qty</Th>
              <Th className="w-32 text-right">Rate ({header.currency === 'INR' ? '₹' : header.currency})</Th>
              <Th className="w-28">GST %</Th>
              <Th className="text-right">Amount</Th>
              {!editable && <Th className="text-right">Tax</Th>}
              {editable && <Th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {editable
              ? lines.map((l, i) => {
                  const over = l.billable !== null && Number(l.qty) > Number(l.billable);
                  const differs = l.poRate !== null && l.rate !== '' && Number(l.rate) !== Number(l.poRate);
                  return (
                    <tr key={l.key} className="align-top">
                      <Td className="pt-4 text-[12px] text-subtle">{i + 1}</Td>
                      <Td>
                        {l.poLineId ? (
                          <p className="pt-2 text-[13px]">
                            <span className="font-mono font-medium">{l.item?.code}</span> <span className="text-muted">{l.item?.name}</span>
                          </p>
                        ) : (
                          <ItemPicker
                            value={l.item}
                            stockOnly={false}
                            onChange={(it) =>
                              update(l.key, {
                                item: {
                                  id: it.id,
                                  code: it.code,
                                  name: it.name,
                                  uomCode: it.uomCode,
                                  isStockItem: it.isStockItem,
                                },
                                jobWorkReceiptId: '',
                              })
                            }
                          />
                        )}
                        {!l.poLineId && (l.item?.isStockItem === false || l.jobWorkReceiptId) && jobWorkReceipts.data && jobWorkReceipts.data.length > 0 && (
                          <Select className="mt-1" aria-label={`Job work receipt for line ${i + 1}`} value={l.jobWorkReceiptId} onChange={(e) => update(l.key, { jobWorkReceiptId: e.target.value })}>
                            <option value="">Not job work processing</option>
                            {jobWorkReceipts.data.map((r) => (
                              <option key={r.id} value={r.id} disabled={!!r.chargedBy && r.id !== l.jobWorkReceiptId}>
                                {r.number} · {r.orderNumber}
                                {r.natureOfWork ? ` · ${r.natureOfWork}` : ''}
                                {r.chargedBy ? ` (charged by ${r.chargedBy})` : ''}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <Input
                            className="tabular text-right"
                            inputMode="decimal"
                            value={l.qty}
                            aria-invalid={over || undefined}
                            onChange={(e) => update(l.key, { qty: e.target.value })}
                            aria-label="Quantity"
                          />
                          <span className="w-9 text-[11px] text-subtle">{l.item?.uomCode}</span>
                        </div>
                        {l.billable !== null && <p className={`mt-1 text-right text-[11px] ${over ? 'text-danger' : 'text-subtle'}`}>{formatQty(l.billable)} received, unbilled</p>}
                      </Td>
                      <Td>
                        <Input className="tabular text-right" inputMode="decimal" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} aria-label="Rate" />
                        {l.poRate !== null && <p className={`mt-1 text-right text-[11px] ${differs ? 'text-warning' : 'text-subtle'}`}>PO {formatAmount(l.poRate, header.currency)}</p>}
                      </Td>
                      <Td>
                        <Select value={l.gstRate} onChange={(e) => update(l.key, { gstRate: e.target.value })} aria-label="GST rate">
                          <option value="">HSN</option>
                          {GST_RATE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </Select>
                      </Td>
                      <Td className="tabular pt-4 text-right text-[13px]">{Number(l.qty) && Number(l.rate) ? formatAmount(String(Number(l.qty) * Number(l.rate)), header.currency) : '—'}</Td>
                      <Td>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                          aria-label={`Remove line ${i + 1}`}
                          disabled={lines.length === 1}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </Td>
                    </tr>
                  );
                })
              : invoice!.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="text-[12px] text-subtle">{l.lineNo}</Td>
                    <Td>
                      <span className="font-mono text-[13px] font-medium">{l.itemCode}</span> <span className="text-[13px] text-muted">{l.itemName}</span>
                      {l.hsnCode && <p className="font-mono text-[11px] text-subtle">HSN {l.hsnCode}</p>}
                    </Td>
                    <Td className="tabular text-right whitespace-nowrap">
                      {formatQty(l.qty)} <span className="text-[11px] text-subtle">{l.uomCode}</span>
                    </Td>
                    <Td className="tabular text-right text-[13px]">
                      {formatAmount(l.rate, header.currency)}
                      {l.poRate && Number(l.poRate) !== Number(l.rate) && <p className="text-[11px] text-warning">PO {formatAmount(l.poRate, header.currency)}</p>}
                    </Td>
                    <Td className="tabular text-[13px]">{Number(l.gstRate)}%</Td>
                    <Td className="tabular text-right text-[13px]">{formatAmount(l.taxableValue, header.currency)}</Td>
                    <Td className="tabular text-right text-[13px]">{formatAmount(String(Number(l.igst ?? 0) + Number(l.cgst ?? 0) + Number(l.sgst ?? 0) + Number(l.cess ?? 0)))}</Td>
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
        <div />
        <TaxSummary preview={editable ? preview.data : undefined} fixed={!editable ? invoice : undefined} loading={editable && preview.isFetching} error={editable ? preview.error : null} currency={header.currency} />
      </div>

      {invoice && invoice.status !== 'draft' && (
        <p className="text-[12px] text-subtle">
          {invoice.itcEligible ? 'Input tax credit eligible.' : 'Input tax credit blocked.'} Posted {invoice.submittedAt ? formatDateTime(invoice.submittedAt) : ''}. Ledger posting arrives with the
          accounts module.
        </p>
      )}
      {cancelling && invoice && <CancelDialog invoice={invoice} onClose={() => setCancelling(false)} />}
    </div>
  );
}

function CancelDialog({ invoice, onClose }: { invoice: PurchaseInvoiceDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api(`/purchase-invoices/${invoice.id}/cancel`, {
        method: 'POST',
        body: { reason },
        scope: ws.scope,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-invoice', invoice.id] });
      void qc.invalidateQueries({ queryKey: ['invoice-balance', ws.tenantId, ws.entityId, 'purchase', invoice.id] });
      void qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      void qc.invalidateQueries({ queryKey: ['purchase-order'] });
      onClose();
    },
  });
  return (
    <FormDialog
      title={`Cancel ${invoice.number}`}
      description="The billed quantity returns to the purchase order so a corrected invoice can be booked."
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel="Cancel invoice"
    >
      <Field label="Reason (recorded in the audit log)" error={fieldErrors(m.error).reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
