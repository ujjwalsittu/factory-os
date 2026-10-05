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
  return (
    <AccountingPage title="Receipts & payments" permission="accounts.settlement.create">
      <SettlementForm initialDirection={direction} />
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
