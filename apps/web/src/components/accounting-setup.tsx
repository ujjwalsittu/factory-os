'use client';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney, formatDateTime } from '@/lib/format';
import {
  emptyLine,
  type AccountingSettings,
  type Worksheet,
  type Reconciliation,
  type JournalLine,
  type OpeningBill,
  type Settlement,
  type ReceiptBaseline,
} from '@/lib/accounting';
import {
  AccountingPage,
  JournalLines,
  useAccounts,
  useAccountingParties,
} from './accounting-shared';
import { useWorkspace } from './workspace';
import { FormDialog } from './form-dialog';
export default function Setup() {
  return (
    <AccountingPage title="Accounting setup" permission="accounts.setup.read">
      <Content />
    </AccountingPage>
  );
}
function Content() {
  const ws = useWorkspace(),
    qc = useQueryClient(),
    accounts = useAccounts(),
    parties = useAccountingParties();
  const settings = useQuery({
    queryKey: ['accounting-settings', ws.tenantId, ws.entityId],
    queryFn: () =>
      api<AccountingSettings>('/accounts/settings', { scope: ws.scope }),
  });
  const worksheet = useQuery({
    queryKey: ['accounting-opening', ws.tenantId, ws.entityId],
    queryFn: () =>
      api<Worksheet | null>('/accounts/opening', { scope: ws.scope }),
  });
  const [lines, setLines] = useState<JournalLine[]>([]),
    [bills, setBills] = useState<OpeningBill[]>([]),
    [settlements, setSettlements] = useState<Settlement[]>([]),
    [baselines, setBaselines] = useState<ReceiptBaseline[]>([]),
    [loaded, setLoaded] = useState(false),
    [preview, setPreview] = useState<Reconciliation | null>(null),
    [confirm, setConfirm] = useState(false),
    [dirty, setDirty] = useState(true),
    [invoiceChoices, setInvoiceChoices] = useState<Reconciliation['invoices']>(
      [],
    ),
    [mappings, setMappings] = useState<Record<string, string>>({});
  useEffect(() => {
    if (worksheet.isSuccess && !loaded) {
      setLines(worksheet.data?.lines ?? []);
      setBills(worksheet.data?.bills ?? []);
      setSettlements(worksheet.data?.settlements ?? []);
      setBaselines(worksheet.data?.receiptBaselines ?? []);
      setLoaded(true);
      setDirty(!worksheet.data);
    }
  }, [worksheet.data, worksheet.isSuccess, loaded]);
  useEffect(() => {
    if (settings.data) setMappings(settings.data.mappings);
  }, [settings.data]);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['accounting-settings'] });
    void qc.invalidateQueries({ queryKey: ['accounting-opening'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api('/accounts/opening', {
        method: 'PUT',
        body: { lines, bills, settlements, receiptBaselines: baselines },
        scope: ws.scope,
      }),
    onSuccess: () => {
      setPreview(null);
      setDirty(false);
      invalidate();
    },
  });
  const review = useMutation({
    mutationFn: () =>
      api<Reconciliation>('/accounts/opening/reconciliation', {
        scope: ws.scope,
      }),
    onSuccess: (p) => {
      setPreview(p);
      setInvoiceChoices(p.invoices);
    },
  });
  const activate = useMutation({
    mutationFn: () =>
      api('/accounts/opening/activate', {
        method: 'POST',
        body: {
          worksheetId: preview!.worksheetId,
          reviewedToken: preview!.snapshotToken,
        },
        scope: ws.scope,
      }),
    onSuccess: () => {
      setConfirm(false);
      invalidate();
    },
  });
  const mapSave = useMutation({
    mutationFn: () =>
      api('/accounts/settings', {
        method: 'PUT',
        body: { mappings },
        scope: ws.scope,
      }),
    onSuccess: invalidate,
  });
  const active = settings.data?.active,
    canEdit = ws.can('accounts.setup.create') && !active,
    errors = [
      settings.error,
      worksheet.error,
      save.error,
      review.error,
      activate.error,
      mapSave.error,
    ].filter(Boolean);
  const edited = () => {
    setPreview(null);
    setDirty(true);
  };
  return (
    <div className="space-y-5">
      {errors.map((e, i) => (
        <Alert tone="danger" key={i}>
          {e!.message}
        </Alert>
      ))}
      <Card>
        <CardHeader
          title={active ? 'Accounting active' : 'Controlled cut-over'}
          description={
            active
              ? `Activated ${formatDateTime(settings.data!.activatedAt!)}. Historical documents are not replayed.`
              : 'Reconcile current stock, unbilled receipts and unpaid bills with the prior books. Activation cannot be undone.'
          }
        />
        <div className="p-5">
          <p className="text-sm text-muted">
            Opening balances represent the instant before activation today.
            Existing bills may have been settled outside FactoryOS: declare
            those settlements before activating.
          </p>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Posting accounts"
          description="Each role uses a distinct ledger of the required classification. Changes affect future postings."
        />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(mappings).map(([role, id]) => (
            <Field key={role} label={role.replaceAll('_', ' ')}>
              {(p) => (
                <Select
                  {...p}
                  value={id}
                  disabled={
                    !ws.can('accounts.setup.update') || mapSave.isPending
                  }
                  onChange={(e) => {
                    setMappings({ ...mappings, [role]: e.target.value });
                    edited();
                  }}
                >
                  {accounts.data
                    ?.filter((a) => a.isActive)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          ))}
        </div>
        {ws.can('accounts.setup.update') && (
          <div className="px-5 pb-5">
            <Button
              variant="secondary"
              loading={mapSave.isPending}
              onClick={() => mapSave.mutate()}
            >
              Save posting accounts
            </Button>
          </div>
        )}
      </Card>
      {!active && (
        <>
          <fieldset disabled={save.isPending} className="contents">
            <Card>
              <CardHeader
                title="Opening trial balance"
                description="Debit and credit must match exactly. Trade controls also require party and bill references."
              />
              <JournalLines
                lines={lines}
                disabled={!canEdit || save.isPending}
                onChange={(l) => {
                  setLines(l);
                  edited();
                }}
              />
              {canEdit && (
                <div className="p-4">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setLines([...lines, emptyLine()]);
                      edited();
                    }}
                  >
                    Add opening line
                  </Button>
                </div>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Outstanding bills"
                description="Link existing invoices once, or enter references from the prior books. Outstanding amounts are in INR; retain original currency and rate for foreign bills."
              />
              <div className="p-4 space-y-3">
                {bills.map((b, i) => (
                  <div className="grid gap-2 sm:grid-cols-5" key={i}>
                    <Select
                      aria-label={`Bill party ${i + 1}`}
                      disabled={!canEdit}
                      value={b.partyId}
                      onChange={(e) => {
                        setBills(
                          bills.map((r, n) =>
                            n === i ? { ...r, partyId: e.target.value } : r,
                          ),
                        );
                        edited();
                      }}
                    >
                      <option value="">Party</option>
                      {parties.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label={`Outstanding reference ${i + 1}`}
                      disabled={!canEdit}
                      value={b.reference}
                      onChange={(e) => {
                        setBills(
                          bills.map((r, n) =>
                            n === i ? { ...r, reference: e.target.value } : r,
                          ),
                        );
                        edited();
                      }}
                    />
                    <Select
                      aria-label={`Bill side ${i + 1}`}
                      disabled={!canEdit}
                      value={b.side}
                      onChange={(e) => {
                        setBills(
                          bills.map((r, n) =>
                            n === i
                              ? {
                                  ...r,
                                  side: e.target.value as 'debit' | 'credit',
                                }
                              : r,
                          ),
                        );
                        edited();
                      }}
                    >
                      <option value="debit">Receivable</option>
                      <option value="credit">Payable</option>
                    </Select>
                    <Input
                      aria-label={`Outstanding amount ${i + 1}`}
                      disabled={!canEdit}
                      value={b.amount}
                      onChange={(e) => {
                        setBills(
                          bills.map((r, n) =>
                            n === i ? { ...r, amount: e.target.value } : r,
                          ),
                        );
                        edited();
                      }}
                    />
                    <div className="grid gap-2 sm:col-span-4 sm:grid-cols-3">
                      <Input
                        aria-label={`Bill currency ${i + 1}`}
                        disabled={!canEdit || !!b.invoiceId}
                        placeholder="Currency (INR)"
                        value={b.currency ?? 'INR'}
                        onChange={(e) => {
                          setBills(
                            bills.map((r, n) =>
                              n === i
                                ? {
                                    ...r,
                                    currency: e.target.value.toUpperCase(),
                                  }
                                : r,
                            ),
                          );
                          edited();
                        }}
                      />
                      <Input
                        aria-label={`Bill exchange rate ${i + 1}`}
                        disabled={!canEdit || !!b.invoiceId}
                        placeholder="INR exchange rate"
                        value={b.exchangeRate ?? '1'}
                        onChange={(e) => {
                          setBills(
                            bills.map((r, n) =>
                              n === i
                                ? { ...r, exchangeRate: e.target.value }
                                : r,
                            ),
                          );
                          edited();
                        }}
                      />
                      <Input
                        aria-label={`Bill original amount ${i + 1}`}
                        disabled={!canEdit || !!b.invoiceId}
                        placeholder="Original currency amount"
                        value={b.originalAmount ?? ''}
                        onChange={(e) => {
                          setBills(
                            bills.map((r, n) =>
                              n === i
                                ? {
                                    ...r,
                                    originalAmount: e.target.value || undefined,
                                  }
                                : r,
                            ),
                          );
                          edited();
                        }}
                      />
                    </div>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setBills(bills.filter((_, n) => n !== i));
                          edited();
                        }}
                      >
                        Remove bill
                      </Button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setBills([
                        ...bills,
                        {
                          partyId: '',
                          reference: '',
                          side: 'debit',
                          amount: '0',
                        },
                      ]);
                      edited();
                    }}
                  >
                    Add external bill
                  </Button>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Settlements in prior books"
                description="Declare INR amounts already settled outside FactoryOS, with a reason."
              />
              <div className="p-4 space-y-3">
                {settlements.map((s, i) => (
                  <div className="grid gap-2 sm:grid-cols-4" key={i}>
                    <Select
                      aria-label={`Settled invoice ${i + 1}`}
                      disabled={!canEdit}
                      value={s.invoiceId}
                      onChange={(e) => {
                        setSettlements(
                          settlements.map((r, n) =>
                            n === i ? { ...r, invoiceId: e.target.value } : r,
                          ),
                        );
                        edited();
                      }}
                    >
                      <option value="">Invoice</option>
                      {invoiceChoices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.number}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label={`Settled amount ${i + 1}`}
                      disabled={!canEdit}
                      value={s.amount}
                      onChange={(e) => {
                        setSettlements(
                          settlements.map((r, n) =>
                            n === i ? { ...r, amount: e.target.value } : r,
                          ),
                        );
                        edited();
                      }}
                    />
                    <Input
                      aria-label={`Settlement reason ${i + 1}`}
                      disabled={!canEdit}
                      value={s.reason}
                      onChange={(e) => {
                        setSettlements(
                          settlements.map((r, n) =>
                            n === i ? { ...r, reason: e.target.value } : r,
                          ),
                        );
                        edited();
                      }}
                    />
                    {canEdit && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setSettlements(settlements.filter((_, n) => n !== i));
                          edited();
                        }}
                      >
                        Remove settlement
                      </Button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSettlements([
                        ...settlements,
                        { invoiceId: '', amount: '0', reason: '' },
                      ]);
                      edited();
                    }}
                  >
                    Add prior settlement
                  </Button>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Unbilled receipt baseline"
                description="Keep the original PO receipt quantity and cost available for later invoice matching, even if goods have been consumed."
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Receipt line</Th>
                    <Th>Unbilled quantity</Th>
                    <Th>Base cost</Th>
                  </tr>
                </thead>
                <tbody>
                  {baselines.map((b) => (
                    <tr key={b.receiptLineId}>
                      <Td className="font-mono text-xs">{b.receiptLineId}</Td>
                      <Td>{b.qty}</Td>
                      <Td>{formatMoney(b.baseCost)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <div className="flex flex-wrap gap-3">
              {canEdit && (
                <Button
                  loading={save.isPending}
                  disabled={!loaded}
                  onClick={() => save.mutate()}
                >
                  Save opening worksheet
                </Button>
              )}
              <Button
                variant="secondary"
                loading={review.isPending}
                disabled={dirty || !loaded || save.isPending}
                onClick={() => review.mutate()}
              >
                Review reconciliation
              </Button>
            </div>
            {preview && (
              <Card>
                <CardHeader
                  title={
                    preview.differences.length
                      ? 'Opening differences'
                      : 'Ready to activate'
                  }
                  description={`Cut-over today: ${preview.cutoverDate}. Stock ${formatMoney(preview.inventoryValue)}; unbilled receipts ${formatMoney(preview.grniValue)}.`}
                />
                <Table>
                  <thead>
                    <tr>
                      <Th>Control</Th>
                      <Th>Expected</Th>
                      <Th>Declared</Th>
                      <Th>Difference</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.differences.map((d, i) => (
                      <tr key={i}>
                        <Td>{d.control}</Td>
                        <Td>{formatMoney(d.expected)}</Td>
                        <Td>{formatMoney(d.declared)}</Td>
                        <Td>{d.difference}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div className="flex flex-wrap gap-3 p-4">
                  {canEdit && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setBaselines(preview.receiptBaselines);
                          edited();
                        }}
                      >
                        Use receipt baselines
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setBills(
                            preview.invoices.map((v) => ({
                              partyId: v.partyId,
                              reference: v.number,
                              side: v.side,
                              amount: v.remaining ?? v.amount,
                              invoiceId: v.id,
                              currency: v.currency,
                              exchangeRate: v.exchangeRate,
                              originalAmount: v.originalAmount,
                            })),
                          );
                          edited();
                        }}
                      >
                        Use outstanding invoices
                      </Button>
                    </>
                  )}
                  {ws.can('accounts.setup.approve') &&
                    !preview.differences.length &&
                    preview.worksheetId && (
                      <Button onClick={() => setConfirm(true)}>
                        Activate accounting
                      </Button>
                    )}
                </div>
              </Card>
            )}
          </fieldset>
        </>
      )}
      {confirm && (
        <FormDialog
          title="Activate accounting"
          description="Opening books and the cut-over boundary become permanent. Existing submitted documents will not be replayed or directly cancelled. Proceed only after reconciling the prior books."
          submitLabel="Confirm cut-over"
          onClose={() => setConfirm(false)}
          onSubmit={() => activate.mutate()}
          pending={activate.isPending}
          error={activate.error}
        >
          <p className="text-sm">
            Review completed for {preview?.cutoverDate}. Activation rechecks the
            snapshot to reject intervening changes.
          </p>
        </FormDialog>
      )}
    </div>
  );
}
