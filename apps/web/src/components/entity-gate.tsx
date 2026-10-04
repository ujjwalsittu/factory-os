'use client';
import { Button, Card, EmptyState } from '@factoryos/ui';
import { Building2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useWorkspace } from './workspace';

/** Inventory is kept per legal entity: entity-level screens ask for one when "All entities" is active. */
export function EntityGate({ children, what = 'inventory' }: { children: ReactNode; what?: string }) {
  const ws = useWorkspace();
  if (ws.entityId) return <>{children}</>;
  return (
    <Card>
      <EmptyState
        icon={<Building2 className="size-5" />}
        title="Choose a legal entity"
        description={`${what[0]!.toUpperCase()}${what.slice(1)} is kept separately for each legal entity. Pick one to continue.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {ws.tenantCtx.entities.map((e) => (
              <Button key={e.id} variant="secondary" onClick={() => ws.setEntityId(e.id)}>
                {e.shortName}
              </Button>
            ))}
          </div>
        }
      />
    </Card>
  );
}
