'use client';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Table,
  Td,
  Th,
  buttonClass,
  Select,
} from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatDate, formatMoney, today } from '@/lib/format';
import {
  emptyLine,
  sourceHref,
  type Journal,
  type JournalLine,
} from '@/lib/accounting';
import { AccountingPage, JournalLines, useAccounts } from './accounting-shared';
import { useWorkspace } from './workspace';
import { FormDialog } from './form-dialog';
export default function Journals() {
  return (
    <AccountingPage title="Journals" permission="accounts.voucher.read">
      <List />
    </AccountingPage>
  );
}
function List() {
  const ws = useWorkspace(),
    q = useQuery({
      queryKey: ['accounting-journals', ws.tenantId, ws.entityId],
      queryFn: () => api<Journal[]>('/accounts/journals', { scope: ws.scope }),
    });
  return (
    <>
      <div className="mb-4 flex justify-end">
        {ws.can('accounts.voucher.create') && (
          <Link className={buttonClass()} href="/app/accounts/journals/new">
            New journal
          </Link>
        )}
      </div>
      <Card>
        {q.error && <Alert tone="danger">{q.error.message}</Alert>}
        {q.isLoading && <p className="p-4">Loading vouchers…</p>}
        <Table>
          <thead>
            <tr>
              <Th>Voucher</Th>
              <Th>Date</Th>
              <Th>Source</Th>
              <Th>Narration</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((v) => (
              <tr key={v.id}>
                <Td>
                  <Link
                    className="text-accent"
                    href={`/app/accounts/journals/${v.id}`}
                  >
                    {v.number ?? 'Draft journal'}
                  </Link>
                </Td>
                <Td>{formatDate(v.postingDate)}</Td>
                <Td>{v.sourceType.replaceAll('_', ' ')}</Td>
                <Td>{v.narration}</Td>
                <Td>
                  <Badge>{v.status}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data?.length === 0 && (
          <p className="p-5 text-sm text-muted">
            No vouchers yet. Configure and activate accounting to start the
            books.
          </p>
        )}
      </Card>
    </>
  );
}
export function JournalEditor({ id }: { id?: string }) {
  return (
    <AccountingPage
      title={id ? 'Accounting voucher' : 'New journal'}
      permission={id ? 'accounts.voucher.read' : 'accounts.voucher.create'}
    >
      <Suspense fallback={<p>Loading voucher…</p>}>
        <Load id={id} />
      </Suspense>
    </AccountingPage>
  );
}
function Load({ id }: { id?: string }) {
  const ws = useWorkspace(),
    q = useQuery({
      queryKey: ['accounting-journal', ws.tenantId, ws.entityId, id],
      queryFn: () =>
        api<Journal>(`/accounts/journals/${id}`, { scope: ws.scope }),
      enabled: !!id,
    });
  if (id && q.isLoading) return <p>Loading voucher…</p>;
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  return (
    <Form
      key={`${ws.entityId}:${id ?? 'new'}:${q.data?.status ?? 'draft'}`}
      doc={q.data}
    />
  );
}
function Form({ doc }: { doc?: Journal }) {
  const ws = useWorkspace(),
    router = useRouter(),
    qc = useQueryClient(),
    accounts = useAccounts(),
    formRef = useRef<HTMLFormElement>(null);
  const editable =
      (!doc || doc.status === 'draft') && (!doc || doc.sourceType === 'manual'),
    canEdit = editable && ws.can('accounts.voucher.create');
  const [date, setDate] = useState(doc?.postingDate ?? today()),
    [narration, setNarration] = useState(doc?.narration ?? ''),
    [lines, setLines] = useState<JournalLine[]>(
      doc?.draftLines.length ? doc.draftLines : [emptyLine(), emptyLine()],
    ),
    [reason, setReason] = useState(''),
    [cancelling, setCancelling] = useState(false),
    [clearingSourceId, setClearing] = useState(doc?.clearingSourceId ?? '');
  const [previewBody, setPreviewBody] = useState('');
  const liveBody = JSON.stringify({ lines });
  useEffect(() => {
    const timer = setTimeout(() => setPreviewBody(liveBody), 400);
    return () => clearTimeout(timer);
  }, [liveBody]);
  const preview = useQuery({
    queryKey: ['accounting-preview', ws.tenantId, ws.entityId, previewBody],
    queryFn: () =>
      api<{ debit: string; credit: string; difference: string }>(
        '/accounts/journals/preview',
        { method: 'POST', body: JSON.parse(previewBody), scope: ws.scope },
      ),
    enabled:
      canEdit &&
      !!previewBody &&
      JSON.parse(previewBody).lines.every((l: JournalLine) => l.accountId),
    retry: false,
  });
  const clearing = useQuery({
    queryKey: ['accounting-clearing-choices', ws.entityId],
    queryFn: () =>
      api<{ id: string; number: string; status: string }[]>('/landed-costs', {
        scope: ws.scope,
      }),
    enabled: canEdit && ws.can('buying.landed_cost.read'),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['accounting-journal'] });
    void qc.invalidateQueries({ queryKey: ['accounting-journals'] });
    void qc.invalidateQueries({ queryKey: ['accounting-report'] });
  };
  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      let id = doc?.id;
      if (canEdit) {
        const result = await api<Journal>(
          id ? `/accounts/journals/${id}` : '/accounts/journals',
          {
            method: id ? 'PUT' : 'POST',
            body: {
              postingDate: date,
              narration,
              lines,
              ...(clearingSourceId && { clearingSourceId }),
            },
            scope: ws.scope,
          },
        );
        id = result.id;
      }
      if (!id) throw new Error('Save the draft first');
      if (submit)
        await api(`/accounts/journals/${id}/submit`, {
          method: 'POST',
          scope: ws.scope,
        });
      return id;
    },
    onSuccess: (id) => {
      refresh();
      router.replace(`/app/accounts/journals/${id}`);
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      api(`/accounts/journals/${doc!.id}/cancel`, {
        method: 'POST',
        body: { reason },
        scope: ws.scope,
      }),
    onSuccess: () => {
      setCancelling(false);
      refresh();
    },
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'Enter' || e.key.toLowerCase() === 'a') &&
        canEdit &&
        !save.isPending
      ) {
        e.preventDefault();
        save.mutate(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canEdit, save]);
  const displayed = doc?.entries?.length
      ? doc.entries
      : (doc?.draftLines ?? []),
    source = doc ? sourceHref(doc) : null;
  return (
    <div className="space-y-5">
      {save.error && <Alert tone="danger">{save.error.message}</Alert>}
      {doc && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{doc.status}</Badge>
          <span className="font-mono">{doc.number ?? 'Unnumbered draft'}</span>
          {source && (
            <Link className="text-accent" href={source}>
              View source document
            </Link>
          )}
          {doc.reversalOf && (
            <Link
              className="text-accent"
              href={`/app/accounts/journals/${doc.reversalOf}`}
            >
              View original
            </Link>
          )}
          {doc.reversal && (
            <Link
              className="text-accent"
              href={`/app/accounts/journals/${doc.reversal.id}`}
            >
              View reversal · {doc.reversal.number}
            </Link>
          )}
        </div>
      )}
      {editable ? (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(false);
          }}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.ctrlKey &&
              !e.metaKey &&
              e.target instanceof HTMLInputElement
            ) {
              e.preventDefault();
              const controls = Array.from(
                formRef.current?.querySelectorAll<
                  HTMLInputElement | HTMLSelectElement
                >('input:not(:disabled),select:not(:disabled)') ?? [],
              );
              controls[controls.indexOf(e.target) + 1]?.focus();
            }
          }}
        >
          <fieldset disabled={!canEdit || save.isPending}>
            <Card>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Posting date">
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Narration">
                  {(p) => (
                    <Input
                      {...p}
                      value={narration}
                      onChange={(e) => setNarration(e.target.value)}
                      required
                    />
                  )}
                </Field>
                <Field
                  label="Clearing source"
                  hint="Link a cost voucher when clearing its accrued charges; cancel this journal before cancelling that voucher."
                >
                  {(p) => (
                    <Select
                      {...p}
                      value={clearingSourceId}
                      onChange={(e) => setClearing(e.target.value)}
                    >
                      <option value="">No clearing source</option>
                      {clearing.data
                        ?.filter(
                          (v) =>
                            v.status === 'submitted' ||
                            v.id === clearingSourceId,
                        )
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.number}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
              </div>
              <JournalLines
                lines={lines}
                onChange={setLines}
                disabled={!canEdit || save.isPending}
              />
              {canEdit && (
                <div className="p-4">
                  <Button
                    variant="secondary"
                    onClick={() => setLines([...lines, emptyLine()])}
                  >
                    Add journal line
                  </Button>
                </div>
              )}
            </Card>
          </fieldset>
          <p className="mt-3 text-sm text-muted">
            {preview.data &&
              `Debit ${preview.data.debit} / Credit ${preview.data.credit} / Difference ${preview.data.difference}. `}
            Save validates exact Dr/Cr totals on the server. Inventory and GRNI
            corrections must use operational documents. Ctrl+Enter / Ctrl+A
            saves.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {canEdit && (
              <Button type="submit" loading={save.isPending}>
                Save draft
              </Button>
            )}
            {ws.can('accounts.voucher.submit') && doc && (
              <Button
                disabled={save.isPending}
                onClick={() => save.mutate(true)}
              >
                Submit journal
              </Button>
            )}
          </div>
        </form>
      ) : (
        <Card>
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted">Posting date</p>
              {formatDate(doc!.postingDate)}
            </div>
            <div>
              <p className="text-xs text-muted">Narration</p>
              {doc!.narration}
            </div>
            <div>
              <p className="text-xs text-muted">Source currency / INR rate</p>
              {doc!.currency} / {doc!.exchangeRate}
            </div>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Ledger</Th>
                <Th>Debit</Th>
                <Th>Credit</Th>
                <Th>Bill reference</Th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((l, i) => (
                <tr key={i}>
                  <Td>
                    {accounts.data?.find((a) => a.id === l.accountId)?.name ??
                      l.accountId}
                  </Td>
                  <Td>{formatMoney(l.debit)}</Td>
                  <Td>{formatMoney(l.credit)}</Td>
                  <Td>{l.billReference ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {doc?.sourceType === 'manual' &&
        doc.status === 'submitted' &&
        ws.can('accounts.voucher.cancel') && (
          <Button variant="secondary" onClick={() => setCancelling(true)}>
            Cancel journal
          </Button>
        )}
      {cancelling && (
        <FormDialog
          title="Cancel journal"
          description="The original entries remain in the books. A current-date voucher reverses their exact accounts and amounts."
          submitLabel="Confirm cancellation"
          onClose={() => setCancelling(false)}
          onSubmit={() => cancel.mutate()}
          pending={cancel.isPending}
          error={cancel.error}
        >
          <Field label="Cancellation reason">
            {(p) => (
              <Input
                {...p}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={5}
              />
            )}
          </Field>
        </FormDialog>
      )}
    </div>
  );
}
