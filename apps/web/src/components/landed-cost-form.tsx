'use client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus, Send, Ship, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { BASIS_LABELS, CHARGE_TYPE_LABELS, errorText } from '@/lib/buying';
import { formatAmount, formatDate, formatDateTime, formatMoney, formatQty, today } from '@/lib/format';
import { STATUS_TONE } from '@/lib/stock';
import type { AllocationBasis, LandedChargeType, LandedCostAllocationLine, LandedCostDetail, LandedCostReceiptOption, Party } from '@/lib/types';
import { fieldErrors, FormDialog } from './form-dialog';
import { useWorkspace } from './workspace';

interface DraftCharge {
  key: string;
  chargeType: LandedChargeType;
  description: string;
  partyId: string;
  documentNo: string;
  amount: string;
  basis: AllocationBasis;
}

let keySeq = 0;
const blank = (chargeType: LandedChargeType = 'bcd'): DraftCharge => ({ key: `c${++keySeq}`, chargeType, description: '', partyId: '', documentNo: '', amount: '', basis: 'value' });
const isMoney = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) > 0;
const SHORT: Record<string, string> = { bcd: 'BCD', sws: 'SWS', other_duty: 'Duty', freight: 'Freight', insurance: 'Ins.', clearing: 'CHA', port: 'Port', other: 'Other' };

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Landed cost voucher: Bill of Entry + import charges over receipts (decisions 027, 028). */
export function LandedCostForm({ voucher }: { voucher?: LandedCostDetail }) {
  const ws = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  const editable = !voucher || voucher.status === 'draft';

  const receipts = useQuery({ queryKey: ['landed-cost-receipts', ws.entityId], queryFn: () => api<LandedCostReceiptOption[]>('/landed-costs/receipts', { scope: ws.scope }), enabled: editable });
  const parties = useQuery({
    queryKey: ['parties', ws.tenantId, '', 'supplier'],
    queryFn: () => api<Party[]>('/parties?role=supplier&limit=500', { scope: ws.scope }),
    enabled: ws.can('masters.party.read'),
  });

  const [header, setHeader] = useState({
    postingDate: voucher?.postingDate ?? today(),
    boeNo: voucher?.boeNo ?? '',
    boeDate: voucher?.boeDate ?? '',
    portCode: voucher?.portCode ?? '',
    customsExchangeRate: voucher?.customsExchangeRate ? String(Number(voucher.customsExchangeRate)) : '',
    assessableValue: voucher?.assessableValue ? String(Number(voucher.assessableValue)) : '',
    importIgst: voucher?.importIgst ? String(Number(voucher.importIgst)) : '',
    importCess: voucher?.importCess ? String(Number(voucher.importCess)) : '',
    remarks: voucher?.remarks ?? '',
  });
  const [receiptIds, setReceiptIds] = useState<string[]>(voucher?.receiptIds ?? []);
  const [charges, setCharges] = useState<DraftCharge[]>(() =>
    voucher?.charges.length
      ? voucher.charges.map((c) => ({
          key: c.id,
          chargeType: c.chargeType,
          description: c.description ?? '',
          partyId: c.partyId ?? '',
          documentNo: c.documentNo ?? '',
          amount: String(Number(c.amount)),
          basis: c.basis,
        }))
      : [blank('bcd'), blank('sws')],
  );
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const update = (key: string, patch: Partial<DraftCharge>) => setCharges((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const opt = (v: string) => v.trim() || null;
  const payload = () => ({
    postingDate: header.postingDate,
    boeNo: opt(header.boeNo),
    boeDate: opt(header.boeDate),
    portCode: opt(header.portCode),
    customsExchangeRate: opt(header.customsExchangeRate),
    assessableValue: opt(header.assessableValue),
    importIgst: opt(header.importIgst),
    importCess: opt(header.importCess),
    remarks: opt(header.remarks),
    receiptIds,
    charges: charges.filter((c) => c.amount.trim()).map((c) => ({ chargeType: c.chargeType, description: opt(c.description), partyId: c.partyId || null, documentNo: opt(c.documentNo), amount: c.amount.trim(), basis: c.basis })),
  });

  // Live allocation while editing; the posted split once submitted.
  const validCharges = charges.filter((c) => isMoney(c.amount));
  const previewBody = useDebounced(JSON.stringify({ ...payload(), charges: payload().charges.filter((c) => isMoney(c.amount)) }));
  const preview = useQuery({
    queryKey: ['landed-cost-preview', ws.entityId, previewBody],
    queryFn: () => api<LandedCostAllocationLine[]>('/landed-costs/preview', { method: 'POST', body: JSON.parse(previewBody), scope: ws.scope }),
    // Decide from the debounced body actually sent, not the live inputs, or a stale empty body goes out.
    enabled: editable && (() => {
      const b = JSON.parse(previewBody) as { receiptIds: string[]; charges: unknown[] };
      return b.receiptIds.length > 0 && b.charges.length > 0;
    })(),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const allocation = editable ? (preview.data ?? []) : (voucher?.allocation ?? []);
  const shownCharges = editable ? validCharges : charges;

  const save = useMutation({
    mutationFn: async (andSubmit: boolean) => {
      setError(null);
      const body = payload();
      if (body.receiptIds.length === 0) throw new Error('Choose the receipts this Bill of Entry covers');
      if (body.charges.length === 0) throw new Error('Enter at least one charge');
      let id = voucher?.id ?? draftId;
      if (id) await api(`/landed-costs/${id}`, { method: 'PUT', body, scope: ws.scope });
      else {
        id = (await api<{ id: string }>('/landed-costs', { method: 'POST', body, scope: ws.scope })).id;
        setDraftId(id);
        window.history.replaceState(null, '', `/app/buying/landed-costs/${id}`);
      }
      if (andSubmit) await api(`/landed-costs/${id}/submit`, { method: 'POST', scope: ws.scope });
      return id;
    },
    onSuccess: (id, andSubmit) => {
      void qc.invalidateQueries({ queryKey: ['landed-costs'] });
      void qc.invalidateQueries({ queryKey: ['landed-cost', id] });
      void qc.invalidateQueries({ queryKey: ['balance'] });
      if (!voucher && andSubmit) router.replace(`/app/buying/landed-costs/${id}`);
    },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/landed-costs/${voucher?.id ?? draftId}`, { method: 'DELETE', scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['landed-costs'] });
      router.replace('/app/buying/landed-costs');
    },
    onError: (e) => setError(errorText(e)),
  });

  const total = shownCharges.reduce((s, c) => s + Number(c.amount || 0), 0);
  const itc = Number(header.importIgst || 0) + Number(header.importCess || 0);
  const chosen = (receipts.data ?? []).filter((r) => receiptIds.includes(r.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">
            <Link href="/app/buying/landed-costs" className="hover:text-fg">
              Landed cost
            </Link>
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-[22px] font-semibold tracking-tight">
            <span className="font-mono">{voucher?.number ?? (draftId || voucher ? 'Draft landed cost' : 'New landed cost')}</span>
            {voucher && (
              <Badge tone={STATUS_TONE[voucher.status]} dot>
                {voucher.status[0]!.toUpperCase() + voucher.status.slice(1)}
              </Badge>
            )}
          </h1>
          {voucher?.boeNo && voucher.status !== 'draft' && (
            <p className="mt-1 text-[13px] text-muted">
              Bill of Entry {voucher.boeNo}
              {voucher.boeDate && ` of ${formatDate(voucher.boeDate)}`}
              {voucher.portCode && ` · ${voucher.portCode}`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (voucher || draftId) && ws.can('buying.landed_cost.create') && (
            <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 className="size-4" /> Delete draft
            </Button>
          )}
          {editable && ws.can('buying.landed_cost.create') && (
            <Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false}>
              Save draft
            </Button>
          )}
          {editable && ws.can('buying.landed_cost.submit') && (
            <Button onClick={() => save.mutate(true)} loading={save.isPending && save.variables === true}>
              <Send className="size-4" /> Submit
            </Button>
          )}
          {voucher?.status === 'submitted' && ws.can('buying.landed_cost.cancel') && (
            <Button variant="secondary" onClick={() => setCancelling(true)}>
              <Ban className="size-4" /> Cancel voucher
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert tone="danger" title="Not posted">
          {error}
        </Alert>
      )}
      {voucher?.status === 'cancelled' && (
        <Alert tone="danger" title={`Cancelled ${voucher.cancelledAt ? formatDateTime(voucher.cancelledAt) : ''}`}>
          {voucher.cancelReason} · Stock values are back to what they were before this voucher.
        </Alert>
      )}
      {editable && (
        <Alert tone="info">
          Duty and charges raise the cost of the material still in stock. The share for material already issued is kept as a landed-cost variance and goes to cost of production when accounts arrive. Import IGST is input tax credit, not cost.
        </Alert>
      )}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Posting date">{(p) => <Input {...p} type="date" value={header.postingDate} onChange={(e) => setHeader({ ...header, postingDate: e.target.value })} disabled={!editable} />}</Field>
          <Field label="Bill of Entry no.">{(p) => <Input {...p} className="font-mono" value={header.boeNo} onChange={(e) => setHeader({ ...header, boeNo: e.target.value })} disabled={!editable} />}</Field>
          <Field label="Bill of Entry date">{(p) => <Input {...p} type="date" value={header.boeDate} onChange={(e) => setHeader({ ...header, boeDate: e.target.value })} disabled={!editable} />}</Field>
          <Field label="Port code" hint="e.g. INNSA1 (Nhava Sheva), INBOM4 (Mumbai air)">
            {(p) => <Input {...p} className="font-mono uppercase" value={header.portCode} onChange={(e) => setHeader({ ...header, portCode: e.target.value })} disabled={!editable} />}
          </Field>
          <Field label="Customs exchange rate (₹)">
            {(p) => <Input {...p} className="tabular" inputMode="decimal" value={header.customsExchangeRate} onChange={(e) => setHeader({ ...header, customsExchangeRate: e.target.value })} disabled={!editable} />}
          </Field>
          <Field label="Assessable value (₹)">
            {(p) => <Input {...p} className="tabular" inputMode="decimal" value={header.assessableValue} onChange={(e) => setHeader({ ...header, assessableValue: e.target.value })} disabled={!editable} />}
          </Field>
          <Field label="Import IGST paid (₹)" hint="Input tax credit">
            {(p) => <Input {...p} className="tabular" inputMode="decimal" value={header.importIgst} onChange={(e) => setHeader({ ...header, importIgst: e.target.value })} disabled={!editable} />}
          </Field>
          <Field label="Compensation cess (₹)" hint="Input tax credit">
            {(p) => <Input {...p} className="tabular" inputMode="decimal" value={header.importCess} onChange={(e) => setHeader({ ...header, importCess: e.target.value })} disabled={!editable} />}
          </Field>
          <Field label="Remarks" className="lg:col-span-4">
            {(p) => <Input {...p} value={header.remarks} onChange={(e) => setHeader({ ...header, remarks: e.target.value })} disabled={!editable} />}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Receipts covered" description={editable ? 'Tick the goods receipts this Bill of Entry and these bills relate to' : undefined} />
        {editable ? (
          receipts.data?.length === 0 ? (
            <EmptyState icon={<Ship className="size-5" />} title="No receipts yet" description="Receive the imported shipment first (Stock entries → New receipt, or Receive goods on the purchase order)." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="w-10" />
                  <Th>Receipt</Th>
                  <Th>Supplier</Th>
                  <Th>PO</Th>
                  <Th className="text-right">Value</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {receipts.data?.map((r) => (
                  <tr key={r.id} className={receiptIds.includes(r.id) ? 'bg-accent-soft/40' : ''}>
                    <Td>
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-accent)]"
                        aria-label={`Include ${r.number}`}
                        checked={receiptIds.includes(r.id)}
                        onChange={(e) => setReceiptIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
                      />
                    </Td>
                    <Td>
                      <span className="font-mono text-[13px]">{r.number}</span> <span className="text-[12px] text-muted">{formatDate(r.postingDate)}</span>
                      {r.reference && <p className="text-[12px] text-subtle">{r.reference}</p>}
                    </Td>
                    <Td className="text-[13px]">{r.supplierName ?? '—'}</Td>
                    <Td className="font-mono text-[12px]">
                      {r.poNumber ?? '—'}
                      {r.poCurrency && r.poCurrency !== 'INR' && <Badge className="ml-2">{r.poCurrency}</Badge>}
                    </Td>
                    <Td className="tabular text-right text-[13px]">{formatMoney(r.value)}</Td>
                    <Td>{r.landedCostCount > 0 && <Badge tone="info">Has landed cost</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : (
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {[...new Set(allocation.map((a) => a.receiptId))].map((id) => (
              <Link key={id} href={`/app/inventory/entries/${id}`} className="font-mono text-[13px] hover:text-accent">
                {allocation.find((a) => a.receiptId === id)?.receiptNumber}
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Charges" description="Amounts in rupees from the Bill of Entry, freight and CHA bills" />
        <Table>
          <thead>
            <tr>
              <Th className="min-w-48">Charge</Th>
              <Th className="min-w-44">Billed by</Th>
              <Th className="min-w-32">Document no.</Th>
              <Th className="w-36 text-right">Amount (₹)</Th>
              <Th className="w-44">Spread</Th>
              {editable && <Th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {charges.map((c, i) => (
              <tr key={c.key} className="align-top">
                <Td>
                  {editable ? (
                    <div className="grid gap-1">
                      <Select value={c.chargeType} onChange={(e) => update(c.key, { chargeType: e.target.value as LandedChargeType })} aria-label="Charge type">
                        {Object.entries(CHARGE_TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </Select>
                      <Input className="text-[12px]" placeholder="Description (optional)" value={c.description} onChange={(e) => update(c.key, { description: e.target.value })} aria-label="Charge description" />
                    </div>
                  ) : (
                    <p className="text-[13px]">
                      {CHARGE_TYPE_LABELS[c.chargeType]}
                      {c.description && <span className="block text-[12px] text-muted">{c.description}</span>}
                    </p>
                  )}
                </Td>
                <Td>
                  {editable ? (
                    <Select value={c.partyId} onChange={(e) => update(c.key, { partyId: e.target.value })} aria-label="Billed by">
                      <option value="">{c.chargeType === 'bcd' || c.chargeType === 'sws' || c.chargeType === 'other_duty' ? 'Customs' : '—'}</option>
                      {parties.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-[13px]">{voucher?.charges[i]?.partyName ?? (['bcd', 'sws', 'other_duty'].includes(c.chargeType) ? 'Customs' : '—')}</span>
                  )}
                </Td>
                <Td>
                  {editable ? <Input className="font-mono" value={c.documentNo} onChange={(e) => update(c.key, { documentNo: e.target.value })} aria-label="Document number" /> : <span className="font-mono text-[12px]">{c.documentNo ?? '—'}</span>}
                </Td>
                <Td>
                  {editable ? (
                    <Input className="tabular text-right" inputMode="decimal" value={c.amount} onChange={(e) => update(c.key, { amount: e.target.value })} aria-label="Charge amount" />
                  ) : (
                    <p className="tabular text-right text-[13px]">{formatMoney(c.amount)}</p>
                  )}
                </Td>
                <Td>
                  {editable ? (
                    <Select value={c.basis} onChange={(e) => update(c.key, { basis: e.target.value as AllocationBasis })} aria-label="Allocation basis">
                      {Object.entries(BASIS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-[13px]">{BASIS_LABELS[c.basis]}</span>
                  )}
                </Td>
                {editable && (
                  <Td>
                    <Button variant="ghost" size="icon" onClick={() => setCharges((cs) => (cs.length > 1 ? cs.filter((x) => x.key !== c.key) : cs))} aria-label={`Remove charge ${i + 1}`} disabled={charges.length === 1}>
                      <Trash2 className="size-4" />
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
        {editable && (
          <div className="border-t border-line px-4 py-2">
            <Button variant="link" size="sm" onClick={() => setCharges((cs) => [...cs, blank('freight')])}>
              <Plus className="size-3.5" /> Add charge
            </Button>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="self-start">
          <CardHeader
            title={editable ? 'Where it lands' : 'How it was posted'}
            description={editable ? 'Each charge is split over the receipt lines; stock already issued takes its share as variance' : undefined}
          />
          {editable && preview.error ? (
            <p className="px-5 py-4 text-[13px] text-danger">{errorText(preview.error)}</p>
          ) : allocation.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted">{receiptIds.length === 0 ? 'Choose receipts and enter charges to see the split.' : 'Enter charge amounts to see the split.'}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="min-w-44">Item · batch</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Value</Th>
                  {shownCharges.map((c, i) => (
                    <Th key={c.key ?? i} className="text-right">
                      {SHORT[c.chargeType]}
                    </Th>
                  ))}
                  <Th className="text-right">Landed</Th>
                  {editable ? <Th className="text-right">Still in stock</Th> : <Th className="text-right">On stock / variance</Th>}
                </tr>
              </thead>
              <tbody>
                {allocation.map((a) => (
                  <tr key={a.receiptLineId}>
                    <Td>
                      <span className="font-mono text-[13px] font-medium whitespace-nowrap">{a.itemCode}</span>
                      {a.batchNo && <span className="font-mono text-[12px] text-subtle"> · {a.batchNo}</span>}
                      <p className="font-mono text-[11px] text-subtle">{a.receiptNumber}</p>
                    </Td>
                    <Td className="tabular text-right text-[13px] whitespace-nowrap">
                      {formatQty(a.qty)} <span className="text-[11px] text-subtle">{a.uomCode}</span>
                    </Td>
                    <Td className="tabular text-right text-[13px]">{formatMoney(a.value)}</Td>
                    {a.charges.map((v, i) => (
                      <Td key={i} className="tabular text-right text-[13px]">
                        {formatAmount(v)}
                      </Td>
                    ))}
                    <Td className="tabular text-right font-semibold">{formatMoney(a.total)}</Td>
                    {editable ? (
                      <Td className="tabular text-right text-[13px]">
                        {formatQty(a.qtyRemaining)} of {formatQty(a.qty)}
                      </Td>
                    ) : (
                      <Td className="tabular text-right text-[13px] whitespace-nowrap">
                        {formatMoney(a.onHandValue ?? '0')}
                        {Number(a.varianceValue) > 0 && <p className="text-[11px] text-warning">{formatMoney(a.varianceValue!)} variance</p>}
                        {a.newRate && Number(a.qtyRemaining) > 0 && (
                          <p className="text-[11px] text-subtle">
                            {formatMoney(a.oldRate!)} → {formatMoney(a.newRate)}/{a.uomCode}
                          </p>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="Totals" />
          <div className="space-y-1 px-5 py-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted">Landed charges</span>
              <span className="tabular font-semibold">{formatMoney(voucher && !editable ? voucher.totalCharges : String(total))}</span>
            </div>
            {voucher && !editable && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">Added to stock on hand</span>
                  <span className="tabular">{formatMoney(voucher.onHandValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Variance (already issued)</span>
                  <span className="tabular">{formatMoney(voucher.varianceValue)}</span>
                </div>
              </>
            )}
            {itc > 0 && (
              <div className="flex justify-between border-t border-line pt-2">
                <span className="text-muted">Import IGST + cess (ITC, not cost)</span>
                <span className="tabular">{formatMoney(String(itc))}</span>
              </div>
            )}
            {editable && chosen.length > 0 && <p className="pt-2 text-[12px] text-subtle">{chosen.length} receipt(s) chosen</p>}
          </div>
        </Card>
      </div>

      {voucher && voucher.status !== 'draft' && <p className="text-[12px] text-subtle">Posted {voucher.submittedAt ? formatDateTime(voucher.submittedAt) : ''} · posting date {formatDate(voucher.postingDate)}.</p>}
      {cancelling && voucher && <CancelDialog voucher={voucher} onClose={() => setCancelling(false)} />}
    </div>
  );
}

function CancelDialog({ voucher, onClose }: { voucher: LandedCostDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/landed-costs/${voucher.id}/cancel`, { method: 'POST', body: { reason }, scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['landed-cost', voucher.id] });
      void qc.invalidateQueries({ queryKey: ['landed-costs'] });
      void qc.invalidateQueries({ queryKey: ['balance'] });
      onClose();
    },
  });
  return (
    <FormDialog
      title={`Cancel ${voucher.number}`}
      description="Restores the stock values exactly. Refused if the stock has been issued or revalued since; record a correcting voucher then."
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel="Cancel voucher"
    >
      <Field label="Reason (recorded in the audit log)" error={fieldErrors(m.error).reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
