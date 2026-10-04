'use client';
import { EntityGate } from '@/components/entity-gate';
import { PurchaseOrderForm } from '@/components/purchase-order-form';

export default function Page() {
  return (
    <EntityGate>
      <PurchaseOrderForm />
    </EntityGate>
  );
}
