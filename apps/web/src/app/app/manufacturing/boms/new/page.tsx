'use client';
import { BomEditor } from '@/components/bom-editor';
import { EntityGate } from '@/components/entity-gate';

export default function NewBomPage() {
  return (
    <EntityGate what="manufacturing">
      <BomEditor bom={null} />
    </EntityGate>
  );
}
