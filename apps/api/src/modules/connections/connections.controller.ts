import { randomUUID } from 'node:crypto';
import {
  type Database,
  emailDelivery,
  emailWorkerHeartbeat,
  gstRegistration,
  gstSandboxConnection,
  gstSandboxOperation,
  iotDevice,
  iotEdge,
  labelPrinter,
  printJob,
  supportAccessPolicy,
  tallyImport,
} from '@factoryos/db';
import { Controller, Get, Inject, Post } from '@nestjs/common';
import { and, desc, eq, gte, max, sql } from 'drizzle-orm';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { CONFIG, DB } from '../../common/tokens.js';
import type { AppConfig } from '../../config.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { StorageService } from '../storage/storage.service.js';

/** ok: working; attention: set up but something needs a look; off: switched off; setup: not set up yet. */
type Status = 'ok' | 'attention' | 'off' | 'setup';
export interface Connection {
  key: 'gst' | 'email' | 'storage' | 'devices' | 'printers' | 'support' | 'tally';
  title: string;
  status: Status;
  summary: string;
  lastActivityAt: string | null;
  href: string | null;
  /** Who changes it when it is not set up from this workspace. */
  setupBy: string | null;
}

/** A tap or edge silent for longer than this is "not reporting". */
const SILENT_MS = 15 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Decision 068, Settings → Connections: every external connection of this workspace and entity, read-only. */
@Controller('connections')
export class ConnectionsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('settings.integration.read')
  async list(@Ctx() ctx: TenantRequestContext): Promise<{ connections: Connection[] }> {
    const tenantId = ctx.tenant.tenantId;
    const entityId = entityOf(ctx);
    const connections = await Promise.all([
      this.gst(tenantId, entityId),
      this.email(tenantId),
      this.files(),
      this.devices(entityId),
      this.printers(entityId),
      this.support(tenantId),
      this.tally(entityId),
    ]);
    return { connections };
  }

  /** Writes, reads back and deletes a small file under this workspace, so a broken bucket shows before an upload fails. */
  @Post('storage/test')
  @RequirePermission('settings.integration.manage')
  async testStorage(@Ctx() ctx: TenantRequestContext) {
    const tenantId = ctx.tenant.tenantId;
    const entityId = entityOf(ctx);
    const key = `${tenantId}/${entityId}/connection-test-${randomUUID()}.txt`;
    const body = Buffer.from(`FactoryOS storage test ${new Date().toISOString()}`);
    let ok = false;
    let message: string;
    try {
      await this.storage.put(key, body, 'text/plain');
      const back = await this.storage.get(key);
      await this.storage.remove(key);
      ok = back.equals(body);
      message = ok ? 'A test file was written, read back and deleted.' : 'The file read back differs from the one written.';
    } catch (e) {
      message = e instanceof Error ? e.message : 'The storage test failed.';
    }
    await this.audit.record(ctx, { tenantId, entityId, action: 'settings.connections.storage_test', targetType: 'storage', targetId: null, after: { ok } });
    return { ok, message };
  }

  private async gst(tenantId: string, entityId: string): Promise<Connection> {
    const base = { key: 'gst' as const, title: 'GST e-invoice and e-way bill', href: '/app/settings/gst-integrations', setupBy: null };
    const regs = await this.db.select({ id: gstRegistration.id }).from(gstRegistration).where(and(eq(gstRegistration.tenantId, tenantId), eq(gstRegistration.entityId, entityId)));
    const conns = await this.db
      .select({ registrationId: gstSandboxConnection.registrationId, capability: gstSandboxConnection.capability })
      .from(gstSandboxConnection)
      .where(and(eq(gstSandboxConnection.tenantId, tenantId), eq(gstSandboxConnection.entityId, entityId)));
    const [last] = await this.db
      .select({ at: max(gstSandboxOperation.createdAt) })
      .from(gstSandboxOperation)
      .where(and(eq(gstSandboxOperation.tenantId, tenantId), eq(gstSandboxOperation.entityId, entityId)));
    if (!regs.length) return { ...base, status: 'setup', summary: 'Add a GST registration to this entity first.', lastActivityAt: null, href: '/app/settings/entities' };
    if (!conns.length) return { ...base, status: 'setup', summary: `No sandbox connection for ${plural(regs.length, 'registration')}. Live filing is not available yet.`, lastActivityAt: iso(last?.at) };
    const covered = new Set(conns.map((c) => c.registrationId)).size;
    const kinds = [...new Set(conns.map((c) => (c.capability === 'irn' ? 'e-invoice' : 'e-way bill')))].join(' and ');
    return {
      ...base,
      status: 'ok',
      summary: `Sandbox ${kinds} for ${covered} of ${plural(regs.length, 'registration')}. Live filing is not available yet.`,
      lastActivityAt: iso(last?.at),
    };
  }

  private async email(tenantId: string): Promise<Connection> {
    const base = { key: 'email' as const, title: 'E-mail', href: null, setupBy: 'The platform administrator, in the server settings' };
    if (this.config.email.mode === 'disabled') return { ...base, status: 'off', summary: 'E-mail is off on this server, so invitations and password resets are not sent.', lastActivityAt: null };
    const since = new Date(Date.now() - WEEK_MS);
    const [counts] = await this.db
      .select({
        accepted: sql<number>`count(*) filter (where ${emailDelivery.status} = 'accepted')::int`,
        failed: sql<number>`count(*) filter (where ${emailDelivery.status} in ('failed', 'unknown', 'expired'))::int`,
        last: sql<Date | null>`max(${emailDelivery.updatedAt}) filter (where ${emailDelivery.status} = 'accepted')`,
      })
      .from(emailDelivery)
      .where(and(eq(emailDelivery.tenantId, tenantId), gte(emailDelivery.createdAt, since)));
    const [worker] = await this.db.select({ at: emailWorkerHeartbeat.lastSeenAt }).from(emailWorkerHeartbeat).orderBy(desc(emailWorkerHeartbeat.lastSeenAt)).limit(1);
    const workerUp = !!worker && Date.now() - worker.at.getTime() < SILENT_MS;
    const parts = [`${plural(counts?.accepted ?? 0, 'e-mail')} sent in the last 7 days`];
    if (counts?.failed) parts.push(`${counts.failed} failed`);
    if (!workerUp) parts.push('the sending worker is not running');
    const last = counts?.last ? new Date(counts.last) : null;
    return { ...base, status: counts?.failed || !workerUp ? 'attention' : 'ok', summary: `${parts.join('; ')}.`, lastActivityAt: iso(last) };
  }

  private async files(): Promise<Connection> {
    const base = { key: 'storage' as const, title: 'File storage', href: null, setupBy: 'The platform administrator, on Platform → Storage', lastActivityAt: null };
    const s = await this.storage.state();
    if (s.kind === 'disabled') return { ...base, status: 'setup', summary: `Uploads are refused: ${s.reason}.` };
    return { ...base, status: 'ok', summary: s.kind === 's3' ? `Cloudflare R2 bucket ${s.bucket}.` : 'A local folder (development only).' };
  }

  private async devices(entityId: string): Promise<Connection> {
    const base = { key: 'devices' as const, title: 'Edge agents and machine taps', href: '/app/plant/devices', setupBy: null };
    const edges = await this.db.select({ lastSeenAt: iotEdge.lastSeenAt }).from(iotEdge).where(and(eq(iotEdge.entityId, entityId), eq(iotEdge.status, 'active')));
    const taps = await this.db.select({ lastSeenAt: iotDevice.lastSeenAt }).from(iotDevice).where(and(eq(iotDevice.entityId, entityId), eq(iotDevice.status, 'active')));
    if (!edges.length) return { ...base, status: 'setup', summary: 'No edge agent yet. Add one to connect machine taps and label printers.', lastActivityAt: null };
    const silent = (d: { lastSeenAt: Date | null }) => !d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > SILENT_MS;
    const quietEdges = edges.filter(silent).length;
    const quietTaps = taps.filter(silent).length;
    const seen = [...edges, ...taps].map((d) => d.lastSeenAt?.getTime() ?? 0);
    const latest = Math.max(0, ...seen);
    const parts = [`${plural(edges.length, 'edge agent')}, ${plural(taps.length, 'tap')}`];
    if (quietEdges) parts.push(`${plural(quietEdges, 'edge agent')} not reporting`);
    if (quietTaps) parts.push(`${plural(quietTaps, 'tap')} not reporting`);
    return { ...base, status: quietEdges || quietTaps ? 'attention' : 'ok', summary: `${parts.join('; ')}.`, lastActivityAt: latest ? new Date(latest).toISOString() : null };
  }

  private async printers(entityId: string): Promise<Connection> {
    const base = { key: 'printers' as const, title: 'Label printers', href: '/app/plant/devices', setupBy: null };
    const printers = await this.db.select({ id: labelPrinter.id }).from(labelPrinter).where(and(eq(labelPrinter.entityId, entityId), eq(labelPrinter.status, 'active')));
    if (!printers.length) return { ...base, status: 'setup', summary: 'No label printer yet.', lastActivityAt: null };
    const since = new Date(Date.now() - WEEK_MS);
    const [jobs] = await this.db
      .select({
        printed: sql<number>`count(*) filter (where ${printJob.status} = 'printed')::int`,
        failed: sql<number>`count(*) filter (where ${printJob.status} = 'failed')::int`,
        last: max(printJob.printedAt),
      })
      .from(printJob)
      .where(and(eq(printJob.entityId, entityId), gte(printJob.createdAt, since)));
    const parts = [`${plural(printers.length, 'printer')}; ${plural(jobs?.printed ?? 0, 'label')} printed in the last 7 days`];
    if (jobs?.failed) parts.push(`${jobs.failed} failed`);
    return { ...base, status: jobs?.failed ? 'attention' : 'ok', summary: `${parts.join('; ')}.`, lastActivityAt: iso(jobs?.last) };
  }

  private async support(tenantId: string): Promise<Connection> {
    const base = { key: 'support' as const, title: 'Support access', href: '/app/settings/support-access', lastActivityAt: null };
    if (!this.config.supportAccess.enabled) return { ...base, status: 'off', summary: 'Support access is switched off on this server.', setupBy: 'The platform administrator, in the server settings' };
    const [policy] = await this.db.select({ enabled: supportAccessPolicy.enabled, updatedAt: supportAccessPolicy.updatedAt }).from(supportAccessPolicy).where(eq(supportAccessPolicy.tenantId, tenantId));
    return policy?.enabled
      ? { ...base, status: 'ok', summary: 'On: an operator may ask for temporary read-only access, which you approve.', setupBy: null, lastActivityAt: iso(policy.updatedAt) }
      : { ...base, status: 'off', summary: 'Off for this workspace.', setupBy: null };
  }

  private async tally(entityId: string): Promise<Connection> {
    const base = { key: 'tally' as const, title: 'Tally', href: '/app/accounts/tally', setupBy: null };
    const [last] = await this.db
      .select({ status: tallyImport.status, createdAt: tallyImport.createdAt, committedAt: tallyImport.committedAt })
      .from(tallyImport)
      .where(eq(tallyImport.entityId, entityId))
      .orderBy(desc(tallyImport.createdAt))
      .limit(1);
    if (!last) return { ...base, status: 'setup', summary: 'Nothing imported yet. Upload Tally XML exports to bring in masters, openings and history.', lastActivityAt: null };
    const summary =
      last.status === 'read' ? 'An import is waiting for review.' : last.status === 'committed' ? 'Last import committed. Upload newer exports to re-sync.' : 'The last import was discarded.';
    return { ...base, status: last.status === 'read' ? 'attention' : 'ok', summary, lastActivityAt: iso(last.committedAt ?? last.createdAt) };
  }
}
