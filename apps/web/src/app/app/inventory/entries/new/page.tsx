'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { StockEntryForm } from '@/components/stock-entry-form';
import type { StockPurpose } from '@/lib/types';

const PURPOSES: StockPurpose[] = ['receipt', 'issue', 'transfer', 'adjustment', 'return', 'scrap'];

function NewEntry() {
  const p = useSearchParams().get('purpose') as StockPurpose | null;
  // Read once: after the first save the form rewrites the URL to the draft's address (dropping ?purpose).
  const [initial] = useState(() => (p && PURPOSES.includes(p) ? p : 'receipt'));
  const purpose = p && PURPOSES.includes(p) ? p : initial;
  // Remount when the user picks a different purpose (e.g. from ⌘K) so defaults recompute.
  return (
    <EntityGate>
      <StockEntryForm key={purpose} initialPurpose={purpose} />
    </EntityGate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NewEntry />
    </Suspense>
  );
}
