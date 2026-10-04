'use client';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Tr } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Recycle, Truck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { fieldErrors, FormDialog } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import { formatDate, formatQty, today } from '@/lib/format';
import { DISPOSAL_LABELS, HAZARDOUS_CATEGORIES, WASTE_CATEGORY_LABELS } from '@/lib/stock';
import type { Party, Uom, WasteBalance, WasteMovement } from '@/lib/types';

/** Hazardous waste may be stored for a limited period under the HW Rules 2016; we warn at 90 days. */
const HAZARDOUS_HOLD_DAYS = 90;

export default function WastePage() {
  return (
    <>
      <PageHeader title="Waste register" description="Every kilogram of waste generated and where it went: returned, sold or sent to an authorised recycler. Customer waste stays theirs." />
      <EntityGate what="the waste register">
        <Waste />
      </EntityGate>
    </>
  );
}

type DialogState = { kind: 'generated' } | { kind: 'disposed'; balance?: WasteBalance } | null;

function Waste() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [cancelling, setCancelling] = useState<WasteMovement | null>(null);
  const balances = useQuery({ queryKey: ['waste-balances', ws.entityId], queryFn: () => api<WasteBalance[]>('/waste/balances', { scope: ws.scope }) });
  const moves = useQuery({ queryKey: ['waste', ws.entityId], queryFn: () => api<WasteMovement[]>('/waste', { scope: ws.scope }) });
  const canCreate = ws.can('ehs.waste.create');
  const onHand = (balances.data ?? []).filter((b) => Number(b.balance) > 0);
  const now = Date.now();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="On hand"
          description="Waste waiting to be returned or disposed of, by stream. Alloys are kept separate."
          actions={
            canCreate && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'disposed' })}>
                  <Truck className="size-3.5" /> Record disposal
                </Button>
                <Button size="sm" onClick={() => setDialog({ kind: 'generated' })}>
                  <Plus className="size-3.5" /> Record waste
                </Button>
              </>
            )
          }
        />
        {onHand.length === 0 ? (
          <EmptyState icon={<Recycle className="size-5" />} title="Nothing on hand" description="Weigh swarf and offcuts against the job that produced them; scrapped stock arrives here automatically." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Stream</Th>
                <Th>Owner</Th>
                <Th className="text-right">Generated</Th>
                <Th className="text-right">Disposed</Th>
                <Th className="text-right">On hand</Th>
                <Th>Held since</Th>
                <Th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {onHand.map((b) => {
                const days = b.firstGenerated ? Math.floor((now - new Date(b.firstGenerated).getTime()) / 86_400_000) : 0;
                return (
                  <Tr key={`${b.category}:${b.material}:${b.ownerPartyId}`}>
                    <Td>
                      <p className="text-[13px] font-medium">{b.material}</p>
                      <p className="text-[12px] text-muted">
                        {WASTE_CATEGORY_LABELS[b.category]}
                        {b.hazardous && (
                          <Badge tone="danger" className="ml-2">
                            Hazardous
                          </Badge>
                        )}
                      </p>
                    </Td>
                    <Td>{b.ownerName ? <Badge tone="warning">{b.ownerName}</Badge> : <span className="text-[13px] text-muted">Us</span>}</Td>
                    <Td className="tabular text-right text-[13px]">{formatQty(b.generated)}</Td>
                    <Td className="tabular text-right text-[13px] text-muted">{formatQty(b.disposed)}</Td>
                    <Td className="tabular text-right font-semibold whitespace-nowrap">
                      {formatQty(b.balance)} <span className="text-[11px] font-normal text-subtle">{b.uomCode}</span>
                    </Td>
                    <Td className="text-[13px] whitespace-nowrap">
                      {b.firstGenerated ? formatDate(b.firstGenerated) : '—'}
                      {b.hazardous && days > HAZARDOUS_HOLD_DAYS && (
                        <Badge tone="danger" className="ml-2">
                          {days} days
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      {canCreate && (
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'disposed', balance: b })}>
                          Dispose
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Movements" description="Append-only. Corrections are cancellations with a reason." />
        {moves.data?.length === 0 ? (
          <EmptyState title="No waste recorded yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Movement</Th>
                <Th>Stream</Th>
                <Th>Owner</Th>
                <Th className="text-right">Qty</Th>
                <Th>Details</Th>
                <Th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {moves.data?.map((m) => (
                <Tr key={m.id} className={m.cancelledAt ? 'opacity-50' : ''}>
                  <Td className="text-[13px] whitespace-nowrap">{formatDate(m.movementDate)}</Td>
                  <Td>
                    {m.kind === 'generated' ? <Badge tone="info">Generated</Badge> : <Badge tone="success">{DISPOSAL_LABELS[m.disposalMethod ?? 'other']}</Badge>}
                    {m.cancelledAt && (
                      <Badge tone="danger" className="ml-1">
                        Cancelled
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-[13px]">{m.material}</Td>
                  <Td className="text-[13px]">{m.ownerName ?? <span className="text-muted">Us</span>}</Td>
                  <Td className={`tabular text-right text-[13px] font-medium whitespace-nowrap ${m.kind === 'disposed' ? 'text-danger' : ''}`}>
                    {m.kind === 'disposed' ? '−' : '+'}
                    {formatQty(m.qty)} <span className="text-[11px] font-normal text-subtle">{m.uomCode}</span>
                  </Td>
                  <Td className="text-[12px] text-muted">
                    {m.stockEntryNumber && m.stockEntryId && (
                      <Link href={`/app/inventory/entries/${m.stockEntryId}`} className="mr-2 font-mono text-fg hover:text-accent">
                        {m.stockEntryNumber}
                      </Link>
                    )}
                    {[m.sourceRef && `Ref ${m.sourceRef}`, m.counterpartyName, m.documentNo && `Doc ${m.documentNo}`, m.consentRef && `Consent: ${m.consentRef}`, m.cancelReason && `Cancelled: ${m.cancelReason}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Td>
                  <Td>
                    {!m.cancelledAt && !m.stockEntryId && ws.can('ehs.waste.cancel') && (
                      <Button size="sm" variant="ghost" onClick={() => setCancelling(m)}>
                        Cancel
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {dialog && (
        <WasteDialog
          kind={dialog.kind}
          balance={dialog.kind === 'disposed' ? dialog.balance : undefined}
          balances={onHand}
          onClose={() => setDialog(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['waste'] });
            void qc.invalidateQueries({ queryKey: ['waste-balances'] });
            setDialog(null);
          }}
        />
      )}
      {cancelling && <CancelWasteDialog movement={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

function WasteDialog({
  kind,
  balance,
  balances,
  onClose,
  onSaved,
}: {
  kind: 'generated' | 'disposed';
  balance?: WasteBalance | undefined;
  balances: WasteBalance[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const ws = useWorkspace();
  const uoms = useQuery({ queryKey: ['uoms', ws.tenantId], queryFn: () => api<Uom[]>('/uoms', { scope: ws.scope }) });
  const parties = useQuery({ queryKey: ['parties', ws.tenantId, 'all'], queryFn: () => api<Party[]>('/parties?limit=500', { scope: ws.scope }) });
  const kg = uoms.data?.find((u) => u.code === 'KG')?.id ?? '';
  const [stream, setStream] = useState(balance ? `${balance.category}|${balance.material}|${balance.ownerPartyId ?? ''}` : '');
  const [f, setF] = useState({
    movementDate: today(),
    category: balance?.category ?? 'metal_swarf',
    material: balance?.material ?? '',
    qty: balance ? String(Number(balance.balance)) : '',
    uomId: '',
    ownerPartyId: balance?.ownerPartyId ?? '',
    sourceRef: '',
    disposalMethod: balance?.ownerPartyId ? 'returned_to_customer' : 'authorised_recycler',
    counterpartyId: '',
    documentNo: '',
    consentRef: '',
    remarks: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const chosen = balances.find((b) => `${b.category}|${b.material}|${b.ownerPartyId ?? ''}` === stream);
  const customerOwned = kind === 'disposed' ? !!chosen?.ownerPartyId : !!f.ownerPartyId;
  const needsConsent = kind === 'disposed' && customerOwned && f.disposalMethod !== 'returned_to_customer';

  const m = useMutation({
    mutationFn: () => {
      const base =
        kind === 'disposed'
          ? { category: chosen?.category, material: chosen?.material, ownerPartyId: chosen?.ownerPartyId ?? null, uomId: uoms.data?.find((u) => u.code === chosen?.uomCode)?.id ?? kg }
          : { category: f.category, material: f.material, ownerPartyId: f.ownerPartyId || null, uomId: f.uomId || kg };
      return api('/waste', {
        method: 'POST',
        scope: ws.scope,
        body: {
          kind,
          movementDate: f.movementDate,
          qty: f.qty,
          ...base,
          sourceRef: kind === 'generated' ? f.sourceRef || null : null,
          disposalMethod: kind === 'disposed' ? f.disposalMethod : null,
          counterpartyId: kind === 'disposed' && f.disposalMethod !== 'returned_to_customer' ? f.counterpartyId || null : null,
          documentNo: kind === 'disposed' ? f.documentNo || null : null,
          consentRef: needsConsent ? f.consentRef || null : null,
          remarks: f.remarks || null,
        },
      });
    },
    onSuccess: onSaved,
  });
  const e = fieldErrors(m.error);

  return (
    <FormDialog
      title={kind === 'generated' ? 'Record waste generated' : 'Record disposal'}
      description={kind === 'generated' ? 'Weigh it and note the job it came from. Keep each alloy as its own stream.' : 'Return to the customer, sell, or hand over to an authorised recycler / TSDF.'}
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      wide
    >
      {kind === 'generated' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category" error={e.category}>
              {(p) => (
                <Select {...p} value={f.category} onChange={set('category')}>
                  {Object.entries(WASTE_CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                      {HAZARDOUS_CATEGORIES.has(k) ? ' (hazardous)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Material" hint="e.g. Ti-6Al-4V swarf" error={e.material} className="sm:col-span-2">
              {(p) => <Input {...p} value={f.material} onChange={set('material')} required />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Belongs to" hint="Waste from customer material is theirs" error={e.ownerPartyId}>
              {(p) => (
                <Select {...p} value={f.ownerPartyId} onChange={set('ownerPartyId')}>
                  <option value="">Us</option>
                  {parties.data
                    ?.filter((x) => x.isCustomer)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label="From job / work order" error={e.sourceRef}>{(p) => <Input {...p} value={f.sourceRef} onChange={set('sourceRef')} placeholder="WO-0123" />}</Field>
            <Field label="Date" error={e.movementDate}>{(p) => <Input {...p} type="date" value={f.movementDate} onChange={set('movementDate')} />}</Field>
          </div>
        </>
      ) : (
        <>
          <Field label="Waste stream" error={e.category ?? e.material}>
            {(p) => (
              <Select {...p} value={stream} onChange={(ev) => setStream(ev.target.value)} required>
                <option value="">Choose…</option>
                {balances.map((b) => (
                  <option key={`${b.category}|${b.material}|${b.ownerPartyId ?? ''}`} value={`${b.category}|${b.material}|${b.ownerPartyId ?? ''}`}>
                    {b.material} · {b.ownerName ?? 'ours'} · {formatQty(b.balance)} {b.uomCode} on hand
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Method" error={e.disposalMethod}>
              {(p) => (
                <Select {...p} value={f.disposalMethod} onChange={set('disposalMethod')}>
                  {Object.entries(DISPOSAL_LABELS)
                    .filter(([k]) => k !== 'returned_to_customer' || customerOwned)
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            {f.disposalMethod !== 'returned_to_customer' && (
              <Field label="Handed to" error={e.counterpartyId}>
                {(p) => (
                  <Select {...p} value={f.counterpartyId} onChange={set('counterpartyId')}>
                    <option value="">—</option>
                    {parties.data?.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label={f.disposalMethod === 'tsdf' ? 'Manifest (Form 10) no.' : 'Challan / invoice no.'} error={e.documentNo}>
              {(p) => <Input {...p} value={f.documentNo} onChange={set('documentNo')} />}
            </Field>
          </div>
          {needsConsent && (
            <Field label="Customer's consent" hint="Email or letter reference authorising this disposal" error={e.consentRef}>
              {(p) => <Input {...p} value={f.consentRef} onChange={set('consentRef')} required />}
            </Field>
          )}
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Quantity" error={e.qty}>{(p) => <Input {...p} value={f.qty} onChange={set('qty')} inputMode="decimal" className="tabular" required />}</Field>
        {kind === 'generated' ? (
          <Field label="Unit" error={e.uomId}>
            {(p) => (
              <Select {...p} value={f.uomId || kg} onChange={set('uomId')}>
                {uoms.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Date" error={e.movementDate}>{(p) => <Input {...p} type="date" value={f.movementDate} onChange={set('movementDate')} />}</Field>
        )}
        <Field label="Remarks" error={e.remarks}>{(p) => <Input {...p} value={f.remarks} onChange={set('remarks')} />}</Field>
      </div>
    </FormDialog>
  );
}

function CancelWasteDialog({ movement, onClose }: { movement: WasteMovement; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/waste/${movement.id}/cancel`, { method: 'POST', body: { reason }, scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['waste'] });
      void qc.invalidateQueries({ queryKey: ['waste-balances'] });
      onClose();
    },
  });
  return (
    <FormDialog title="Cancel waste record" description={`${movement.material} · ${formatQty(movement.qty)} ${movement.uomCode}`} onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel="Cancel record">
      <Field label="Reason" error={fieldErrors(m.error).reason}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
