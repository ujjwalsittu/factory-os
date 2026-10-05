'use client';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { today } from '@/lib/format';
import type {
  AllocationDocument,
  SettlementDocument,
  SettlementInput,
  SettlementPreview,
} from '@/lib/settlements';
import { AccountingPage } from './accounting-shared';
import { FormDialog } from './form-dialog';
import {
  AccountingInactive,
  AllocationPicker,
  downloadExact,
  PreviewSummary,
  useOpenBills,
  useSettlementChoices,
} from './settlement-shared';
import { SettlementAllocationForm } from './settlement-allocation-form';
import { useWorkspace } from './workspace';
const empty = (): SettlementInput => ({
  direction: 'receipt',
  partyId: '',
  postingDate: today(),
  currency: 'INR',
  exchangeRate: '1',
  accountId: '',
  amount: '',
  bankReference: '',
  narration: '',
  allocations: [],
});
export function SettlementEditor({ id }: { id?: string }) {
  return (
    <AccountingPage
      title={id ? 'Receipt / payment' : 'New receipt / payment'}
      permission={
        id ? 'accounts.settlement.read' : 'accounts.settlement.create'
      }
    >
      <Form id={id} />
    </AccountingPage>
  );
}
function Form({ id }: { id?: string }) {
  const ws = useWorkspace(),
    router = useRouter(),
    qc = useQueryClient(),
    choices = useSettlementChoices();
  const [draft, setDraft] = useState<SettlementInput>(empty),
    [savedBody, setSavedBody] = useState(''),
    [preview, setPreview] = useState<SettlementPreview | null>(null),
    [message, setMessage] = useState('');
  const [allocating, setAllocating] = useState<{
      existing?: AllocationDocument;
    } | null>(null),
    [cancelTarget, setCancelTarget] = useState<{
      type: 'settlement' | 'allocation';
      id: string;
    } | null>(null),
    [reason, setReason] = useState('');
  const live = useRef(true),
    inputBody = useRef(''),
    loaded = useRef(''),
    previewAttempt = useRef('');
  inputBody.current = JSON.stringify(draft);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const q = useQuery({
    queryKey: ['settlement', ws.tenantId, ws.entityId, id],
    queryFn: () =>
      api<SettlementDocument>(`/accounts/settlements/${id}`, {
        scope: ws.scope,
      }),
    enabled: !!id,
    retry: false,
  });
  useEffect(() => {
    if (
      q.data &&
      (loaded.current !== q.data.id ||
        q.data.status !== 'draft' ||
        inputBody.current === savedBody)
    ) {
      loaded.current = q.data.id;
      setDraft(q.data.draft);
      setSavedBody(JSON.stringify(q.data.draft));
      setPreview(null);
    }
  }, [q.data]);
  const doc = q.data,
    editable = !id || doc?.status === 'draft',
    canEdit =
      editable &&
      ws.can(id ? 'accounts.settlement.update' : 'accounts.settlement.create');
  const dirty = JSON.stringify(draft) !== savedBody;
  const bills = useOpenBills(
    draft.partyId,
    draft.direction === 'receipt' ? 'receivable' : 'payable',
    draft.currency,
    editable,
  );
  const refresh = () => {
    void qc.invalidateQueries({
      queryKey: ['settlement', ws.tenantId, ws.entityId, id],
    });
    void qc.invalidateQueries({
      queryKey: ['settlements', ws.tenantId, ws.entityId],
    });
    void qc.invalidateQueries({
      queryKey: ['settlement-bills', ws.tenantId, ws.entityId],
    });
  };
  const save = useMutation({
    mutationFn: (value: SettlementInput) =>
      api<SettlementDocument>(
        id ? `/accounts/settlements/${id}` : '/accounts/settlements',
        { method: id ? 'PUT' : 'POST', body: value, scope: ws.scope },
      ),
    onSuccess: (d, value) => {
      if (!live.current) return;
      setSavedBody(JSON.stringify(value));
      if (!id) router.replace(`/app/accounts/settlements/${d.id}`);
      else refresh();
    },
  });
  const submit = useMutation({
    mutationFn: () =>
      api(`/accounts/settlements/${id}/submit`, {
        method: 'POST',
        body: {},
        scope: ws.scope,
      }),
    onSuccess: () => {
      if (live.current) refresh();
    },
    onError: () => {
      void qc.invalidateQueries({
        queryKey: ['settlement-bills', ws.tenantId, ws.entityId],
      });
    },
  });
  const posting = useMutation({
    mutationFn: (value: SettlementInput) =>
      api<SettlementPreview>('/accounts/settlements/preview', {
        method: 'POST',
        body: value,
        scope: ws.scope,
      }),
    onSuccess: (result, value) => {
      if (live.current && JSON.stringify(value) === inputBody.current)
        setPreview(result);
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      api(
        `/accounts/${cancelTarget?.type === 'allocation' ? 'settlement-allocations' : 'settlements'}/${cancelTarget?.id}/cancel`,
        { method: 'POST', body: { reason }, scope: ws.scope },
      ),
    onSuccess: () => {
      if (!live.current) return;
      setMessage(
        cancelTarget?.type === 'allocation'
          ? 'Allocation cancelled'
          : 'Settlement cancelled',
      );
      setCancelTarget(null);
      setReason('');
      refresh();
    },
  });
  const canPreview =
    editable &&
    [
      'accounts.settlement.create',
      'accounts.settlement.update',
      'accounts.settlement.submit',
    ].some((p) => ws.can(p));
  useEffect(() => {
    if (
      id &&
      canPreview &&
      savedBody &&
      savedBody === inputBody.current &&
      previewAttempt.current !== savedBody
    ) {
      previewAttempt.current = savedBody;
      posting.mutate(JSON.parse(savedBody) as SettlementInput);
    }
  }, [id, canPreview, savedBody]);
  const busy = save.isPending || submit.isPending || cancel.isPending;
  const change = (patch: Partial<SettlementInput>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setPreview(null);
    posting.reset();
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canEdit && !busy) {
        e.preventDefault();
        save.mutate(draft);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [draft, canEdit, busy, save]);
  if (id && q.isLoading) return <p>Loading settlement…</p>;
  if (q.error || choices.error)
    return (
      <Alert tone="danger">{q.error?.message ?? choices.error?.message}</Alert>
    );
  if (choices.data && !choices.data.active) return <AccountingInactive />;
  const failure = save.error ?? submit.error ?? posting.error;
  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{doc?.number ?? 'Draft'}</span>
          <Badge>
            {doc?.status === 'submitted'
              ? 'Submitted'
              : doc?.status === 'cancelled'
                ? 'Cancelled'
                : 'Draft'}
          </Badge>
          {dirty && canEdit && (
            <span className="text-xs text-muted">Unsaved changes</span>
          )}
        </div>
        <Link className="text-sm text-accent" href="/app/accounts/settlements">
          All receipts & payments
        </Link>
      </div>
      {failure && <Alert tone="danger">{failure.message}</Alert>}
      {message && <Alert>{message}</Alert>}
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Direction">
            {(p) => (
              <Select
                {...p}
                disabled={!canEdit || busy}
                value={draft.direction}
                onChange={(e) =>
                  change({
                    direction: e.target.value as SettlementInput['direction'],
                    partyId: '',
                    allocations: [],
                  })
                }
              >
                <option value="receipt">Customer receipt</option>
                <option value="payment">Supplier payment</option>
              </Select>
            )}
          </Field>
          <Field label="Party">
            {(p) => (
              <Select
                {...p}
                disabled={!canEdit || busy}
                value={draft.partyId}
                onChange={(e) =>
                  change({ partyId: e.target.value, allocations: [] })
                }
              >
                <option value="">Choose party</option>
                {choices.data?.parties
                  .filter(
                    (p) =>
                      (p.isActive || p.id === draft.partyId) &&
                      (draft.direction === 'receipt'
                        ? p.isCustomer
                        : p.isSupplier),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                {doc &&
                  !choices.data?.parties.some(
                    (p) => p.id === draft.partyId,
                  ) && <option value={draft.partyId}>{doc.partyName}</option>}
              </Select>
            )}
          </Field>
          <Field label="Posting date">
            {(p) => (
              <Input
                {...p}
                type="date"
                disabled={!canEdit || busy}
                value={draft.postingDate}
                onChange={(e) => change({ postingDate: e.target.value })}
              />
            )}
          </Field>
          <Field label="Currency">
            {(p) => (
              <Input
                {...p}
                disabled={!canEdit || busy}
                value={draft.currency}
                maxLength={3}
                onChange={(e) =>
                  change({
                    currency: e.target.value.toUpperCase(),
                    exchangeRate:
                      e.target.value.toUpperCase() === 'INR'
                        ? '1'
                        : draft.exchangeRate,
                    allocations: [],
                  })
                }
              />
            )}
          </Field>
          <Field
            label="Exchange rate"
            hint="INR per unit of settlement currency"
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                disabled={!canEdit || busy || draft.currency === 'INR'}
                value={draft.exchangeRate}
                onChange={(e) => change({ exchangeRate: e.target.value })}
              />
            )}
          </Field>
          <Field label="Cash / bank">
            {(p) => (
              <Select
                {...p}
                disabled={!canEdit || busy}
                value={draft.accountId}
                onChange={(e) => change({ accountId: e.target.value })}
              >
                <option value="">Choose cash or bank ledger</option>
                {choices.data?.accounts
                  .filter((a) => a.isActive || a.id === draft.accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                {doc &&
                  !choices.data?.accounts.some(
                    (a) => a.id === draft.accountId,
                  ) && (
                    <option value={draft.accountId}>{doc.accountName}</option>
                  )}
              </Select>
            )}
          </Field>
          <Field
            label="Amount"
            hint="Gross cash/bank movement; deductions are recorded separately."
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                disabled={!canEdit || busy}
                value={draft.amount}
                onChange={(e) => change({ amount: e.target.value })}
              />
            )}
          </Field>
          <Field label="Bank reference">
            {(p) => (
              <Input
                {...p}
                disabled={!canEdit || busy}
                value={draft.bankReference}
                onChange={(e) => change({ bankReference: e.target.value })}
              />
            )}
          </Field>
          <Field label="Narration">
            {(p) => (
              <Input
                {...p}
                disabled={!canEdit || busy}
                value={draft.narration}
                onChange={(e) => change({ narration: e.target.value })}
              />
            )}
          </Field>
        </div>
      </Card>
      {editable && (
        <>
          <h2 className="text-sm font-semibold">Allocate against bills</h2>
          {bills.error && <Alert tone="danger">{bills.error.message}</Alert>}
          {bills.isFetching && (
            <p className="text-sm text-muted">Loading current bill balances…</p>
          )}
          <AllocationPicker
            bills={bills.data ?? []}
            allocations={draft.allocations}
            onChange={(allocations) => change({ allocations })}
            disabled={!canEdit || busy}
          />
          <p className="text-xs text-muted">
            Unallocated money stays on account. Review the server preview before
            submitting.
          </p>
        </>
      )}
      {(preview ?? doc?.postedPreview) && (
        <PreviewSummary preview={(preview ?? doc?.postedPreview)!} />
      )}
      <div className="flex flex-wrap gap-3 print:hidden">
        {canPreview && (
          <Button
            variant="secondary"
            loading={posting.isPending}
            disabled={busy}
            onClick={() => posting.mutate(draft)}
          >
            Preview posting
          </Button>
        )}
        {canEdit && (
          <>
            <Button
              loading={save.isPending}
              disabled={busy}
              onClick={() => save.mutate(draft)}
            >
              Save draft
            </Button>
          </>
        )}
        {id &&
          doc?.status === 'draft' &&
          ws.can('accounts.settlement.submit') && (
            <Button
              loading={submit.isPending}
              disabled={busy || dirty || !preview}
              onClick={() => submit.mutate()}
            >
              Submit settlement
            </Button>
          )}
        {doc?.status === 'submitted' &&
          ws.can('accounts.settlement.cancel') && (
            <Button
              variant="secondary"
              onClick={() => {
                cancel.reset();
                setCancelTarget({ type: 'settlement', id: doc.id });
              }}
            >
              Cancel settlement
            </Button>
          )}
        {doc && ws.can('accounts.settlement.export') && (
          <Button
            variant="secondary"
            onClick={() =>
              void api(`/accounts/settlements/${doc.id}/export`, {
                scope: ws.scope,
              })
                .then((value) =>
                  downloadExact(
                    value,
                    `settlement-${doc.number ?? doc.id}.json`,
                  ),
                )
                .catch((error) => setMessage(error.message))
            }
          >
            Export settlement
          </Button>
        )}
        {doc && (
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
        )}
        {doc?.voucherId && ws.can('accounts.voucher.read') && (
          <Link
            className="text-sm text-accent self-center"
            href={`/app/accounts/journals/${doc.voucherId}`}
          >
            Posted / reversal voucher
          </Link>
        )}
      </div>
      {canEdit && (
        <p className="text-xs text-muted print:hidden">
          Ctrl+Enter saves. Save changed drafts before submission.
        </p>
      )}
      {doc && doc.status !== 'draft' && (
        <>
          <Card className="p-4">
            <p className="text-sm">
              Available on account:{' '}
              <span className="font-mono">
                {draft.currency} {doc.available?.amount ?? '0.000000'}
              </span>
            </p>
            <p className="text-xs text-muted">
              Recorded allocations remain visible after reversal.
            </p>
          </Card>
          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Bill / evidence</Th>
                  <Th>Currency amount</Th>
                  <Th>Bill INR cleared</Th>
                  <Th>Source INR used</Th>
                  <Th>Effect</Th>
                </tr>
              </thead>
              <tbody>
                {doc.allocationEffects?.map((a) => (
                  <tr key={a.id}>
                    <Td>{a.billReference ?? a.billId}</Td>
                    <Td className="font-mono">{a.amount}</Td>
                    <Td className="font-mono">{a.carryingInr}</Td>
                    <Td className="font-mono">{a.sourceCarryingInr}</Td>
                    <Td>{a.reversalOf ? 'Reversal' : 'Allocation'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
      {doc?.status === 'submitted' &&
        doc.available?.amount &&
        doc.available.amount !== '0.000000' &&
        ws.can('accounts.settlement.create') &&
        !allocating && (
          <Button onClick={() => setAllocating({})}>
            Allocate on-account money
          </Button>
        )}
      {doc && allocating && (
        <SettlementAllocationForm
          settlement={doc}
          existing={allocating.existing}
          onClose={() => setAllocating(null)}
          onDone={() => {
            setMessage('Allocation submitted');
            setAllocating(null);
            refresh();
          }}
        />
      )}
      {doc?.allocationDocuments?.map((a) => (
        <Card key={a.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {a.number ?? 'Draft allocation'} · {a.status}
              </p>
              <p className="text-sm text-muted">
                {a.draft.postingDate} · {a.draft.reason}
              </p>
            </div>
            <div className="flex gap-3 print:hidden">
              {a.status === 'draft' && ws.can('accounts.settlement.submit') && (
                <Button
                  variant="secondary"
                  onClick={() => setAllocating({ existing: a })}
                >
                  Review allocation
                </Button>
              )}
              {a.status === 'submitted' &&
                ws.can('accounts.settlement.cancel') && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      cancel.reset();
                      setCancelTarget({ type: 'allocation', id: a.id });
                    }}
                  >
                    Reverse allocation
                  </Button>
                )}
              {a.voucherId && ws.can('accounts.voucher.read') && (
                <Link
                  className="text-accent text-sm"
                  href={`/app/accounts/journals/${a.voucherId}`}
                >
                  Voucher
                </Link>
              )}
            </div>
          </div>
        </Card>
      ))}
      {cancelTarget && (
        <FormDialog
          title="Cancel with exact reversal"
          onClose={() => {
            if (!cancel.isPending) setCancelTarget(null);
          }}
          onSubmit={() => cancel.mutate()}
          pending={cancel.isPending}
          error={cancel.error}
          submitLabel="Confirm cancellation"
        >
          <Field label="Cancellation reason">
            {(p) => (
              <Input
                {...p}
                value={reason}
                disabled={cancel.isPending}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </FormDialog>
      )}
    </div>
  );
}
