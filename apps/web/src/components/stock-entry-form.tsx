'use client';
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatQty, today, WAREHOUSE_TYPE_LABELS } from '@/lib/format';
import { PURPOSE_LABELS, STATUS_TONE, WASTE_CATEGORY_LABELS } from '@/lib/stock';
import type { Batch, Item, Party, PurchaseOrderDetail, StockEntryDetail, StockPurpose, Warehouse } from '@/lib/types';
import { fieldErrors, FormDialog } from './form-dialog';
import { ItemPicker } from './item-picker';
import { useWorkspace } from './workspace';

interface DraftLine {
  key: string;
  item: Pick<Item, 'id' | 'code' | 'name' | 'tracking'> & { uomCode?: string };
  qty: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  batchId: string;
  newBatchNo: string;
  heatNo: string;
  expiryDate: string;
  rate: string;
  /** Scrap lines: waste-register category. */
  wasteCategory: string;
  /** Adjustments only: increase (to a warehouse) or decrease (from one). */
  direction: 'in' | 'out';
  /** Receipts against a purchase order: the PO line and what is still to come. */
  poLineId: string | null;
  pendingQty: string | null;
  /** Foreign-currency PO: the cost is filled in rupees at the PO's exchange rate on submit. */
  poRateHint: string | null;
}

let keySeq = 0;
const blankLine = (prev?: DraftLine): DraftLine => ({
  key: `l${++keySeq}`,
  item: null as unknown as DraftLine['item'],
  qty: '',
  fromWarehouseId: prev?.fromWarehouseId ?? '',
  toWarehouseId: prev?.toWarehouseId ?? '',
  batchId: '',
  newBatchNo: '',
  heatNo: '',
  expiryDate: '',
  rate: '',
  wasteCategory: prev?.wasteCategory ?? '',
  direction: prev?.direction ?? 'in',
  poLineId: null,
  pendingQty: null,
  poRateHint: null,
});

/** Create or edit a draft; view a submitted/cancelled entry. Server enforces every rule; the UI explains them. */
export function StockEntryForm({ entry, initialPurpose, poId }: { entry?: StockEntryDetail; initialPurpose?: StockPurpose; poId?: string }) {
  const ws = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  const purpose = entry?.purpose ?? initialPurpose ?? 'receipt';
  const editable = !entry || entry.status === 'draft';
  const canSubmit = ws.can('inventory.stock_entry.submit');

  const warehouses = useQuery({ queryKey: ['warehouses', ws.entityId], queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }) });
  const suppliers = useQuery({
    queryKey: ['parties', ws.tenantId, '', 'supplier'],
    queryFn: () => api<Party[]>('/parties?role=supplier&limit=500', { scope: ws.scope }),
    enabled: purpose === 'receipt' && ws.can('masters.party.read'),
  });
  const customers = useQuery({
    queryKey: ['parties', ws.tenantId, '', 'customer'],
    queryFn: () => api<Party[]>('/parties?role=customer&limit=500', { scope: ws.scope }),
    enabled: ws.can('masters.party.read'),
  });

  const [header, setHeader] = useState({
    postingDate: entry?.postingDate ?? today(),
    partyId: entry?.partyId ?? '',
    reference: entry?.reference ?? '',
    remarks: entry?.remarks ?? '',
    /** Customer who owns the material (decision 024); '' = our own stock. */
    ownerPartyId: entry?.ownerPartyId ?? '',
    purchaseOrderId: entry?.purchaseOrderId ?? (purpose === 'receipt' ? (poId ?? '') : ''),
  });
  const po = useQuery({
    queryKey: ['purchase-order', header.purchaseOrderId],
    queryFn: () => api<PurchaseOrderDetail>(`/purchase-orders/${header.purchaseOrderId}`, { scope: ws.scope }),
    enabled: !!header.purchaseOrderId && ws.can('buying.purchase_order.read'),
  });
  const customerOwned = !!header.ownerPartyId;
  const [lines, setLines] = useState<DraftLine[]>(() =>
    entry?.lines.length
      ? entry.lines.map((l) => ({
          key: l.id,
          item: { id: l.itemId, code: l.itemCode, name: l.itemName, tracking: l.tracking, uomCode: l.uomCode },
          qty: String(Number(l.qty)),
          fromWarehouseId: l.fromWarehouseId ?? '',
          toWarehouseId: l.toWarehouseId ?? '',
          batchId: l.batchId ?? '',
          newBatchNo: l.newBatchNo ?? '',
          heatNo: l.heatNo ?? '',
          expiryDate: l.expiryDate ?? '',
          rate: l.rate ? String(Number(l.rate)) : '',
          wasteCategory: l.wasteCategory ?? '',
          direction: l.toWarehouseId && !l.fromWarehouseId ? 'in' : 'out',
          poLineId: l.poLineId ?? null,
          pendingQty: null,
          poRateHint: null,
        }))
      : [blankLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** Id of a draft this form created, so a failed submit keeps the form (and its error) mounted. */
  const [draftId, setDraftId] = useState<string | null>(null);

  // Default the warehouses for new documents once they load.
  useEffect(() => {
    if (entry || !warehouses.data) return;
    const by = (t: string) => warehouses.data.find((w) => w.type === t)?.id ?? '';
    setLines((ls) =>
      ls.map((l) => ({
        ...l,
        toWarehouseId: l.toWarehouseId || (purpose === 'receipt' ? by('quarantine') || by('stores') : purpose === 'transfer' ? by('stores') : purpose === 'adjustment' ? by('stores') : ''),
        fromWarehouseId:
          l.fromWarehouseId ||
          (purpose === 'issue' || purpose === 'return' ? by('stores') : purpose === 'transfer' ? by('quarantine') : purpose === 'scrap' ? by('mrb') || by('stores') : purpose === 'adjustment' ? by('stores') : ''),
      })),
    );
  }, [warehouses.data, entry, purpose]);

  // Receiving against a PO: one line per item still to come, at the PO rate; inspected items go to quarantine.
  const [poFilled, setPoFilled] = useState(!!entry);
  useEffect(() => {
    if (poFilled || !po.data || !warehouses.data) return;
    setPoFilled(true);
    const by = (t: string) => warehouses.data.find((w) => w.type === t)?.id ?? '';
    setHeader((h) => ({ ...h, partyId: po.data.supplierId, ownerPartyId: '' }));
    const ls = po.data.lines
      .filter((l) => Number(l.pendingQty) > 0)
      .map((l) => ({
        ...blankLine(),
        item: { id: l.itemId, code: l.itemCode, name: l.itemName, tracking: l.tracking, uomCode: l.uomCode },
        qty: String(Number(l.pendingQty)),
        rate: po.data.currency === 'INR' ? String(Number(l.rate)) : '',
        poRateHint: po.data.currency === 'INR' ? null : `${po.data.currency} ${Number(l.rate)} × ₹${Number(po.data.exchangeRate)}`,
        toWarehouseId: l.requiresInspection ? by('quarantine') || by('stores') : by('stores'),
        poLineId: l.id,
        pendingQty: l.pendingQty,
      }));
    if (ls.length) setLines(ls);
  }, [po.data, warehouses.data, poFilled]);

  const update = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const usesFrom = (l: DraftLine) => purpose === 'issue' || purpose === 'transfer' || purpose === 'return' || purpose === 'scrap' || (purpose === 'adjustment' && l.direction === 'out');
  const usesTo = (l: DraftLine) => purpose === 'receipt' || purpose === 'transfer' || (purpose === 'adjustment' && l.direction === 'in');
  const incoming = (l: DraftLine) => purpose === 'receipt' || (purpose === 'adjustment' && l.direction === 'in');

  const payload = () => ({
    purpose,
    postingDate: header.postingDate,
    // Returns go to the owner; a customer's own receipts come from them.
    partyId: purpose === 'return' || (purpose === 'receipt' && customerOwned) ? header.ownerPartyId || null : header.partyId || null,
    ownerPartyId: header.ownerPartyId || null,
    purchaseOrderId: header.purchaseOrderId || null,
    reference: header.reference || null,
    remarks: header.remarks || null,
    lines: lines
      .filter((l) => l.item)
      .map((l) => ({
        itemId: l.item.id,
        qty: l.qty,
        fromWarehouseId: usesFrom(l) ? l.fromWarehouseId || null : null,
        toWarehouseId: usesTo(l) ? l.toWarehouseId || null : null,
        batchId: l.item.tracking === 'batch' && !incoming(l) ? l.batchId || null : null,
        newBatchNo: l.item.tracking === 'batch' && incoming(l) ? l.newBatchNo || null : null,
        heatNo: l.item.tracking === 'batch' && incoming(l) ? l.heatNo || l.newBatchNo || null : null,
        expiryDate: l.item.tracking === 'batch' && incoming(l) ? l.expiryDate || null : null,
        rate: incoming(l) && !customerOwned ? l.rate || null : null,
        wasteCategory: purpose === 'scrap' ? l.wasteCategory || null : null,
        poLineId: header.purchaseOrderId ? l.poLineId : null,
      })),
  });

  const save = useMutation({
    mutationFn: async (andSubmit: boolean) => {
      setError(null);
      const body = payload();
      if (body.lines.length === 0) throw new Error('Add at least one item');
      let id = entry?.id ?? draftId;
      if (id) await api(`/stock-entries/${id}`, { method: 'PUT', body, scope: ws.scope });
      else {
        id = (await api<{ id: string }>('/stock-entries', { method: 'POST', body, scope: ws.scope })).id;
        // Point the URL at the saved draft without remounting, so a submit error below stays visible.
        setDraftId(id);
        window.history.replaceState(null, '', `/app/inventory/entries/${id}`);
      }
      if (andSubmit) await api(`/stock-entries/${id}/submit`, { method: 'POST', scope: ws.scope });
      return id;
    },
    onSuccess: (id, andSubmit) => {
      void qc.invalidateQueries({ queryKey: ['stock-entries'] });
      void qc.invalidateQueries({ queryKey: ['stock-entry', id] });
      void qc.invalidateQueries({ queryKey: ['balance'] });
      void qc.invalidateQueries({ queryKey: ['purchase-order'] });
      void qc.invalidateQueries({ queryKey: ['inspections-pending'] });
      // A brand-new document opens its own page once saved; existing ones refetch in place.
      if (!entry && andSubmit) router.replace(`/app/inventory/entries/${id}`);
    },
    onError: (e) => setError(e instanceof ApiError && e.issues.length ? e.issues.map((i) => `${i.path}: ${i.message}`).join('; ') : (e as Error).message),
  });

  const remove = useMutation({
    mutationFn: () => api(`/stock-entries/${entry?.id ?? draftId}`, { method: 'DELETE', scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stock-entries'] });
      router.replace('/app/inventory/entries');
    },
  });

  // Ctrl/⌘+Enter saves the draft (docs/13 X3).
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

  const whs = warehouses.data ?? [];
  const whLabel = (id: string | null) => {
    const w = whs.find((x) => x.id === id);
    return w ? `${w.code}` : '—';
  };
  const totalValue = entry?.lines.reduce((s, l) => s + Number(l.value ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">
            <Link href="/app/inventory/entries" className="hover:text-fg">
              Stock entries
            </Link>{' '}
            / {PURPOSE_LABELS[purpose]}
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-[22px] font-semibold tracking-tight">
            <span className="font-mono">{entry?.number ?? (draftId ? `Draft ${PURPOSE_LABELS[purpose].toLowerCase()}` : `New ${PURPOSE_LABELS[purpose].toLowerCase()}`)}</span>
            {entry && (
              <Badge tone={STATUS_TONE[entry.status]} dot>
                {entry.status[0]!.toUpperCase() + entry.status.slice(1)}
              </Badge>
            )}
            {entry?.ownerName && <Badge tone="warning">{entry.ownerName}&apos;s material</Badge>}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (entry || draftId) && ws.can('inventory.stock_entry.create') && (
            <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 className="size-4" /> Delete draft
            </Button>
          )}
          {editable && (
            <Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false}>
              Save draft <kbd className="ml-1 hidden rounded border border-line px-1 font-mono text-[10px] text-subtle sm:inline">Ctrl ↵</kbd>
            </Button>
          )}
          {editable && canSubmit && (
            <Button onClick={() => save.mutate(true)} loading={save.isPending && save.variables === true}>
              <Send className="size-4" /> Submit
            </Button>
          )}
          {entry?.status === 'submitted' && !entry.systemGenerated && ws.can('inventory.stock_entry.cancel') && (
            <Button variant="secondary" onClick={() => setCancelling(true)}>
              <Ban className="size-4" /> Cancel entry
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert tone="danger" title="Not posted">
          {error}
        </Alert>
      )}
      {entry?.status === 'cancelled' && (
        <Alert tone="danger" title={`Cancelled ${entry.cancelledAt ? formatDateTime(entry.cancelledAt) : ''}`}>
          {entry.cancelReason} · The ledger shows the original postings and their exact reversals.
        </Alert>
      )}
      {editable && purpose === 'scrap' && (
        <Alert tone="info">Scrapped stock leaves inventory and enters the waste register under the same owner, where it's later returned, sold or sent to a recycler.</Alert>
      )}
      {header.purchaseOrderId && (
        <Alert tone="info">
          {editable ? 'Receiving against ' : 'Received against '}
          <Link href={`/app/buying/orders/${header.purchaseOrderId}`} className="font-mono font-medium underline">
            {po.data?.number ?? 'the purchase order'}
          </Link>
          {editable ? '. Quantities above what is still pending are refused; leave the cost blank to use the PO rate.' : '.'}
        </Alert>
      )}
      {editable && purpose === 'receipt' && !header.purchaseOrderId && (
        <Alert tone="info">Receipts go to quarantine by default. Items that need incoming inspection are released from there under Buying → Incoming inspection; quarantine stock can't be issued.</Alert>
      )}
      {entry?.systemGenerated && <Alert tone="info">Posted automatically by another document (e.g. an incoming inspection). Cancel that document to reverse it.</Alert>}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Posting date">
            {(p) => <Input {...p} type="date" value={header.postingDate} onChange={(e) => setHeader({ ...header, postingDate: e.target.value })} disabled={!editable} />}
          </Field>
          <Field label="Material belongs to" hint={customerOwned ? 'Customer-supplied: counted, never valued' : undefined}>
            {(p) => (
              <Select
                {...p}
                value={header.ownerPartyId}
                onChange={(e) => (setHeader({ ...header, ownerPartyId: e.target.value }), setLines((ls) => ls.map((l) => ({ ...l, batchId: '' }))))}
                disabled={!editable || !!header.purchaseOrderId}
              >
                <option value="">{purpose === 'return' ? 'Choose the customer…' : 'Us (own stock)'}</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {purpose === 'receipt' && !customerOwned && (
            <Field label="Supplier">
              {(p) => (
                <Select {...p} value={header.partyId} onChange={(e) => setHeader({ ...header, partyId: e.target.value })} disabled={!editable || !!header.purchaseOrderId}>
                  <option value="">—</option>
                  {suppliers.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={purpose === 'receipt' ? (customerOwned ? "Customer's challan no." : 'Delivery challan / invoice no.') : purpose === 'return' ? 'Return challan no.' : purpose === 'scrap' ? 'NCR / reason ref.' : 'Job / work order ref.'}>
            {(p) => <Input {...p} value={header.reference} onChange={(e) => setHeader({ ...header, reference: e.target.value })} disabled={!editable} />}
          </Field>
          <Field label="Remarks" className={purpose === 'receipt' && !customerOwned ? 'lg:col-span-4' : ''}>
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
              {purpose === 'adjustment' && <Th>Direction</Th>}
              <Th className="w-28 text-right">Qty</Th>
              {purpose !== 'receipt' && <Th className="min-w-36">From</Th>}
              {(purpose === 'receipt' || purpose === 'transfer' || purpose === 'adjustment') && <Th className="min-w-36">To</Th>}
              <Th className="min-w-48">Batch / heat no.</Th>
              {purpose === 'scrap' && <Th className="min-w-44">Waste category</Th>}
              <Th className="w-32 text-right">{editable ? 'Unit cost' : 'Rate'}</Th>
              {!editable && <Th className="text-right">Value</Th>}
              {editable && <Th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {editable
              ? lines.map((l, i) => (
                  <tr key={l.key} className="align-top">
                    <Td className="pt-4 text-[12px] text-subtle">{i + 1}</Td>
                    <Td>
                      <ItemPicker
                        value={l.item}
                        autoFocus={i === lines.length - 1 && i > 0}
                        onChange={(it) => update(l.key, { item: { id: it.id, code: it.code, name: it.name, tracking: it.tracking, uomCode: it.uomCode }, batchId: '', newBatchNo: '', heatNo: '' })}
                      />
                    </Td>
                    {purpose === 'adjustment' && (
                      <Td>
                        <Select value={l.direction} onChange={(e) => update(l.key, { direction: e.target.value as 'in' | 'out' })} aria-label="Direction">
                          <option value="in">Increase</option>
                          <option value="out">Decrease</option>
                        </Select>
                      </Td>
                    )}
                    <Td>
                      <div className="flex items-center gap-1">
                        <Input className="tabular text-right" inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} aria-label="Quantity" />
                        <span className="w-9 text-[11px] text-subtle">{l.item?.uomCode}</span>
                      </div>
                      {l.pendingQty && <p className="mt-1 text-[11px] text-subtle">{formatQty(l.pendingQty)} pending on PO</p>}
                    </Td>
                    {purpose !== 'receipt' && (
                      <Td>{usesFrom(l) ? <WarehouseSelect value={l.fromWarehouseId} onChange={(v) => update(l.key, { fromWarehouseId: v, batchId: '' })} warehouses={whs} label="From warehouse" /> : <Muted />}</Td>
                    )}
                    {(purpose === 'receipt' || purpose === 'transfer' || purpose === 'adjustment') && (
                      <Td>{usesTo(l) ? <WarehouseSelect value={l.toWarehouseId} onChange={(v) => update(l.key, { toWarehouseId: v })} warehouses={whs} label="To warehouse" /> : <Muted />}</Td>
                    )}
                    <Td>
                      {!l.item ? (
                        <Muted />
                      ) : l.item.tracking !== 'batch' ? (
                        <span className="text-[12px] text-subtle">Not tracked</span>
                      ) : incoming(l) ? (
                        <div className="grid gap-1">
                          <Input placeholder="Batch / heat no." value={l.newBatchNo} onChange={(e) => update(l.key, { newBatchNo: e.target.value })} className="font-mono" aria-label="New batch number" />
                          <Input type="date" value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} aria-label="Expiry date" title="Expiry (optional; defaults from shelf life)" />
                        </div>
                      ) : (
                        <BatchSelect itemId={l.item.id} warehouseId={l.fromWarehouseId} owner={header.ownerPartyId || 'company'} value={l.batchId} onChange={(v) => update(l.key, { batchId: v })} />
                      )}
                    </Td>
                    {purpose === 'scrap' && (
                      <Td>
                        <Select value={l.wasteCategory} onChange={(e) => update(l.key, { wasteCategory: e.target.value })} aria-label="Waste category">
                          <option value="">Choose…</option>
                          {Object.entries(WASTE_CATEGORY_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      </Td>
                    )}
                    <Td>
                      {incoming(l) && customerOwned ? (
                        <p className="pt-2 text-right text-[12px] text-subtle">No cost</p>
                      ) : incoming(l) ? (
                        <>
                          <Input className="tabular text-right" inputMode="decimal" placeholder={l.poRateHint ? 'From PO' : '₹'} value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} aria-label="Unit cost" />
                          {l.poRateHint && !l.rate && <p className="mt-1 text-right text-[11px] text-subtle">{l.poRateHint}</p>}
                        </>
                      ) : (
                        <p className="pt-2 text-right text-[12px] text-subtle">FIFO</p>
                      )}
                    </Td>
                    <Td>
                      <Button variant="ghost" size="icon" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1}>
                        <Trash2 className="size-4" />
                      </Button>
                    </Td>
                  </tr>
                ))
              : entry!.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="text-[12px] text-subtle">{l.lineNo}</Td>
                    <Td>
                      <span className="font-mono text-[13px] font-medium">{l.itemCode}</span> <span className="text-[13px] text-muted">{l.itemName}</span>
                    </Td>
                    {purpose === 'adjustment' && <Td className="text-[13px]">{l.toWarehouseId ? 'Increase' : 'Decrease'}</Td>}
                    <Td className="tabular text-right">
                      {formatQty(l.qty)} <span className="text-[11px] text-subtle">{l.uomCode}</span>
                    </Td>
                    {purpose !== 'receipt' && <Td className="font-mono text-[12px]">{whLabel(l.fromWarehouseId)}</Td>}
                    {(purpose === 'receipt' || purpose === 'transfer' || purpose === 'adjustment') && <Td className="font-mono text-[12px]">{whLabel(l.toWarehouseId)}</Td>}
                    <Td className="font-mono text-[12px]">{l.batchNo ?? '—'}</Td>
                    {purpose === 'scrap' && <Td className="text-[13px]">{l.wasteCategory ? WASTE_CATEGORY_LABELS[l.wasteCategory] : '—'}</Td>}
                    <Td className="tabular text-right text-[13px]">{l.rate && !customerOwned ? formatMoney(l.rate) : '—'}</Td>
                    <Td className="tabular text-right text-[13px] font-medium">{l.value ? formatMoney(l.value) : '—'}</Td>
                  </tr>
                ))}
          </tbody>
          {!editable && (
            <tfoot>
              <tr>
                <td colSpan={20} className="px-4 py-3 text-right text-[13px]">
                  Total value <span className="tabular ml-3 font-semibold">{formatMoney(String(totalValue))}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </Table>
        {editable && (
          <div className="border-t border-line px-4 py-2">
            <Button variant="link" size="sm" onClick={() => setLines((ls) => [...ls, blankLine(ls[ls.length - 1])])}>
              <Plus className="size-3.5" /> Add line
            </Button>
          </div>
        )}
      </Card>

      {entry && entry.status !== 'draft' && (
        <p className="text-[12px] text-subtle">
          Posted {entry.submittedAt ? formatDateTime(entry.submittedAt) : ''} · posting date {formatDate(entry.postingDate)} · values at FIFO cost.
        </p>
      )}
      {cancelling && entry && <CancelDialog entry={entry} onClose={() => setCancelling(false)} />}
    </div>
  );
}

function Muted() {
  return <span className="text-[12px] text-subtle">—</span>;
}

function WarehouseSelect({ value, onChange, warehouses, label }: { value: string; onChange: (v: string) => void; warehouses: Warehouse[]; label: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Choose…</option>
      {warehouses
        .filter((w) => w.isActive)
        .map((w) => (
          <option key={w.id} value={w.id}>
            {w.code} · {WAREHOUSE_TYPE_LABELS[w.type] ?? w.type}
          </option>
        ))}
    </Select>
  );
}

/** Batches with stock in the chosen warehouse, earliest expiry first (FEFO). */
function BatchSelect({ itemId, warehouseId, owner, value, onChange }: { itemId: string; warehouseId: string; owner: string; value: string; onChange: (v: string) => void }) {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['batches', ws.entityId, itemId, warehouseId, owner],
    queryFn: () => api<Batch[]>(`/batches?itemId=${itemId}&inStock=true&owner=${owner}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`, { scope: ws.scope }),
  });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Batch">
      <option value="">{q.data?.length === 0 ? 'No stock here' : 'Choose batch…'}</option>
      {q.data?.map((b) => (
        <option key={b.id} value={b.id}>
          {b.batchNo} · {formatQty(b.qty)} {b.expiryDate ? `· exp ${formatDate(b.expiryDate)}` : ''}
        </option>
      ))}
    </Select>
  );
}

function CancelDialog({ entry, onClose }: { entry: StockEntryDetail; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/stock-entries/${entry.id}/cancel`, { method: 'POST', body: { reason }, scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stock-entry', entry.id] });
      void qc.invalidateQueries({ queryKey: ['stock-entries'] });
      void qc.invalidateQueries({ queryKey: ['balance'] });
      onClose();
    },
  });
  return (
    <FormDialog
      title={`Cancel ${entry.number}`}
      description="Posts exact reversals to the stock ledger. The original entry stays visible."
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel="Cancel entry"
    >
      <Field label="Reason (recorded in the audit log)" error={fieldErrors(m.error).reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
