'use client';
import { Alert, Card, Input, Table, Td, Th } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  AllocationInput,
  BillBalance,
  SettlementChoices,
  SettlementPreview,
} from '@/lib/settlements';
import { useWorkspace } from './workspace';
export function useSettlementChoices() {
  const ws = useWorkspace();
  return useQuery({
    queryKey: ['settlement-choices', ws.tenantId, ws.entityId],
    queryFn: () =>
      api<SettlementChoices>('/accounts/settlements/choices', {
        scope: ws.scope,
      }),
    retry: false,
  });
}
export function useOpenBills(
  partyId: string,
  side: string,
  currency: string,
  enabled = true,
) {
  const ws = useWorkspace();
  return useQuery({
    queryKey: [
      'settlement-bills',
      ws.tenantId,
      ws.entityId,
      partyId,
      side,
      currency,
    ],
    queryFn: () =>
      api<BillBalance[]>(
        `/accounts/bills?${new URLSearchParams({ partyId, side, currency })}`,
        { scope: ws.scope },
      ),
    enabled: enabled && !!partyId && /^[A-Z]{3}$/.test(currency),
    retry: false,
  });
}
export function AllocationPicker({
  bills,
  allocations,
  onChange,
  disabled = false,
}: {
  bills: BillBalance[];
  allocations: AllocationInput[];
  onChange: (value: AllocationInput[]) => void;
  disabled?: boolean;
}) {
  const open = bills.filter(
    (b) => !b.openAmount.startsWith('-') && b.openAmount !== '0.000000',
  );
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>Bill</Th>
            <Th>Due</Th>
            <Th>Open amount</Th>
            <Th>INR carrying value</Th>
            <Th>Allocate</Th>
          </tr>
        </thead>
        <tbody>
          {open.map((b) => (
            <tr key={b.id}>
              <Td>
                <div className="font-medium">{b.reference}</div>
                <div className="text-xs text-muted">{b.currency}</div>
              </Td>
              <Td>{b.dueDate ?? 'Unclassified'}</Td>
              <Td className="font-mono">{b.openAmount}</Td>
              <Td className="font-mono">{b.carryingInr}</Td>
              <Td>
                <Input
                  aria-label={`Allocate ${b.reference}`}
                  inputMode="decimal"
                  disabled={disabled}
                  value={
                    allocations.find((a) => a.billId === b.id)?.amount ?? ''
                  }
                  onChange={(e) =>
                    onChange([
                      ...allocations.filter((a) => a.billId !== b.id),
                      ...(e.target.value
                        ? [{ billId: b.id, amount: e.target.value }]
                        : []),
                    ])
                  }
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {!open.length && (
        <p className="p-4 text-sm text-muted">
          No open bills for this party and currency. Leave money on account to
          allocate it later.
        </p>
      )}
    </Card>
  );
}
export function PreviewSummary({
  preview,
  prefix = 'settlement',
}: {
  preview: SettlementPreview;
  prefix?: string;
}) {
  return (
    <Card className="p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ['Allocated', preview.allocated],
          ['Unapplied', preview.unapplied],
          ['Cash / bank INR', preview.cashInr],
          ['Bill carrying INR', preview.carryingInr],
          ['FX expense / (gain) INR', preview.forexInr],
          ['Rounding INR', preview.roundingInr],
        ].map(([label, value]) => (
          <div
            key={label}
            data-testid={
              label!.startsWith('FX') ? `${prefix}-forex` : undefined
            }
          >
            <p className="text-xs text-muted">{label}</p>
            <p className="font-mono text-sm">{value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
export function AccountingInactive() {
  return (
    <Alert>
      Accounting inactive. Activate accounting before recording settlements.
    </Alert>
  );
}
export function downloadExact(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
