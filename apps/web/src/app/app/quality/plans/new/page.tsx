'use client';
import { EntityGate } from '@/components/entity-gate';
import { PlanEditor } from '@/components/plan-editor';

export default function NewPlanPage() {
  return (
    <EntityGate what="quality">
      <PlanEditor plan={null} />
    </EntityGate>
  );
}
