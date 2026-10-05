'use client';
import { Alert, Button, Card, Field, Input } from '@factoryos/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { today } from '@/lib/format';
import type {
  AllocationDocument,
  LaterAllocationInput,
  SettlementDocument,
  SettlementPreview,
} from '@/lib/settlements';
import {
  AllocationPicker,
  PreviewSummary,
  useOpenBills,
} from './settlement-shared';
import { useWorkspace } from './workspace';
export function SettlementAllocationForm({
  settlement,
  existing,
  onClose,
  onDone,
}: {
  settlement: SettlementDocument;
  existing?: AllocationDocument;
  onClose: () => void;
  onDone: () => void;
}) {
  const ws = useWorkspace(),
    [input, setInput] = useState<LaterAllocationInput>(
      existing?.draft ?? {
        settlementId: settlement.id,
        postingDate: today(),
        reason: '',
        allocations: [],
      },
    ),
    [saved, setSaved] = useState<AllocationDocument | null>(existing ?? null),
    [preview, setPreview] = useState<SettlementPreview | null>(null);
  const live = useRef(true),
    body = useRef('');
  body.current = JSON.stringify(input);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const bills = useOpenBills(
    settlement.draft.partyId,
    settlement.draft.direction === 'receipt' ? 'receivable' : 'payable',
    settlement.draft.currency,
  );
  const calculation = useMutation({
    mutationFn: (value: LaterAllocationInput) =>
      api<SettlementPreview>('/accounts/settlement-allocations/preview', {
        method: 'POST',
        body: value,
        scope: ws.scope,
      }),
    onSuccess: (p, value) => {
      if (live.current && JSON.stringify(value) === body.current) setPreview(p);
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api<AllocationDocument>('/accounts/settlement-allocations', {
        method: 'POST',
        body: input,
        scope: ws.scope,
      }),
    onSuccess: (d) => {
      if (live.current) setSaved(d);
    },
  });
  const submit = useMutation({
    mutationFn: () =>
      api(`/accounts/settlement-allocations/${saved?.id}/submit`, {
        method: 'POST',
        body: {},
        scope: ws.scope,
      }),
    onSuccess: () => {
      if (live.current) onDone();
    },
  });
  const busy = save.isPending || submit.isPending,
    locked = !!saved || busy || !ws.can('accounts.settlement.create');
  const change = (patch: Partial<LaterAllocationInput>) => {
    setInput((i) => ({ ...i, ...patch }));
    setPreview(null);
    calculation.reset();
  };
  const error = calculation.error ?? save.error ?? submit.error ?? bills.error;
  return (
    <Card className="p-5 space-y-4 print:hidden">
      <h2 className="font-semibold">Allocate on-account money</h2>
      {error && <Alert tone="danger">{error.message}</Alert>}
      <p className="text-sm text-muted">
        {settlement.draft.currency} {settlement.available?.amount} available.
        The bank movement will not be posted again.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Allocation date">
          {(p) => (
            <Input
              {...p}
              type="date"
              disabled={locked}
              value={input.postingDate}
              onChange={(e) => change({ postingDate: e.target.value })}
            />
          )}
        </Field>
        <Field label="Allocation reason">
          {(p) => (
            <Input
              {...p}
              disabled={locked}
              value={input.reason}
              onChange={(e) => change({ reason: e.target.value })}
            />
          )}
        </Field>
      </div>
      <AllocationPicker
        bills={bills.data ?? []}
        allocations={input.allocations}
        onChange={(allocations) => change({ allocations })}
        disabled={locked}
      />
      {preview && <PreviewSummary preview={preview} prefix="allocation" />}
      <div className="flex flex-wrap gap-3">
        {ws.can('accounts.settlement.create') && (
          <Button
            variant="secondary"
            loading={calculation.isPending}
            disabled={busy}
            onClick={() => calculation.mutate(input)}
          >
            Preview allocation
          </Button>
        )}
        {!saved && ws.can('accounts.settlement.create') && (
          <Button
            loading={save.isPending}
            disabled={busy}
            onClick={() => save.mutate()}
          >
            Save allocation
          </Button>
        )}
        {saved && ws.can('accounts.settlement.submit') && (
          <Button
            loading={submit.isPending}
            disabled={busy}
            onClick={() => submit.mutate()}
          >
            Submit allocation
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Close allocation
        </Button>
      </div>
      {saved && (
        <p className="text-xs text-muted">
          Saved allocation drafts are read-only. Close and create another draft
          to change the selection.
        </p>
      )}
    </Card>
  );
}
