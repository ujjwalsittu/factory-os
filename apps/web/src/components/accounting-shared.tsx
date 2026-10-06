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
          ['journals', 'Journals', 'accounts.voucher.read'],
          ['bank-charges', 'Bank charges', 'accounts.bank_charge.read'],
          ['settlements', 'Receipts & payments', 'accounts.settlement.read'],
          ['outstanding', 'Outstanding', 'accounts.report.read'],
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
}: {
  lines: JournalLine[];
  onChange: (lines: JournalLine[]) => void;
  disabled?: boolean;
}) {
  const accounts = useAccounts(),
    parties = useAccountingParties();
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
                  onChange={(e) => update(i, { accountId: e.target.value })}
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
                      update(i, { partyId: e.target.value || undefined })
                    }
                  >
                    <option value="">No party</option>
                    {parties.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={`Bill reference ${i + 1}`}
                    value={l.billReference ?? ''}
                    placeholder="Bill / on-account reference"
                    disabled={disabled}
                    onChange={(e) =>
                      update(i, { billReference: e.target.value || undefined })
                    }
                  />
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
