'use client';
import { PageHeader } from '@factoryos/ui';
import { Connections } from '@/components/connections';
import { EntityGate } from '@/components/entity-gate';

export default function Page() {
  return (
    <>
      <PageHeader title="Connections" description="Everything this workspace talks to outside FactoryOS, whether it is working, and where to set it up." />
      <EntityGate what="connections">
        <Connections />
      </EntityGate>
    </>
  );
}
