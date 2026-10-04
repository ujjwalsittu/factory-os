'use client';
import { EntityGate } from '@/components/entity-gate';
import { LandedCostForm } from '@/components/landed-cost-form';

export default function Page() {
  return (
    <EntityGate what="buying">
      <LandedCostForm />
    </EntityGate>
  );
}
