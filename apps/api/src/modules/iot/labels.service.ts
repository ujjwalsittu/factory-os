// Decision 065: label print jobs. FactoryOS renders ZPL for a plant printer and queues it; the plant's edge agent
// claims its printers' jobs with a lease, sends them over TCP and reports the result.
import { type LabelSize } from '@factoryos/core';
import { type Database, iotEdge, labelPrinter, printJob } from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import type { Tx } from '../accounting/accounting-lock.js';

const LEASE_SECONDS = 60;
export const MAX_ATTEMPTS = 3;
/** Used for downloads when no printer is chosen: a common 50 × 25 mm label at 203 dpi. */
export const DEFAULT_LABEL: LabelSize = { dpi: 203, widthMm: 50, heightMm: 25 };

export type JobKind = 'panel' | 'board' | 'container' | 'test';

@Injectable()
export class LabelService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The active printer of this entity, with its label size. */
  async printer(db: Database | Tx, entityId: string, printerId: string) {
    const [p] = await db.select().from(labelPrinter).where(and(eq(labelPrinter.id, printerId), eq(labelPrinter.entityId, entityId)));
    if (!p) throw new NotFoundException('Printer not found');
    if (p.status !== 'active') throw new ConflictException(`Printer ${p.code} is retired`);
    const [e] = await db.select({ status: iotEdge.status }).from(iotEdge).where(eq(iotEdge.id, p.edgeId));
    if (e?.status !== 'active') throw new ConflictException(`The edge of printer ${p.code} is revoked`);
    return { ...p, size: { dpi: p.dpi, widthMm: p.widthMm, heightMm: p.heightMm } as LabelSize };
  }

  /** Queues one job; `render` turns the printer's label size into ZPL. */
  async queue(tx: Tx, ctx: TenantRequestContext, entityId: string, printerId: string, job: { kind: JobKind; sourceId: string | null; label: string; render: (size: LabelSize) => string }) {
    const p = await this.printer(tx, entityId, printerId);
    const zpl = job.render(p.size);
    if (zpl.length > 200_000) throw new BadRequestException('Too many labels in one job');
    const [row] = await tx
      .insert(printJob)
      .values({ tenantId: ctx.tenant.tenantId, entityId, printerId: p.id, kind: job.kind, sourceId: job.sourceId, label: job.label, zpl, createdBy: ctx.user.id })
      .returning({ id: printJob.id, status: printJob.status, label: printJob.label });
    return { ...row!, printer: p.code };
  }

  /**
   * The edge's next jobs: queued ones, and sent ones whose lease ran out (the agent died mid-job). Each claim counts as
   * an attempt; a job that has used its attempts is failed instead of handed out again.
   */
  async claim(edgeId: string, limit = 10) {
    return this.db.transaction(async (tx) => {
      const printers = await tx.select({ id: labelPrinter.id }).from(labelPrinter).where(and(eq(labelPrinter.edgeId, edgeId), eq(labelPrinter.status, 'active')));
      if (!printers.length) return [];
      const due = await tx
        .select({ id: printJob.id, attempts: printJob.attempts })
        .from(printJob)
        .where(and(inArray(printJob.printerId, printers.map((p) => p.id)), sql`(${printJob.status} = 'queued' or (${printJob.status} = 'sent' and ${printJob.leaseUntil} < now()))`))
        .orderBy(printJob.createdAt)
        .limit(limit)
        .for('update', { skipLocked: true });
      const spent = due.filter((d) => d.attempts >= MAX_ATTEMPTS).map((d) => d.id);
      if (spent.length) await tx.update(printJob).set({ status: 'failed', leaseUntil: null, error: sql`coalesce(${printJob.error}, 'The edge did not report a result')` }).where(inArray(printJob.id, spent));
      const ids = due.filter((d) => d.attempts < MAX_ATTEMPTS).map((d) => d.id);
      if (!ids.length) return [];
      const rows = await tx
        .update(printJob)
        .set({ status: 'sent', attempts: sql`${printJob.attempts} + 1`, leaseUntil: sql`now() + interval '${sql.raw(String(LEASE_SECONDS))} seconds'` })
        .where(inArray(printJob.id, ids))
        .returning({ id: printJob.id, printerId: printJob.printerId, zpl: printJob.zpl, createdAt: printJob.createdAt });
      const hosts = await tx.select({ id: labelPrinter.id, host: labelPrinter.host, port: labelPrinter.port }).from(labelPrinter).where(inArray(labelPrinter.id, rows.map((r) => r.printerId)));
      return rows
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((r) => {
          const h = hosts.find((x) => x.id === r.printerId)!;
          return { id: r.id, host: h.host, port: h.port, zpl: r.zpl };
        });
    });
  }

  /** The edge's report. A failure goes back to the queue until its attempts are used. Only the edge's own jobs. */
  async result(edgeId: string, jobId: string, ok: boolean, error: string | null) {
    return this.db.transaction(async (tx) => {
      const [j] = await tx
        .select({ id: printJob.id, status: printJob.status, attempts: printJob.attempts, edgeId: labelPrinter.edgeId })
        .from(printJob)
        .innerJoin(labelPrinter, eq(labelPrinter.id, printJob.printerId))
        .where(eq(printJob.id, jobId))
        .for('update', { of: printJob });
      if (!j || j.edgeId !== edgeId) throw new NotFoundException('Print job not found');
      if (j.status !== 'sent') return { id: j.id, status: j.status };
      const next = ok ? 'printed' : j.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
      await tx
        .update(printJob)
        .set({ status: next, leaseUntil: null, error: ok ? null : (error ?? 'Printer error').slice(0, 300), printedAt: ok ? new Date() : null })
        .where(eq(printJob.id, j.id));
      return { id: j.id, status: next };
    });
  }

  /** A failed or printed job queued again as a new job, so the history stays. */
  async reprint(tx: Tx, ctx: TenantRequestContext, entityId: string, jobId: string) {
    const [j] = await tx.select().from(printJob).where(and(eq(printJob.id, jobId), eq(printJob.entityId, entityId)));
    if (!j) throw new NotFoundException('Print job not found');
    await this.printer(tx, entityId, j.printerId);
    const [row] = await tx
      .insert(printJob)
      .values({ tenantId: j.tenantId, entityId, printerId: j.printerId, kind: j.kind, sourceId: j.sourceId, label: j.label, zpl: j.zpl, createdBy: ctx.user.id })
      .returning({ id: printJob.id, status: printJob.status });
    return row!;
  }
}
