'use client';
import {
  Alert,
  Input,
  Select,
  Table,
  Td,
  Th,
  Button,
  PageHeader,
} from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Account, JournalLine } from '@/lib/accounting';
import type { Party } from '@/lib/types';
import { EntityGate } from './entity-gate';
import { useOpenBills } from './settlement-shared';
import { useWorkspace } from './workspace';
export function AccountingPage({
  title,
  permission,
  children,
}: {
  title: string;
  permission: string;
  children: ReactNode;
}) {
  const ws = useWorkspace(),
    router = useRouter();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F7' && ws.can('accounts.voucher.create')) {
        e.preventDefault();
        router.push('/app/accounts/journals/new');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router, ws]);
  return (
    <>
      <PageHeader
        title={title}
        description="Separate books for each legal entity. INR ledgers retain six decimal places; document totals keep their original precision."
      />
      <div className="mb-5 flex flex-wrap gap-3 print:hidden">
        {[
          ['setup', 'Accounting setup', 'accounts.setup.read'],
          ['chart', 'Chart of accounts', 'accounts.account.read'],
          ['settlements', 'Receipts & payments', 'accounts.settlement.read'],
          ['outstanding', 'Outstanding & ageing', 'accounts.report.read'],
          ['journals', 'Journals', 'accounts.voucher.read'],
          ['day-book', 'Day book', 'accounts.report.read'],
          ['ledger', 'Account ledger', 'accounts.report.read'],
          ['trial-balance', 'Trial balance', 'accounts.report.read'],
        ].map(
          ([path, label, p]) =>
            ws.can(p!) && (
              <Link
                className="text-sm text-accent hover:underline"
                key={path}
                href={`/app/accounts/${path}`}
              >
                {label}
              </Link>
            ),
        )}
      </div>
      <EntityGate what="accounting">
        {ws.can(permission) ? (
          <div key={ws.entityId}>{children}</div>
        ) : (
          <Alert tone="danger">
            You do not have permission to view this accounting screen.
          </Alert>
        )}
      </EntityGate>
    </>
  );
}
export function useAccounts() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['accounts', ws.tenantId, ws.entityId],
    queryFn: () => api<Account[]>('/accounts/accounts', { scope: ws.scope }),
    retry: false,
  });
}
export function useAccountingParties() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['accounting-parties', ws.tenantId, ws.entityId],
    queryFn: () => api<Party[]>('/parties', { scope: ws.scope }),
    enabled: ws.can('masters.party.read'),
    retry: false,
  });
}
export function JournalLines({
  lines,
  onChange,
  disabled = false,
  tradeChoices = false,
}: {
  tradeChoices?: boolean;
  lines: JournalLine[];
  onChange: (lines: JournalLine[]) => void;
  disabled?: boolean;
}) {
  const accounts = useAccounts(),
    parties = useAccountingParties(),
    ws = useWorkspace();
  const controls = useQuery({
    queryKey: ['bill-controls', ws.tenantId, ws.entityId],
    queryFn: () =>
      api<{ accountId: string; side: 'receivable' | 'payable' }[]>(
        '/accounts/bill-controls',
        { scope: ws.scope },
      ),
    enabled: tradeChoices,
    retry: false,
  });
  const update = (index: number, patch: Partial<JournalLine>) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  return (
    <>
      {accounts.error && <Alert tone="danger">{accounts.error.message}</Alert>}
      <Table>
        <thead>
          <tr>
            <Th>Ledger</Th>
            <Th>Debit</Th>
            <Th>Credit</Th>
            <Th>Party / bill</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <Td>
                <Select
                  aria-label={`Account ${i + 1}`}
                  value={l.accountId}
                  disabled={disabled || accounts.isLoading}
                  onChange={(e) =>
                    update(i, {
                      accountId: e.target.value,
                      ...(tradeChoices && {
                        tradeReference: undefined,
                        billReference: undefined,
                      }),
                    })
                  }
                >
                  <option value="">Choose ledger</option>
                  {accounts.data
                    ?.filter((a) => a.isActive || a.id === l.accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                </Select>
              </Td>
              <Td>
                <Input
                  aria-label={`Debit ${i + 1}`}
                  value={l.debit}
                  inputMode="decimal"
                  disabled={disabled}
                  onChange={(e) => update(i, { debit: e.target.value })}
                />
              </Td>
              <Td>
                <Input
                  aria-label={`Credit ${i + 1}`}
                  value={l.credit}
                  inputMode="decimal"
                  disabled={disabled}
                  onChange={(e) => update(i, { credit: e.target.value })}
                />
              </Td>
              <Td>
                <div className="grid gap-2">
                  <Select
                    aria-label={`Party ${i + 1}`}
                    value={l.partyId ?? ''}
                    disabled={disabled}
                    onChange={(e) =>
                      update(i, {
                        partyId: e.target.value || undefined,
                        ...(tradeChoices && {
                          tradeReference: undefined,
                          billReference: undefined,
                        }),
                      })
                    }
                  >
                    <option value="">No party</option>
                    {parties.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  {tradeChoices &&
                  controls.data?.some((c) => c.accountId === l.accountId) ? (
                    <TradeJournalReference
                      index={i}
                      line={l}
                      side={
                        controls.data.find((c) => c.accountId === l.accountId)!
                          .side
                      }
                      disabled={disabled}
                      onChange={(patch) => update(i, patch)}
                    />
                  ) : (
                    <Input
                      aria-label={`Bill reference ${i + 1}`}
                      value={l.billReference ?? ''}
                      placeholder="Bill / on-account reference"
                      disabled={disabled}
                      onChange={(e) =>
                        update(i, {
                          billReference: e.target.value || undefined,
                        })
                      }
                    />
                  )}
                </div>
              </Td>
              <Td>
                {!disabled && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove line ${i + 1}`}
                    onClick={() => onChange(lines.filter((_, n) => n !== i))}
                  >
                    Remove
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function TradeJournalReference({
  index,
  line,
  side,
  disabled,
  onChange,
}: {
  index: number;
  line: JournalLine;
  side: 'receivable' | 'payable';
  disabled: boolean;
  onChange: (patch: Partial<JournalLine>) => void;
}) {
  const bills = useOpenBills(line.partyId ?? '', side, 'INR', !disabled),
    mode = line.tradeReference?.mode ?? '';
  return (
    <>
      <Select
        aria-label={`Bill treatment ${index + 1}`}
        disabled={disabled}
        value={mode}
        onChange={(e) => {
          const mode = e.target.value as 'against' | 'new' | 'on_account';
          onChange({
            tradeReference: mode
              ? { mode, ...(mode === 'new' && { reference: '' }) }
              : undefined,
            billReference: mode === 'on_account' ? 'On account' : undefined,
          });
        }}
      >
        <option value="">Choose bill treatment</option>
        <option value="against">Against existing INR bill</option>
        <option value="new">New INR reference</option>
        <option value="on_account">On account</option>
      </Select>
      {mode === 'against' ? (
        disabled ? (
          <Input
            aria-label={`Against bill ${index + 1}`}
            value={line.billReference ?? ''}
            disabled
          />
        ) : (
          <Select
            aria-label={`Against bill ${index + 1}`}
            value={line.tradeReference?.billId ?? ''}
            disabled={disabled || bills.isFetching}
            onChange={(e) => {
              const bill = bills.data?.find((b) => b.id === e.target.value);
              onChange({
                tradeReference: {
                  mode: 'against',
                  billId: e.target.value || undefined,
                },
                billReference: bill?.reference,
              });
            }}
          >
            <option value="">Choose matching bill</option>
            {bills.data
              ?.filter(
                (b) =>
                  b.accountId === line.accountId &&
                  !b.openAmount.startsWith('-'),
              )
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.reference} · INR {b.openAmount}
                </option>
              ))}
          </Select>
        )
      ) : (
        <Input
          aria-label={`Bill reference ${index + 1}`}
          value={line.billReference ?? ''}
          disabled={disabled || !mode}
          placeholder="New / on-account reference"
          onChange={(e) =>
            onChange({
              billReference: e.target.value,
              tradeReference: {
                mode: mode as 'new' | 'on_account',
                ...(mode === 'new' && { reference: e.target.value }),
              },
            })
          }
        />
      )}
      {bills.error && <Alert tone="danger">{bills.error.message}</Alert>}
    </>
  );
}
