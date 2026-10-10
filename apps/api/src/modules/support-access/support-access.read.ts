// Audited support access (decision 050): one locked read. Under the grant's control transaction: current authority,
// then the data from the separate READ ONLY pool, then the required support event and two-identity tenant audit,
// then a fresh check on the database clock. Data leaves only after that transaction commits.
import { SUPPORT_READ_CATALOG, type SupportArea, type SupportPanelResult, type SupportQuery, type SupportWorkspaceContext } from '@factoryos/auth';
import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { readAccounting } from '../readers/accounting-reports.read.js';
import { readInventory } from '../readers/inventory.read.js';
import { readDocument } from '../readers/work-orders.read.js';
import { SupportReadPoolService } from './support-access.read-pool.js';
import { CommitThenThrow, SupportAccessStore, SupportError } from './support-access.store.js';
import type { SupportScope, SupportTx } from './support-access.types.js';

function effectiveAreas(areas: SupportArea[], scope: SupportScope): SupportArea[] {
  return areas.filter((a) => scope.permissions.has(SUPPORT_READ_CATALOG[a]));
}

@Injectable()
export class SupportReadService {
  constructor(
    private readonly store: SupportAccessStore,
    private readonly pool: SupportReadPoolService,
    private readonly audit: AuditService,
  ) {}

  async context(actor: RequestContext, grantId: string): Promise<SupportWorkspaceContext> {
    return this.store.withAuthority<SupportWorkspaceContext>(actor, grantId, async (tx, authority, budget) => {
      const areas = effectiveAreas(authority.grant.areas, authority.scope);
      await this.evidence(tx, actor, authority.grant.id, authority.grant.tenantId, authority.grant.entityId, authority.scope, null, 'context');
      await budget();
      return this.store.context(tx, actor, authority.grant, areas);
    });
  }

  async panel(actor: RequestContext, grantId: string, query: SupportQuery): Promise<SupportPanelResult> {
    return this.store.withAuthority<SupportPanelResult>(actor, grantId, async (tx, authority, budget) => {
      if (!effectiveAreas(authority.grant.areas, authority.scope).includes(query.area)) {
        // A known, own grant asking outside its scope: keep the denial as evidence, return nothing.
        await this.store.appendEvent(tx, actor, authority.grant.id, authority.grant.tenantId, authority.scope, { kind: 'denied', area: query.area, reasonCode: 'outside-scope', operatorUserId: actor.user.id });
        return new CommitThenThrow(new SupportError('SUPPORT_UNAVAILABLE', 'outside-scope'));
      }
      const data = await this.pool.run((db) => {
        switch (query.area) {
          case 'inventory':
            return readInventory(db, authority.scope, query);
          case 'accounting':
            return readAccounting(db, authority.scope, query);
          case 'sales-invoices':
          case 'purchase-invoices':
          case 'work-orders':
            return readDocument(db, authority.scope, query);
        }
      });
      await budget();
      await this.evidence(tx, actor, authority.grant.id, authority.grant.tenantId, authority.grant.entityId, authority.scope, query.area, query.panel);
      return data;
    });
  }

  /** Required evidence: one support event and one tenant audit row with both identities, in the control transaction. */
  private async evidence(tx: SupportTx, actor: RequestContext, grantId: string, tenantId: string, entityId: string, scope: SupportScope, area: SupportArea | null, panel: string) {
    await this.store.appendEvent(tx, actor, grantId, tenantId, scope, { kind: 'read', area, reasonCode: panel, operatorUserId: actor.user.id });
    await this.audit.recordSupport(actor, { action: 'support_access.read', targetType: 'support_access_grant', targetId: grantId, tenantId, entityId, after: { area, panel } }, scope.subjectUserId, tx);
  }
}
