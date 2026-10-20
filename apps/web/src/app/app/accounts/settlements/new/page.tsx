'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AccountingPage } from '@/components/accounting-shared';
import { SettlementForm } from '@/components/settlement-form';
import type { Direction } from '@/lib/settlements';

function New() {
  const params = useSearchParams();
  // Read once: saving rewrites the URL to the draft's address.
  const [direction] = useState<Direction>(() => (params.get('direction') === 'payment' ? 'payment' : 'receipt'));
  // A hand-off (decision 068) names the party, e.g. "Record receipt" on an overdue invoice.
  const [partyId] = useState(() => (/^[0-9a-f-]{36}$/i.test(params.get('party') ?? '') ? params.get('party')! : undefined));
  return (
    <AccountingPage title="Receipts & payments" permission="accounts.settlement.create">
      <SettlementForm initialDirection={direction} initialPartyId={partyId} />
    </AccountingPage>
  );
}

export default function Page() {
  return (
    <Suspense>
      <New />
    </Suspense>
  );
}
