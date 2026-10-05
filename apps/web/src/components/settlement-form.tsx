'use client';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Table, Td, Th } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Send, Trash2, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Account, AccountGroup } from '@/lib/accounting';
import { CURRENCIES, errorText } from '@/lib/buying';
import { formatAmount, formatDate, formatDateTime, formatMoney, today } from '@/lib/format';
import { type BillBalance, type Direction, DIRECTION_LABEL, type Settlement, type SettlementPreview, sideOf } from '@/lib/settlements';
import { STATUS_TONE } from '@/lib/stock';
import type { Party } from '@/lib/types';
import { fieldErrors, FormDialog } from './form-dialog';
import { useWorkspace } from './workspace';

const CASH_GROUPS = ['Cash-in-Hand', 'Bank Accounts'];
const isMoney = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) > 0;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Cash and bank ledgers of the active entity (accounts under Cash-in-Hand or Bank Accounts). */
function useCashAccounts() {
  const ws = useWorkspace();
  const accounts = useQuery({ queryKey: ['accounts', ws.tenantId, ws.entityId], queryFn: () => api<Account[]>('/accounts/accounts', { scope: ws.scope }), retry: false });
  const groups = useQuery({ queryKey: ['account-groups', ws.tenantId, ws.entityId], queryFn: () => api<AccountGroup[]>('/accounts/groups', { scope: ws.scope }), retry: false });
  return useMemo(() => {
    const byId = new Map((groups.data ?? []).map((g) => [g.id, g]));
    const isCash = (groupId: string) => {
      for (let g = byId.get(groupId), depth = 0; g && depth < 20; g = g.parentId ? byId.get(g.parentId) : undefined, depth++) if (CASH_GROUPS.includes(g.name)) return true;
      return false;
    };
    return (accounts.data ?? []).filter((a) => a.isActive && isCash(a.groupId));
  }, [accounts.data, groups.data]);
}

/** Customer receipt or supplier payment. Server computes every INR value; the form only explains them. */
export function SettlementForm({ settlement, initialDirection = 'receipt' }: { settlement?: Settlement; initialDirection?: Direction }) {
  const ws = useWorkspace();
  const router = useRouter();
  const qc = useQueryClient();
  const editable = !settlement || settlement.status === 'draft';
  const direction = settlement?.direction ?? initialDirection;
  const side = sideOf(direction);
  const cash = useCashAccounts();
  const parties = useQuery({
    queryKey: ['parties', ws.tenantId, '', direction === 'receipt' ? 'customer' : 'supplier'],
    queryFn: () => api<Party[]>(`/parties?role=${direction === 'receipt' ? 'customer' : 'supplier'}&limit=500`, { scope: ws.scope }),
    enabled: ws.can('masters.party.read'),
  });

  const [h, setH] = useState({
    partyId: settlement?.partyId ?? '',
    postingDate: settlement?.postingDate ?? today(),
    currency: settlement?.currency ?? 'INR',
    exchangeRate: settlement && settlement.currency !== 'INR' ? String(Number(settlement.exchangeRate)) : '',
    accountId: settlement?.accountId ?? '',
    amount: settlement ? String(Number(settlement.amount)) : '',
    bankReference: settlement?.bankReference ?? '',
    narration: settlement?.narration ?? '',
  });
  const [alloc, setAlloc] = useState<Record<string, string>>(() => Object.fromEntries((settlement?.allocations ?? []).map((a) => [a.billId, String(Number(a.amount))])));
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    if (!h.accountId && cash.length) setH((x) => ({ ...x, accountId: (cash.find((a) => a.role === 'bank') ?? cash[0])!.id }));
  }, [cash, h.accountId]);

  const bills = useQuery({
    queryKey: ['open-bills', ws.entityId, h.partyId, side, h.currency],
    queryFn: () => api<BillBalance[]>(`/accounts/bills?partyId=${h.partyId}&side=${side}&currency=${h.currency}`, { scope: ws.scope }),
    enabled: editable && !!h.partyId,
    // Bills change as invoices are raised elsewhere; never pick from a cached list.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const allocations = Object.entries(alloc)
    .filter(([, v]) => v.trim() !== '')
    .map(([billId, amount]) => ({ billId, amount: amount.trim() }));
  const payload = () => ({
    direction,
    partyId: h.partyId,
    postingDate: h.postingDate,
    currency: h.currency,
    exchangeRate: h.currency === 'INR' ? '1' : h.exchangeRate,
    accountId: h.accountId,
    amount: h.amount.trim(),
    bankReference: h.bankReference.trim() || null,
    narration: h.narration.trim() || null,
    allocations,
  });
  const body = useDebounced(JSON.stringify(payload()));
  const preview = useQuery({
    queryKey: ['settlement-preview', ws.entityId, body],
    queryFn: () => api<SettlementPreview>('/accounts/settlements/preview', { method: 'POST', body: JSON.parse(body), scope: ws.scope }),
    // Decide from the debounced body actually sent (decision recorded in MEMORY).
    enabled:
      editable &&
      (() => {
        const b = JSON.parse(body) as ReturnType<typeof payload>;
        return !!b.partyId && !!b.accountId && isMoney(b.amount) && (b.currency === 'INR' || /^\d+(\.\d+)?$/.test(b.exchangeRate)) && b.allocations.every((a) => isMoney(a.amount));
      })(),
    placeholderData: (prev) => prev,
    retry: false,
  });

  /** Optional suggestion: fill the oldest-due bills up to the amount. Only changes the draft. */
  const suggest = () => {
    let left = Number(h.amount || 0);
    const next: Record<string, string> = {};
    for (const b of [...(bills.data ?? [])].sort((a, z) => (a.dueDate ?? a.recognitionDate).localeCompare(z.dueDate ?? z.recognitionDate))) {
      if (left <= 0) break;
      const take = Math.min(left, Number(b.openAmount));
      next[b.id] = take.toFixed(2);
      left -= take;
    }
    setAlloc(next);
  };

  const save = useMutation({
    mutationFn: async (andSubmit: boolean) => {
      setError(null);
      let id = settlement?.id ?? draftId;
      if (id) await api(`/accounts/settlements/${id}`, { method: 'PUT', body: payload(), scope: ws.scope });
      else {
        id = (await api<{ id: string }>('/accounts/settlements', { method: 'POST', body: payload(), scope: ws.scope })).id;
        setDraftId(id);
        window.history.replaceState(null, '', `/app/accounts/settlements/${id}`);
      }
      if (andSubmit) await api(`/accounts/settlements/${id}/submit`, { method: 'POST', scope: ws.scope });
      return id;
    },
    onSuccess: (id, andSubmit) => {
      void qc.invalidateQueries({ queryKey: ['settlements'] });
      void qc.invalidateQueries({ queryKey: ['settlement', id] });
      void qc.invalidateQueries({ queryKey: ['open-bills'] });
      void qc.invalidateQueries({ queryKey: ['outstanding'] });
      if (!settlement && andSubmit) router.replace(`/app/accounts/settlements/${id}`);
    },
    onError: (e) => {
      setError(errorText(e));
      void qc.invalidateQueries({ queryKey: ['open-bills'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/accounts/settlements/${settlement?.id ?? draftId}`, { method: 'DELETE', scope: ws.scope }),
    onSuccess: () => router.replace('/app/accounts/settlements'),
    onError: (e) => setError(errorText(e)),
  });

  const p = preview.data;
  const fx = p ? Number(p.forexInr) : 0;
  const cur = h.currency;
  const label = DIRECTION_LABEL[direction];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">
            <Link href="/app/accounts/settlements" className="hover:text-fg">
              Receipts & payments
            </Link>
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-[22px] font-semibold tracking-tight">
            <span className="font-mono">{settlement?.number ?? (draftId || settlement ? `Draft ${label.toLowerCase()}` : `New ${label.toLowerCase()}`)}</span>
            {settlement && (
              <Badge tone={STATUS_TONE[settlement.status]} dot>
                {settlement.status[0]!.toUpperCase() + settlement.status.slice(1)}
              </Badge>
            )}
          </h1>
          {settlement && !editable && (
            <p className="mt-1 text-[13px] text-muted">
              {settlement.partyName} · {formatDate(settlement.postingDate)} · {settlement.accountName}
              {settlement.bankReference && ` · ${settlement.bankReference}`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (settlement || draftId) && ws.can('accounts.settlement.create') && (
            <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 className="size-4" /> Delete draft
            </Button>
          )}
          {editable && ws.can('accounts.settlement.create') && (
            <Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false}>
              Save draft
            </Button>
          )}
          {editable && ws.can('accounts.settlement.submit') && (
            <Button onClick={() => save.mutate(true)} loading={save.isPending && save.variables === true} disabled={preview.isFetching}>
              <Send className="size-4" /> Submit
            </Button>
          )}
          {settlement?.status === 'submitted' && ws.can('accounts.settlement.cancel') && (
            <Button variant="secondary" onClick={() => setCancelling(true)}>
              <Ban className="size-4" /> Cancel
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert tone="danger" title="Not posted">
          {error}
        </Alert>
      )}
      {settlement?.status === 'cancelled' && (
        <Alert tone="danger" title={`Cancelled ${settlement.cancelledAt ? formatDateTime(settlement.cancelledAt) : ''}`}>
          {settlement.cancelReason} · The bills it settled are open again.
        </Alert>
      )}
      {editable && <Alert tone="info">The amount is the gross money that moved through the bank or cash account. Bank charges and TDS are recorded separately as journals for now.</Alert>}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={direction === 'receipt' ? 'Customer' : 'Supplier'} className="lg:col-span-2">
            {(f) => (
              <Select {...f} value={h.partyId} onChange={(e) => (setH({ ...h, partyId: e.target.value }), setAlloc({}))} disabled={!editable}>
                <option value="">{settlement && !editable ? settlement.partyName : 'Choose…'}</option>
                {parties.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Date">{(f) => <Input {...f} type="date" value={h.postingDate} onChange={(e) => setH({ ...h, postingDate: e.target.value })} disabled={!editable} />}</Field>
          <Field label={direction === 'receipt' ? 'Received into' : 'Paid from'}>
            {(f) => (
              <Select {...f} value={h.accountId} onChange={(e) => setH({ ...h, accountId: e.target.value })} disabled={!editable}>
                <option value="">{settlement && !editable ? settlement.accountName : 'Choose…'}</option>
                {cash.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Currency">
            {(f) => (
              <Select {...f} value={h.currency} onChange={(e) => (setH({ ...h, currency: e.target.value }), setAlloc({}))} disabled={!editable}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
          {cur !== 'INR' && (
            <Field label={`Exchange rate (₹ per 1 ${cur})`} hint="Bank's rate on the day the money moved">
              {(f) => <Input {...f} className="tabular" inputMode="decimal" value={h.exchangeRate} onChange={(e) => setH({ ...h, exchangeRate: e.target.value })} disabled={!editable} />}
            </Field>
          )}
          <Field label={`Amount (${cur})`}>{(f) => <Input {...f} className="tabular" inputMode="decimal" value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} disabled={!editable} />}</Field>
          <Field label="Bank / cheque reference">{(f) => <Input {...f} value={h.bankReference} onChange={(e) => setH({ ...h, bankReference: e.target.value })} disabled={!editable} />}</Field>
          <Field label="Narration" className={cur !== 'INR' ? '' : 'lg:col-span-2'}>
            {(f) => <Input {...f} value={h.narration} onChange={(e) => setH({ ...h, narration: e.target.value })} disabled={!editable} />}
          </Field>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="self-start">
          <CardHeader
            title={editable ? 'Settle bills' : 'Bills settled'}
            description={editable ? `Open ${cur} bills of this ${direction === 'receipt' ? 'customer' : 'supplier'}; anything not allocated stays on account` : undefined}
            actions={
              editable && bills.data?.length ? (
                <Button size="sm" variant="secondary" onClick={suggest} disabled={!isMoney(h.amount)}>
                  <Wand2 className="size-3.5" /> Oldest due first
                </Button>
              ) : undefined
            }
          />
          {editable ? (
            !h.partyId ? (
              <p className="px-5 py-4 text-[13px] text-muted">Choose the {direction === 'receipt' ? 'customer' : 'supplier'} first.</p>
            ) : bills.data?.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-muted">No open {cur} bills. The whole amount will be held on account.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Bill</Th>
                    <Th>Due</Th>
                    <Th className="text-right">Open ({cur})</Th>
                    <Th className="w-40 text-right">Settle ({cur})</Th>
                  </tr>
                </thead>
                <tbody>
                  {bills.data?.map((b) => {
                    const over = Number(alloc[b.id] || 0) > Number(b.openAmount);
                    return (
                      <tr key={b.id}>
                        <Td className="font-mono text-[13px]">
                          {b.reference}
                          {b.sourceType === 'opening' && <Badge className="ml-2">Opening</Badge>}
                        </Td>
                        <Td className="text-[13px] whitespace-nowrap">{b.dueDate ? <span className={b.dueDate < today() ? 'text-danger' : ''}>{formatDate(b.dueDate)}</span> : '—'}</Td>
                        <Td className="tabular text-right text-[13px]">{formatAmount(b.openAmount, cur)}</Td>
                        <Td>
                          <Input className="tabular text-right" inputMode="decimal" aria-label={`Settle ${b.reference}`} aria-invalid={over || undefined} value={alloc[b.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [b.id]: e.target.value })} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )
          ) : (
            <Table>
              <tbody>
                {settlement!.allocations.map((a) => (
                  <tr key={a.billId}>
                    <Td className="font-mono text-[13px]">{a.reference ?? '—'}</Td>
                    <Td className="tabular text-right text-[13px]">{formatAmount(a.amount, cur)}</Td>
                  </tr>
                ))}
                {settlement!.allocations.length === 0 && (
                  <tr>
                    <Td className="text-[13px] text-muted">Nothing allocated; the whole amount went on account.</Td>
                  </tr>
                )}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="self-start" aria-live="polite">
          <CardHeader title="Totals" description={preview.isFetching ? 'Calculating…' : undefined} />
          <div className="space-y-1 px-5 py-3 text-[13px]">
            {editable && preview.error ? <p className="text-danger">{errorText(preview.error)}</p> : null}
            {p || !editable ? (
              <>
                <Row label="Amount" v={formatAmount(p?.amount ?? settlement!.amount, cur)} />
                <Row label="Allocated to bills" v={formatAmount(p?.allocated ?? settlement!.allocated ?? '0', cur)} />
                <Row label="Held on account" v={formatAmount(p?.unapplied ?? settlement?.advance?.originalAmount ?? '0', cur)} />
                {p && cur !== 'INR' && <Row label="Cash in ₹" v={formatMoney(p.cashInr)} />}
                {p && cur !== 'INR' && <Row label="Carrying value cleared" v={formatMoney(p.carryingInr)} />}
                {p && fx !== 0 && <Row label={fx < 0 ? 'Exchange gain' : 'Exchange loss'} v={formatMoney(String(Math.abs(fx)))} strong />}
              </>
            ) : (
              <p className="text-subtle">Enter the party, account and amount.</p>
            )}
          </div>
        </Card>
      </div>

      {settlement?.status === 'submitted' && <OnAccount settlement={settlement} />}
      {settlement?.vouchers && settlement.vouchers.length > 0 && ws.can('accounts.voucher.read') && (
        <p className="text-[12px] text-subtle">
          Vouchers:{' '}
          {settlement.vouchers.map((v) => (
            <Link key={v.id} href={`/app/accounts/journals/${v.id}`} className="mr-2 font-mono hover:text-accent">
              {v.number}
              {v.reversalOf ? ' (reversal)' : ''}
            </Link>
          ))}
        </p>
      )}
      {cancelling && settlement && <CancelDialog path={`/accounts/settlements/${settlement.id}/cancel`} title={`Cancel ${settlement.number}`} confirm={`Cancel ${settlement.direction}`} onClose={() => setCancelling(false)} />}
    </div>
  );
}

function Row({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t border-line pt-2 font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted'}>{label}</span>
      <span className="tabular">{v}</span>
    </div>
  );
}

/** Money held on account and its later allocations. */
function OnAccount({ settlement }: { settlement: Settlement }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const adv = settlement.advance;
  const side = sideOf(settlement.direction);
  const open = adv ? Number(adv.openAmount) : 0;
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const bills = useQuery({
    queryKey: ['open-bills', ws.entityId, settlement.partyId, side, settlement.currency],
    queryFn: () => api<BillBalance[]>(`/accounts/bills?partyId=${settlement.partyId}&side=${side}&currency=${settlement.currency}`, { scope: ws.scope }),
    enabled: open > 0,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const allocations = Object.entries(alloc)
    .filter(([, v]) => v.trim())
    .map(([billId, amount]) => ({ billId, amount: amount.trim() }));
  const apply = useMutation({
    mutationFn: () => api('/accounts/settlement-allocations', { method: 'POST', body: { settlementId: settlement.id, postingDate: date, reason, allocations }, scope: ws.scope }),
    onSuccess: () => {
      setAlloc({});
      setReason('');
      void qc.invalidateQueries();
    },
  });
  if (!adv && !settlement.laterAllocations?.length) return null;
  return (
    <Card>
      <CardHeader title="On account" description={adv ? `${formatAmount(adv.openAmount, settlement.currency)} still to apply` : undefined} />
      {open > 0 && ws.can('accounts.settlement.submit') && (
        <div className="space-y-3 px-5 py-4">
          {apply.error && <Alert tone="danger">{errorText(apply.error)}</Alert>}
          {bills.data?.length === 0 ? (
            <p className="text-[13px] text-muted">No open {settlement.currency} bills to apply it to yet.</p>
          ) : (
            <Table>
              <tbody>
                {bills.data?.map((b) => (
                  <tr key={b.id}>
                    <Td className="font-mono text-[13px]">{b.reference}</Td>
                    <Td className="tabular text-right text-[13px]">{formatAmount(b.openAmount, settlement.currency)} open</Td>
                    <Td className="w-40">
                      <Input className="tabular text-right" inputMode="decimal" aria-label={`Apply to ${b.reference}`} value={alloc[b.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [b.id]: e.target.value })} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Allocation date">{(f) => <Input {...f} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="Reason" className="min-w-64 flex-1">{(f) => <Input {...f} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            <Button onClick={() => apply.mutate()} loading={apply.isPending} disabled={!allocations.length || reason.trim().length < 3}>
              Apply on-account money
            </Button>
          </div>
        </div>
      )}
      {settlement.laterAllocations && settlement.laterAllocations.length > 0 && (
        <Table>
          <tbody>
            {settlement.laterAllocations.map((l) => (
              <tr key={l.id}>
                <Td className="font-mono text-[13px]">{l.number ?? 'Draft'}</Td>
                <Td className="text-[13px]">{formatDate(l.postingDate)}</Td>
                <Td className="text-[13px] text-muted">{l.reason}</Td>
                <Td className="tabular text-right text-[13px]">{formatAmount(l.allocations.reduce((s, a) => s + Number(a.amount), 0).toFixed(2), settlement.currency)}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
                </Td>
                <Td className="text-right">
                  {l.status === 'submitted' && ws.can('accounts.settlement.cancel') && (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(l.id)}>
                      Cancel
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {cancelling && <CancelDialog path={`/accounts/settlement-allocations/${cancelling}/cancel`} title="Cancel allocation" confirm="Cancel allocation" onClose={() => setCancelling(null)} />}
    </Card>
  );
}

function CancelDialog({ path, title, confirm, onClose }: { path: string; title: string; confirm: string; onClose: () => void }) {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api(path, { method: 'POST', body: { reason }, scope: ws.scope }),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  return (
    <FormDialog title={title} description="Posts exact reversals at today's date using the recorded values; the bills it settled reopen." onClose={onClose} onSubmit={() => m.mutate()} pending={m.isPending} error={m.error} submitLabel={confirm}>
      <Field label="Reason (recorded in the audit log)" error={fieldErrors(m.error).reason}>
        {(f) => <Input {...f} value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required autoFocus />}
      </Field>
    </FormDialog>
  );
}
