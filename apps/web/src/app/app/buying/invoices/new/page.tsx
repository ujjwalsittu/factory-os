'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { PurchaseInvoiceForm } from '@/components/purchase-invoice-form';

function NewInvoice() {
  const params = useSearchParams();
  // Read once: saving rewrites the URL to the draft's address (dropping ?po).
  const [po] = useState(() => params.get('po') ?? undefined);
  return (
    <EntityGate>
      <PurchaseInvoiceForm fromPoId={po} />
    </EntityGate>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NewInvoice />
    </Suspense>
  );
}
