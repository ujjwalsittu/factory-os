// Genealogy (decision 046): one graph over existing documents. Backward: what is in a serial or lot, down to purchase
// receipts. Forward: where a heat or lot went, through sub-assemblies, to stock or customers. As-built rows narrow a
// serial assembly to its exact component serials.
import { Dec } from '@factoryos/core';
import { batch, type Database, item, party, salesInvoice, serialComponent, stockBin, stockEntry, stockEntryLine, warehouse, workOrder } from '@factoryos/db';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../common/tokens.js';

export const MAX_DEPTH = 10;
export const MAX_NODES = 5000;

export interface GenealogyNode {
  batchId: string;
  batchNo: string;
  heatNo: string | null;
  kind: 'lot' | 'serial' | 'remnant';
  lengthMm: string | null;
  itemCode: string;
  itemName: string;
  /** How this node relates to its parent in the tree, with the quantity that moved. */
  via: { type: 'work_order' | 'remnant' | 'as_built' | 'job_work'; number: string | null; workOrderId?: string; qty: string } | null;
  receipts: { number: string | null; date: string; supplier: string | null; qty: string }[];
  stock: { warehouse: string; qty: string }[];
  deliveries: { invoice: string | null; date: string; customer: string | null; qty: string; returned: string }[];
  /** Already shown elsewhere in this tree (shared heat, lot or sub-assembly): listed here, expanded once. */
  seen?: boolean;
  children: GenealogyNode[];
}

type Edge = { batchId: string; via: GenealogyNode['via'] };

@Injectable()
export class GenealogyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Serials, lots, remnants and heats matching a search, for the explorer's search box. */
  async search(tenantId: string, q: string) {
    const like = `%${q.trim()}%`;
    return this.db
      .select({ batchId: batch.id, batchNo: batch.batchNo, heatNo: batch.heatNo, kind: batch.kind, itemCode: item.code, itemName: item.name })
      .from(batch)
      .innerJoin(item, eq(item.id, batch.itemId))
      .where(and(eq(batch.tenantId, tenantId), sql`(${batch.batchNo} ilike ${like} or ${batch.heatNo} ilike ${like} or ${item.code} ilike ${like})`))
      .orderBy(batch.batchNo)
      .limit(50);
  }

  async tree(tenantId: string, entityId: string, batchId: string, direction: 'backward' | 'forward') {
    const visited = new Set<string>();
    let truncated = false;
    const root = await this.node(tenantId, entityId, batchId, null);
    if (!root) throw new NotFoundException('Batch not found');
    visited.add(batchId);
    // Breadth-first so the node limit cuts the deepest levels first.
    let level: GenealogyNode[] = [root];
    for (let depth = 0; depth < MAX_DEPTH && level.length; depth++) {
      const next: GenealogyNode[] = [];
      for (const n of level) {
        const edges = direction === 'backward' ? await this.inputs(entityId, n.batchId) : await this.outputs(entityId, n.batchId);
        for (const e of edges) {
          if (visited.size >= MAX_NODES) {
            truncated = true;
            break;
          }
          const repeat = visited.has(e.batchId);
          visited.add(e.batchId);
          const child = await this.node(tenantId, entityId, e.batchId, e.via);
          if (!child) continue;
          n.children.push(repeat ? { ...child, seen: true } : child);
          if (!repeat) next.push(child);
        }
      }
      level = next;
      if (depth === MAX_DEPTH - 1 && level.length) truncated = true;
    }
    return { direction, root, truncated, nodes: visited.size };
  }

  /** Every serial and lot reached forward from a batch, with where it is now: the recall list. */
  async recall(tenantId: string, entityId: string, batchId: string) {
    const t = await this.tree(tenantId, entityId, batchId, 'forward');
    const rows: (Omit<GenealogyNode, 'children' | 'via'> & { depth: number; viaNumber: string | null })[] = [];
    const walk = (n: GenealogyNode, depth: number) => {
      const { children, via, seen, ...rest } = n;
      if (seen) return;
      rows.push({ ...rest, depth, viaNumber: via?.number ?? null });
      children.forEach((c) => walk(c, depth + 1));
    };
    walk(t.root, 0);
    return { truncated: t.truncated, rows };
  }

  private async node(tenantId: string, entityId: string, batchId: string, via: GenealogyNode['via']): Promise<GenealogyNode | null> {
    const [b] = await this.db
      .select({ batch, itemCode: item.code, itemName: item.name })
      .from(batch)
      .innerJoin(item, eq(item.id, batch.itemId))
      .where(and(eq(batch.id, batchId), eq(batch.tenantId, tenantId)));
    if (!b) return null;
    const receipts = await this.db
      .select({ number: stockEntry.number, date: stockEntry.postingDate, supplier: party.name, qty: stockEntryLine.qty })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .leftJoin(party, eq(party.id, stockEntry.partyId))
      .where(and(eq(stockEntry.entityId, entityId), eq(stockEntryLine.batchId, batchId), eq(stockEntry.status, 'submitted'), eq(stockEntry.purpose, 'receipt')));
    const stock = await this.db
      .select({ warehouse: warehouse.name, qty: stockBin.qty })
      .from(stockBin)
      .innerJoin(warehouse, eq(warehouse.id, stockBin.warehouseId))
      .where(and(eq(stockBin.entityId, entityId), eq(stockBin.batchId, batchId), sql`${stockBin.qty} > 0`));
    const shipped = await this.db
      .select({ invoice: salesInvoice.number, date: stockEntry.postingDate, customer: party.name, qty: stockEntryLine.qty, invoiceId: salesInvoice.id })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .innerJoin(salesInvoice, eq(salesInvoice.stockEntryId, stockEntry.id))
      .leftJoin(party, eq(party.id, salesInvoice.customerId))
      .where(and(eq(stockEntry.entityId, entityId), eq(stockEntryLine.batchId, batchId), eq(stockEntry.status, 'submitted'), eq(stockEntry.purpose, 'delivery')));
    const [ret] = await this.db
      .select({ q: sql<string>`coalesce(sum(${stockEntryLine.qty}), 0)` })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .where(and(eq(stockEntry.entityId, entityId), eq(stockEntryLine.batchId, batchId), eq(stockEntry.status, 'submitted'), eq(stockEntry.purpose, 'sales_return')));
    // Returns aren't tied to a delivery row here; they are shown against the first deliveries until used up.
    let returned = Dec.of(ret!.q);
    const deliveries = shipped.map((d) => {
      const r = Dec.min(returned, Dec.of(d.qty));
      returned = returned.sub(r);
      return { invoice: d.invoice, date: d.date, customer: d.customer, qty: d.qty, returned: r.toString() };
    });
    return {
      batchId,
      batchNo: b.batch.batchNo,
      heatNo: b.batch.heatNo,
      kind: b.batch.kind,
      lengthMm: b.batch.lengthMm,
      itemCode: b.itemCode,
      itemName: b.itemName,
      via,
      receipts,
      stock,
      deliveries,
      children: [],
    };
  }

  /** Live as-built rows (not reversed). */
  private liveAsBuilt = sql`${serialComponent.reversalOf} is null and not exists (select 1 from serial_component r where r.reversal_of = ${serialComponent.id})`;

  /** Backward: the batches that went into this one. */
  private async inputs(entityId: string, batchId: string): Promise<Edge[]> {
    const edges: Edge[] = [];
    const [b] = await this.db.select({ parent: batch.parentBatchId }).from(batch).where(eq(batch.id, batchId));
    if (b?.parent) edges.push({ batchId: b.parent, via: { type: 'remnant', number: null, qty: '0' } });
    const madeBy = await this.movementOrders(entityId, batchId, 'production_output');
    const built = await this.db.select({ component: serialComponent.componentBatchId, workOrderId: serialComponent.workOrderId }).from(serialComponent).where(and(eq(serialComponent.assemblyBatchId, batchId), this.liveAsBuilt));
    const builtIds = new Set(built.map((x) => x.component));
    for (const wo of madeBy) {
      const consumed = await this.netByBatch(entityId, wo.workOrderId);
      // For an assembly serial with as-built rows, other serial components of the order went into other assemblies.
      const serialOfOrder = await this.serialBatches(consumed.map((c) => c.batchId));
      for (const c of consumed) {
        if (built.length && serialOfOrder.has(c.batchId) && !builtIds.has(c.batchId)) continue;
        edges.push({ batchId: c.batchId, via: { type: builtIds.has(c.batchId) ? 'as_built' : 'work_order', number: wo.number, workOrderId: wo.workOrderId, qty: c.qty } });
      }
    }
    edges.push(...(await this.jobWork(entityId, batchId, 'backward')));
    return edges;
  }

  /** Forward: the batches made from this one, and remnants cut from it. */
  private async outputs(entityId: string, batchId: string): Promise<Edge[]> {
    const edges: Edge[] = [];
    const children = await this.db.select({ id: batch.id, lengthMm: batch.lengthMm }).from(batch).where(eq(batch.parentBatchId, batchId));
    for (const ch of children) edges.push({ batchId: ch.id, via: { type: 'remnant', number: null, qty: ch.lengthMm ?? '0' } });
    const [as] = await this.db.select({ assembly: serialComponent.assemblyBatchId, workOrderId: serialComponent.workOrderId }).from(serialComponent).where(and(eq(serialComponent.componentBatchId, batchId), this.liveAsBuilt));
    const usedIn = await this.movementOrders(entityId, batchId, 'production_issue');
    for (const wo of usedIn) {
      const net = (await this.netByBatch(entityId, wo.workOrderId)).find((c) => c.batchId === batchId);
      if (!net) continue;
      if (as && as.workOrderId === wo.workOrderId) {
        const [o] = await this.db.select({ number: workOrder.number }).from(workOrder).where(eq(workOrder.id, wo.workOrderId));
        edges.push({ batchId: as.assembly, via: { type: 'as_built', number: o?.number ?? null, workOrderId: wo.workOrderId, qty: '1' } });
        continue;
      }
      for (const p of await this.produced(entityId, wo.workOrderId)) edges.push({ batchId: p.batchId, via: { type: 'work_order', number: wo.number, workOrderId: wo.workOrderId, qty: p.qty } });
    }
    edges.push(...(await this.jobWork(entityId, batchId, 'forward')));
    return edges;
  }

  /**
   * Job work receipts (decision 047): material consumed at the job worker became the received goods. Backward
   * from a received batch to what was consumed; forward from a consumed batch to what came back. Same-batch
   * processing (heat treatment of one heat) links a batch to itself and is skipped.
   */
  private async jobWork(entityId: string, batchId: string, direction: 'backward' | 'forward'): Promise<Edge[]> {
    const mine = direction === 'backward' ? sql`${stockEntryLine.toWarehouseId} is not null` : sql`${stockEntryLine.fromWarehouseId} is not null`;
    const other = direction === 'backward' ? sql`${stockEntryLine.fromWarehouseId} is not null` : sql`${stockEntryLine.toWarehouseId} is not null`;
    const entries = await this.db
      .selectDistinct({ id: stockEntry.id, number: stockEntry.reference })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .where(and(eq(stockEntry.entityId, entityId), eq(stockEntry.purpose, 'job_work_in'), eq(stockEntry.status, 'submitted'), eq(stockEntryLine.batchId, batchId), mine));
    const edges: Edge[] = [];
    for (const e of entries) {
      const lines = await this.db.select({ batchId: stockEntryLine.batchId, qty: stockEntryLine.qty }).from(stockEntryLine).where(and(eq(stockEntryLine.entryId, e.id), other, sql`${stockEntryLine.batchId} is not null`));
      for (const l of lines) if (l.batchId !== batchId) edges.push({ batchId: l.batchId!, via: { type: 'job_work', number: e.number, qty: l.qty } });
    }
    return edges;
  }

  private async movementOrders(entityId: string, batchId: string, purpose: 'production_issue' | 'production_output') {
    return this.db
      .selectDistinct({ workOrderId: workOrder.id, number: workOrder.number })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .innerJoin(workOrder, eq(workOrder.id, stockEntry.workOrderId))
      .where(and(eq(stockEntry.entityId, entityId), eq(stockEntryLine.batchId, batchId), eq(stockEntry.status, 'submitted'), eq(stockEntry.purpose, purpose)));
  }

  /** Net issued (issue − return) per batch on a work order. */
  private async netByBatch(entityId: string, workOrderId: string) {
    const rows = await this.db
      .select({ batchId: stockEntryLine.batchId, q: sql<string>`sum(case when ${stockEntry.purpose} = 'production_issue' then ${stockEntryLine.qty} else -${stockEntryLine.qty} end)` })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .where(and(eq(stockEntry.entityId, entityId), eq(stockEntry.workOrderId, workOrderId), eq(stockEntry.status, 'submitted'), inArray(stockEntry.purpose, ['production_issue', 'production_return']), sql`${stockEntryLine.batchId} is not null`))
      .groupBy(stockEntryLine.batchId);
    return rows.filter((r) => Dec.of(r.q).gt('0')).map((r) => ({ batchId: r.batchId!, qty: Dec.of(r.q).toString() }));
  }

  private async produced(entityId: string, workOrderId: string) {
    const rows = await this.db
      .select({ batchId: stockEntryLine.batchId, qty: stockEntryLine.qty })
      .from(stockEntryLine)
      .innerJoin(stockEntry, eq(stockEntry.id, stockEntryLine.entryId))
      .where(and(eq(stockEntry.entityId, entityId), eq(stockEntry.workOrderId, workOrderId), eq(stockEntry.status, 'submitted'), eq(stockEntry.purpose, 'production_output'), sql`${stockEntryLine.batchId} is not null`));
    return rows.map((r) => ({ batchId: r.batchId!, qty: r.qty }));
  }

  private async serialBatches(ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await this.db.select({ id: batch.id }).from(batch).where(and(inArray(batch.id, ids), eq(batch.kind, 'serial')));
    return new Set(rows.map((r) => r.id));
  }
}

