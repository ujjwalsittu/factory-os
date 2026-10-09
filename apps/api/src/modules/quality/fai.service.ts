// First article inspection per AS9102 (decision 048). Form 1 (part), Form 2 (materials, special processes,
// functional tests) and Form 3 (characteristics) are assembled from the item, genealogy, job work and the final
// inspection; they are frozen on submit. Approval is maker-checker and lifts the sales-invoice gate.
import { type FaiReason, faiRequirement } from '@factoryos/core';
import {
  attachment,
  batch,
  bom,
  bomMaterial,
  type Database,
  fai,
  inspectionCharacteristic,
  inspectionRecord,
  item,
  jobWorkOrder,
  jobWorkReceipt,
  legalEntity,
  party,
  stockEntry,
  stockEntryLine,
} from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { businessDate, type Tx } from '../accounting/accounting-lock.js';
import { type GenealogyNode, GenealogyService } from '../manufacturing/genealogy.service.js';
import { StockPostingService } from '../stock-posting.service.js';
import { QualityService } from './quality.service.js';

type Item = typeof item.$inferSelect;

@Injectable()
export class FaiService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly posting: StockPostingService,
    private readonly genealogy: GenealogyService,
    private readonly quality: QualityService,
  ) {}

  /** Why an FAI is needed for this item now, or null (AS9102 triggers; decision 048). */
  async requirement(db: Database | Tx, entityId: string, it: Item): Promise<FaiReason | null> {
    if (!it.requiresFai) return null;
    const approved = await db
      .select({ revision: fai.itemRevision, decidedAt: fai.decidedAt })
      .from(fai)
      .where(and(eq(fai.entityId, entityId), eq(fai.itemId, it.id), eq(fai.status, 'approved')));
    return faiRequirement({
      requiresFai: it.requiresFai,
      processChange: it.faiProcessChange,
      revision: it.revision,
      approved: approved.map((a) => ({ revision: a.revision, approvedOn: a.decidedAt!.toISOString().slice(0, 10) })),
      today: businessDate(),
    });
  }

  /** Sales invoice gate: refuses lines of items whose FAI is outstanding, naming the reason. */
  async assertInvoiceable(tx: Tx, entityId: string, items: Item[]) {
    for (const it of items) {
      const reason = await this.requirement(tx, entityId, it);
      if (reason)
        throw new BadRequestException(
          `${it.code} rev ${it.revision ?? '—'} needs an approved first article inspection (${REASON_TEXT[reason]}) before it can be invoiced. Complete it in Quality → FAI.`,
        );
    }
  }

  async createIn(tx: Tx, ctx: TenantRequestContext, entityId: string, input: { itemId: string; batchId?: string | null; inspectionRecordId?: string | null; reason?: FaiReason | null; remarks?: string | null }) {
    const [it] = await tx.select().from(item).where(and(eq(item.id, input.itemId), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!it) throw new BadRequestException({ message: 'Unknown item', issues: [{ path: 'itemId', message: 'Unknown item' }] });
    if (input.batchId) {
      const [b] = await tx.select().from(batch).where(eq(batch.id, input.batchId));
      if (!b || b.itemId !== it.id) throw new BadRequestException({ message: 'The serial or lot is not of this item', issues: [{ path: 'batchId', message: 'Wrong item' }] });
    }
    if (input.inspectionRecordId) await this.finalInspection(tx, entityId, it.id, input.inspectionRecordId);
    const [open] = await tx.select({ number: fai.number }).from(fai).where(and(eq(fai.entityId, entityId), eq(fai.itemId, it.id), inArray(fai.status, ['draft', 'submitted'])));
    if (open) throw new ConflictException(`FAI ${open.number} for this item is already in progress`);
    const reason = input.reason ?? (await this.requirement(tx, entityId, it)) ?? 'first_build';
    const number = await this.posting.allocateNumber(tx, ctx.tenant.tenantId, entityId, 'fai', businessDate());
    const [f] = await tx
      .insert(fai)
      .values({ tenantId: ctx.tenant.tenantId, entityId, number, itemId: it.id, itemRevision: it.revision, batchId: input.batchId ?? null, reason, inspectionRecordId: input.inspectionRecordId ?? null, remarks: input.remarks ?? null, createdBy: ctx.user.id })
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'fai.create', targetType: 'fai', targetId: f!.id, after: { number, item: it.code, revision: it.revision, reason } }, tx);
    return f!;
  }

  async updateIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, input: { batchId?: string | null; inspectionRecordId?: string | null; remarks?: string | null }) {
    const f = await this.lock(tx, entityId, id);
    if (f.status !== 'draft') throw new ConflictException('Only draft FAIs can change');
    if (input.inspectionRecordId) await this.finalInspection(tx, entityId, f.itemId, input.inspectionRecordId);
    if (input.batchId) {
      const [b] = await tx.select().from(batch).where(eq(batch.id, input.batchId));
      if (!b || b.itemId !== f.itemId) throw new BadRequestException({ message: 'The serial or lot is not of this item', issues: [{ path: 'batchId', message: 'Wrong item' }] });
    }
    await tx
      .update(fai)
      .set({ batchId: input.batchId === undefined ? f.batchId : input.batchId, inspectionRecordId: input.inspectionRecordId === undefined ? f.inspectionRecordId : input.inspectionRecordId, remarks: input.remarks === undefined ? f.remarks : input.remarks })
      .where(eq(fai.id, id));
  }

  /** Freezes Forms 1–3. Form 3 needs a submitted final inspection of the first article. */
  async submitIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string) {
    const f = await this.lock(tx, entityId, id);
    if (f.status !== 'draft') throw new ConflictException(`Only drafts can be submitted (this one is ${f.status})`);
    if (!f.batchId) throw new BadRequestException('Choose the serial or lot of the first article');
    if (!f.inspectionRecordId) throw new BadRequestException('Link the final inspection of the first article (Form 3)');
    const forms = await this.forms(ctx, entityId, f);
    if (forms.form3.characteristics.some((c) => c.result === 'fail')) throw new BadRequestException('A characteristic failed on the first article; the FAI can only be submitted when Form 3 conforms');
    await tx.update(fai).set({ status: 'submitted', forms, submittedBy: ctx.user.id, submittedAt: new Date() }).where(eq(fai.id, id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'fai.submit', targetType: 'fai', targetId: id }, tx);
  }

  /** Maker-checker: the approver can't be the person who submitted it. */
  async decideIn(tx: Tx, ctx: TenantRequestContext, entityId: string, id: string, decision: 'approved' | 'rejected', note: string | null) {
    const f = await this.lock(tx, entityId, id);
    if (f.status !== 'submitted') throw new ConflictException('Only submitted FAIs can be approved or rejected');
    if (f.submittedBy === ctx.user.id) throw new ConflictException('The FAI must be approved by someone other than the person who submitted it');
    if (decision === 'rejected' && !note?.trim()) throw new BadRequestException({ message: 'Give the reason for rejecting', issues: [{ path: 'note', message: 'Required' }] });
    await tx.update(fai).set({ status: decision, decidedBy: ctx.user.id, decidedAt: new Date(), decisionNote: note }).where(eq(fai.id, id));
    if (decision === 'approved') await tx.update(item).set({ faiProcessChange: false }).where(eq(item.id, f.itemId));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: `fai.${decision === 'approved' ? 'approve' : 'reject'}`, targetType: 'fai', targetId: id, reason: note ?? undefined }, tx);
  }

  async lock(tx: Tx, entityId: string, id: string) {
    const [f] = await tx.select().from(fai).where(and(eq(fai.id, id), eq(fai.entityId, entityId))).for('update');
    if (!f) throw new NotFoundException('FAI not found');
    return f;
  }

  private async finalInspection(tx: Tx, entityId: string, itemId: string, id: string) {
    const [r] = await tx.select().from(inspectionRecord).where(and(eq(inspectionRecord.id, id), eq(inspectionRecord.entityId, entityId)));
    if (!r || r.itemId !== itemId || r.stage !== 'final') throw new BadRequestException({ message: 'Link a final inspection of this item', issues: [{ path: 'inspectionRecordId', message: 'Not a final inspection of this item' }] });
    if (r.status !== 'submitted') throw new BadRequestException({ message: 'The final inspection is not submitted yet', issues: [{ path: 'inspectionRecordId', message: 'Submit it first' }] });
    return r;
  }

  /** AS9102 Forms 1–3, assembled from current data (drafts) or frozen at submit. */
  async forms(ctx: TenantRequestContext, entityId: string, f: typeof fai.$inferSelect) {
    const [it] = await this.db.select().from(item).where(eq(item.id, f.itemId));
    const [ent] = await this.db.select({ name: legalEntity.legalName }).from(legalEntity).where(eq(legalEntity.id, entityId));
    const [b] = f.batchId ? await this.db.select().from(batch).where(eq(batch.id, f.batchId)) : [];
    // Form 1: sub-assemblies of the active BOM that themselves need an FAI, with their latest approved one.
    const [activeBom] = await this.db.select().from(bom).where(and(eq(bom.entityId, entityId), eq(bom.itemId, it!.id), eq(bom.status, 'active'), eq(bom.isDefault, true)));
    const subs = activeBom
      ? await this.db
          .select({ itemId: item.id, code: item.code, name: item.name, revision: item.revision })
          .from(bomMaterial)
          .innerJoin(item, eq(item.id, bomMaterial.itemId))
          .where(and(eq(bomMaterial.bomId, activeBom.id), eq(item.requiresFai, true)))
      : [];
    const subFais = [];
    for (const s of subs) {
      const [last] = await this.db.select({ number: fai.number }).from(fai).where(and(eq(fai.entityId, entityId), eq(fai.itemId, s.itemId), eq(fai.status, 'approved'))).orderBy(desc(fai.decidedAt)).limit(1);
      subFais.push({ partNumber: s.code, name: s.name, revision: s.revision, fai: last?.number ?? null });
    }
    // Form 2: materials (heats and lots received from suppliers) and special processes (job work) from genealogy.
    const materials: { item: string; lot: string; heat: string | null; supplier: string | null; receipt: string | null }[] = [];
    const processes: { process: string | null; supplier: string; order: string | null }[] = [];
    if (b) {
      const tree = await this.genealogy.tree(ctx.tenant.tenantId, entityId, b.id, 'backward');
      const walk = (n: GenealogyNode) => {
        if (n.seen) return;
        for (const r of n.receipts) materials.push({ item: `${n.itemCode} ${n.itemName}`, lot: n.batchNo, heat: n.heatNo, supplier: r.supplier, receipt: r.number });
        n.children.forEach(walk);
      };
      tree.root.children.forEach(walk);
      const jobOrders = new Set<string>();
      const collect = (n: GenealogyNode) => {
        if (n.via?.type === 'job_work' && n.via.number) jobOrders.add(n.via.number);
        n.children.forEach(collect);
      };
      collect(tree.root);
      // Outsourced operations of the work orders that made this lot.
      const made = await this.db
        .selectDistinct({ workOrderId: stockEntry.workOrderId })
        .from(stockEntryLine)
        .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
        .where(and(eq(stockEntryLine.batchId, b.id), eq(stockEntry.purpose, 'production_output'), eq(stockEntry.status, 'submitted')));
      const woIds = made.map((m) => m.workOrderId).filter((x): x is string => !!x);
      const opOrders = woIds.length
        ? await this.db
            .select({ number: jobWorkOrder.number, process: jobWorkOrder.natureOfWork, supplier: party.name })
            .from(jobWorkOrder)
            .innerJoin(party, eq(party.id, jobWorkOrder.supplierId))
            .where(and(inArray(jobWorkOrder.workOrderId, woIds), inArray(jobWorkOrder.status, ['open', 'closed'])))
        : [];
      const convOrders = jobOrders.size
        ? await this.db
            .select({ number: jobWorkOrder.number, process: jobWorkOrder.natureOfWork, supplier: party.name })
            .from(jobWorkOrder)
            .innerJoin(party, eq(party.id, jobWorkOrder.supplierId))
            .where(and(eq(jobWorkOrder.entityId, entityId), inArray(jobWorkOrder.number, [...jobOrders])))
        : [];
      for (const o of [...opOrders, ...convOrders]) processes.push({ process: o.process, supplier: o.supplier, order: o.number });
    }
    // Form 3 and functional tests: the linked final inspection's characteristics and latest results.
    const characteristics: { balloon: string | null; description: string; kind: string; requirement: string; results: string[]; result: 'pass' | 'fail' | 'not_measured'; key: boolean }[] = [];
    const tests: { description: string; result: string }[] = [];
    if (f.inspectionRecordId) {
      const [rec] = await this.db.select().from(inspectionRecord).where(eq(inspectionRecord.id, f.inspectionRecordId));
      const chars = rec?.planId ? await this.db.select().from(inspectionCharacteristic).where(eq(inspectionCharacteristic.planId, rec.planId)).orderBy(asc(inspectionCharacteristic.lineNo)) : [];
      const latest = await this.quality.latestResults(this.db, f.inspectionRecordId);
      for (const c of chars) {
        const rs = latest.filter((x) => x.characteristicId === c.id);
        const requirement = c.lowerLimit !== null || c.upperLimit !== null ? `${c.nominal ?? ''} ${c.lowerLimit ?? '−∞'}…${c.upperLimit ?? '∞'} ${c.unit ?? ''}`.trim() : (c.method ?? 'Conforms');
        const row = { balloon: c.balloon, description: c.description, kind: c.kind, requirement, results: rs.map((x) => x.measured ?? (x.pass ? 'OK' : 'NOK')), result: (rs.length ? (rs.every((x) => x.pass) ? 'pass' : 'fail') : 'not_measured') as 'pass' | 'fail' | 'not_measured', key: c.isKey };
        characteristics.push(row);
        if (c.kind === 'functional') tests.push({ description: c.description, result: row.result });
      }
      for (const x of latest.filter((y) => !y.characteristicId)) characteristics.push({ balloon: null, description: x.description ?? '', kind: 'visual', requirement: 'Conforms', results: [x.measured ?? (x.pass ? 'OK' : 'NOK')], result: x.pass ? 'pass' : 'fail', key: false });
    }
    return {
      form1: { partNumber: it!.code, partName: it!.name, revision: it!.revision, drawingNo: it!.drawingNo, organization: ent?.name ?? null, faiNumber: f.number, reason: f.reason, serialOrLot: b?.batchNo ?? null, subAssemblies: subFais },
      form2: { materials, specialProcesses: processes, functionalTests: tests },
      form3: { characteristics },
    };
  }

  /**
   * Certificate pack for a delivered lot or serial: attachments along its backward genealogy (batches, their
   * inspections, FAIs and job work receipts), withdrawn files excluded.
   */
  async packAttachments(ctx: TenantRequestContext, entityId: string, batchId: string) {
    const tree = await this.genealogy.tree(ctx.tenant.tenantId, entityId, batchId, 'backward');
    const ids = new Set<string>();
    const walk = (n: GenealogyNode) => {
      ids.add(n.batchId);
      n.children.forEach(walk);
    };
    walk(tree.root);
    const batchIds = [...ids];
    const recs = await this.db.select({ id: inspectionRecord.id }).from(inspectionRecord).where(and(inArray(inspectionRecord.batchId, batchIds), eq(inspectionRecord.status, 'submitted')));
    const fais = await this.db.select({ id: fai.id }).from(fai).where(and(inArray(fai.batchId, batchIds), eq(fai.status, 'approved')));
    const jwr = await this.db
      .selectDistinct({ id: jobWorkReceipt.id })
      .from(jobWorkReceipt)
      .innerJoin(stockEntryLine, eq(stockEntryLine.entryId, jobWorkReceipt.stockEntryId))
      .where(and(eq(jobWorkReceipt.entityId, entityId), eq(jobWorkReceipt.status, 'submitted'), inArray(stockEntryLine.batchId, batchIds)));
    // Outsourced operations post no stock: their receipts hang off the work orders that made these lots.
    const makers = await this.db
      .selectDistinct({ workOrderId: stockEntry.workOrderId })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .where(and(inArray(stockEntryLine.batchId, batchIds), eq(stockEntry.purpose, 'production_output'), eq(stockEntry.status, 'submitted')));
    const woIds = makers.map((m) => m.workOrderId).filter((x): x is string => !!x);
    if (woIds.length)
      jwr.push(
        ...(await this.db
          .select({ id: jobWorkReceipt.id })
          .from(jobWorkReceipt)
          .innerJoin(jobWorkOrder, eq(jobWorkOrder.id, jobWorkReceipt.orderId))
          .where(and(inArray(jobWorkOrder.workOrderId, woIds), eq(jobWorkReceipt.status, 'submitted')))),
      );
    const owners: [string, string[]][] = [
      ['batch', batchIds],
      ['inspection_record', recs.map((r) => r.id)],
      ['fai', fais.map((r) => r.id)],
      ['job_work_receipt', [...new Set(jwr.map((r) => r.id))]],
    ];
    const files: (typeof attachment.$inferSelect)[] = [];
    for (const [type, list] of owners) {
      if (!list.length) continue;
      files.push(...(await this.db.select().from(attachment).where(and(eq(attachment.entityId, entityId), eq(attachment.ownerType, type), inArray(attachment.ownerId, list), isNull(attachment.withdrawnAt))).orderBy(asc(attachment.createdAt))));
    }
    return { root: tree.root, files };
  }
}

const REASON_TEXT: Record<FaiReason, string> = {
  first_build: 'first build',
  revision_change: 'new revision',
  process_change: 'process change',
  lapse: 'more than two years since the last one',
};
