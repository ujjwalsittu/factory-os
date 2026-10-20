import { type Database } from '@factoryos/db';
import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, TenantScoped, type TenantRequestContext } from '../common/access.js';
import { parse } from '../common/validation.js';
import { DB } from '../common/tokens.js';

/** One record in a list: what it is, a short detail, and the page that opens it. */
export interface RecordRow {
  id: string;
  number: string;
  detail: string;
  href: string;
}
export interface Section {
  id: string;
  title: string;
  rows: RecordRow[];
  /** The list page for the whole thing, when there is one. */
  href?: string;
}

const LIMIT = 10;
const PAGE = {
  quotation: '/app/selling/quotations',
  sales_order: '/app/selling/orders',
  sales_invoice: '/app/selling/invoices',
  sales_note: '/app/selling/notes',
  purchase_order: '/app/buying/orders',
  purchase_invoice: '/app/buying/invoices',
  supplier_note: '/app/buying/supplier-notes',
  return_claim: '/app/buying/return-claims',
  stock_entry: '/app/inventory/entries',
  work_order: '/app/manufacturing/work-orders',
  job_work_order: '/app/manufacturing/job-work',
  ncr: '/app/quality/ncrs',
  maintenance_order: '/app/maintenance/orders',
  voucher: '/app/accounts/journals',
  item: '/app/masters/items',
  party: '/app/masters/parties',
  batch: '/app/inventory/batches',
  machine: '/app/machines',
} as const;
type Kind = keyof typeof PAGE;

/** The permission that lets a person read each kind of record. */
const READ: Record<Kind, string> = {
  quotation: 'selling.quotation.read',
  sales_order: 'selling.sales_order.read',
  sales_invoice: 'selling.sales_invoice.read',
  sales_note: 'selling.sales_note.read',
  purchase_order: 'buying.purchase_order.read',
  purchase_invoice: 'buying.purchase_invoice.read',
  supplier_note: 'buying.supplier_note.read',
  return_claim: 'buying.return_claim.read',
  stock_entry: 'inventory.stock_entry.read',
  work_order: 'manufacturing.work_order.read',
  job_work_order: 'manufacturing.job_work.read',
  ncr: 'quality.ncr.read',
  maintenance_order: 'maintenance.order.read',
  voucher: 'accounts.voucher.read',
  item: 'masters.item.read',
  party: 'masters.party.read',
  batch: 'inventory.batch.read',
  machine: 'manufacturing.work_centre.read',
};
const LABEL: Record<Kind, string> = {
  quotation: 'Quotations',
  sales_order: 'Sales orders',
  sales_invoice: 'Sales invoices',
  sales_note: 'Credit and debit notes',
  purchase_order: 'Purchase orders',
  purchase_invoice: 'Purchase invoices',
  supplier_note: 'Supplier notes',
  return_claim: 'Return claims',
  stock_entry: 'Stock entries',
  work_order: 'Work orders',
  job_work_order: 'Job work',
  ncr: 'NCRs',
  maintenance_order: 'Maintenance orders',
  voucher: 'Journal vouchers',
  item: 'Items',
  party: 'Parties',
  batch: 'Batches and serials',
  machine: 'Machines',
};

type Raw = { id: string; number: string | null; detail: string | null };
const rows = (kind: Kind, list: Raw[]): RecordRow[] =>
  list.map((r) => ({ id: r.id, number: r.number ?? 'Draft', detail: r.detail ?? '', href: `${PAGE[kind]}/${r.id}` }));
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

@Controller()
export class RecordsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async q(query: SQL): Promise<Raw[]> {
    return (await this.db.execute<Raw>(query)).rows;
  }

  // ───────────────────────── item page ─────────────────────────

  @Get('items/:id/overview')
  @TenantScoped()
  async itemOverview(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const can = (p: string) => ctx.tenant.permissions.has(p);
    if (!can(READ.item)) throw new NotFoundException('Item not found');
    const tenantId = ctx.tenant.tenantId;
    const entityId = ctx.tenant.activeEntityId;
    const [it] = (await this.db.execute<{ id: string; type: string }>(sql`select id, type from item where id = ${id} and tenant_id = ${tenantId}`)).rows;
    if (!it) throw new NotFoundException('Item not found');
    const sections: Section[] = [];
    const add = (s: Section) => s.rows.length && sections.push(s);
    /** Own stock below the reorder level: what to order up to it (decision 068 hand-off "Create purchase order"). */
    let belowReorder: { onHand: string; shortfall: string } | null = null;
    if (entityId) {
      if (can('inventory.report.read')) {
        const [level] = await this.q(sql`
          select coalesce(sum(b.qty), 0)::numeric::text as number, (i.reorder_level - coalesce(sum(b.qty), 0))::numeric::text as detail
          from item i left join stock_bin b on b.item_id = i.id and b.entity_id = ${entityId} and b.owner_party_id is null
          where i.id = ${id} and i.is_stock_item and i.reorder_level is not null
          group by i.id having coalesce(sum(b.qty), 0) < i.reorder_level`);
        if (level) belowReorder = { onHand: level.number ?? '0', shortfall: level.detail ?? '0' };
        const stock = await this.q(sql`
          select b.id::text as id, w.code || ' · ' || w.name as number,
                 coalesce(bt.batch_no || ' · ', '') || b.qty::numeric::text || case when b.owner_party_id is not null then ' (customer-owned)' else '' end as detail
          from stock_bin b join warehouse w on w.id = b.warehouse_id left join batch bt on bt.id = b.batch_id
          where b.item_id = ${id} and b.entity_id = ${entityId} and b.qty <> 0 order by w.code, bt.batch_no limit ${LIMIT}`);
        add({ id: 'stock', title: 'Stock', href: '/app/inventory/balance', rows: stock.map((r) => ({ id: r.id, number: r.number ?? '', detail: r.detail ?? '', href: '/app/inventory/balance' })) });
        const moves = await this.q(sql`
          select l.seq::text as id, to_char(l.posting_date, 'DD-MM-YYYY') || ' · ' || l.voucher_type as number,
                 l.qty::numeric::text || ' @ ' || l.rate::numeric::text as detail
          from stock_ledger_entry l where l.item_id = ${id} and l.entity_id = ${entityId} order by l.seq desc limit ${LIMIT}`);
        add({ id: 'movements', title: 'Recent movements', href: '/app/inventory/ledger', rows: moves.map((r) => ({ id: r.id, number: r.number ?? '', detail: r.detail ?? '', href: '/app/inventory/ledger' })) });
      }
      if (can('manufacturing.bom.read')) {
        const asProduct = await this.q(sql`select id::text as id, 'Rev ' || revision || ' · ' || status as number, case when is_default then 'default' else '' end as detail from bom where item_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`);
        add({ id: 'bom-product', title: 'Bills of materials (product)', href: '/app/manufacturing/boms', rows: asProduct.map((r) => ({ id: r.id, number: r.number ?? '', detail: r.detail ?? '', href: `/app/manufacturing/boms/${r.id}` })) });
        const usedIn = await this.q(sql`select b.id::text as id, p.code || ' · rev ' || b.revision as number, 'uses ' || m.qty::numeric::text as detail from bom_material m join bom b on b.id = m.bom_id join item p on p.id = b.item_id where m.item_id = ${id} and b.entity_id = ${entityId} order by b.created_at desc limit ${LIMIT}`);
        add({ id: 'bom-used', title: 'Used in bills of materials', rows: usedIn.map((r) => ({ id: r.id, number: r.number ?? '', detail: r.detail ?? '', href: `/app/manufacturing/boms/${r.id}` })) });
      }
      if (can(READ.purchase_order)) {
        const po = await this.q(sql`select o.id::text as id, o.number, s.name || ' · ' || (l.qty - l.received_qty)::numeric::text || ' to receive' as detail from purchase_order_line l join purchase_order o on o.id = l.po_id join party s on s.id = o.supplier_id where l.item_id = ${id} and o.entity_id = ${entityId} and o.status = 'submitted' and l.qty > l.received_qty order by o.created_at desc limit ${LIMIT}`);
        add({ id: 'open-po', title: 'Open purchase orders', href: PAGE.purchase_order, rows: rows('purchase_order', po) });
      }
      if (can(READ.sales_order)) {
        const so = await this.q(sql`select o.id::text as id, o.number, c.name || ' · ' || (l.qty - l.invoiced_qty)::numeric::text || ' to ship' as detail from sales_order_line l join sales_order o on o.id = l.so_id join party c on c.id = o.customer_id where l.item_id = ${id} and o.entity_id = ${entityId} and o.status = 'submitted' and l.qty > l.invoiced_qty order by o.created_at desc limit ${LIMIT}`);
        add({ id: 'open-so', title: 'Open sales orders', href: PAGE.sales_order, rows: rows('sales_order', so) });
      }
      if (can(READ.work_order)) {
        const wo = await this.q(sql`select id::text as id, number, status || ' · ' || produced_qty::numeric::text || ' of ' || planned_qty::numeric::text as detail from work_order where item_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`);
        add({ id: 'work-orders', title: 'Work orders', href: PAGE.work_order, rows: rows('work_order', wo) });
      }
      if (can(READ.ncr)) {
        const ncrs = await this.q(sql`select id::text as id, number, status as detail from ncr where item_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`);
        add({ id: 'ncrs', title: 'NCRs', href: PAGE.ncr, rows: rows('ncr', ncrs) });
      }
      if (can('quality.plan.read')) {
        const plans = await this.q(sql`select id::text as id, stage || ' · rev ' || revision as number, status as detail from inspection_plan where item_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`);
        add({ id: 'plans', title: 'Inspection plans', href: '/app/quality/plans', rows: plans.map((r) => ({ id: r.id, number: r.number ?? '', detail: r.detail ?? '', href: '/app/quality/plans' })) });
      }
      if (can(READ.maintenance_order)) {
        const spares = await this.q(sql`select distinct o.id::text as id, o.number, o.title as detail, o.created_at from maintenance_spare s join maintenance_order o on o.id = s.order_id join stock_entry_line l on l.entry_id = s.stock_entry_id where l.item_id = ${id} and o.entity_id = ${entityId} order by o.created_at desc limit ${LIMIT}`);
        add({ id: 'spares', title: 'Used as a maintenance spare', href: '/app/maintenance/orders', rows: rows('maintenance_order', spares) });
      }
    }
    if (it.type === 'asset' && can(READ.purchase_invoice) && entityId) {
      const inv = await this.q(sql`select i.id::text as id, i.number, s.name || ' · ' || l.qty::numeric::text || ' × ' || l.rate::numeric::text as detail from purchase_invoice_line l join purchase_invoice i on i.id = l.invoice_id join party s on s.id = i.supplier_id where l.item_id = ${id} and i.entity_id = ${entityId} order by i.created_at desc limit ${LIMIT}`);
      add({ id: 'asset-invoices', title: 'Purchase invoices', href: PAGE.purchase_invoice, rows: rows('purchase_invoice', inv) });
    }
    return { needsEntity: !entityId, sections, belowReorder };
  }

  // ───────────────────────── party page ─────────────────────────

  @Get('parties/:id/overview')
  @TenantScoped()
  async partyOverview(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const can = (p: string) => ctx.tenant.permissions.has(p);
    if (!can(READ.party)) throw new NotFoundException('Party not found');
    const tenantId = ctx.tenant.tenantId;
    const entityId = ctx.tenant.activeEntityId;
    const [p] = (await this.db.execute<{ id: string; is_customer: boolean; is_supplier: boolean; is_job_worker: boolean }>(sql`select id, is_customer, is_supplier, is_job_worker from party where id = ${id} and tenant_id = ${tenantId}`)).rows;
    if (!p) throw new NotFoundException('Party not found');
    const sections: Section[] = [];
    const add = (s: Section) => s.rows.length && sections.push(s);
    if (entityId) {
      const money = (col: string) => sql.raw(`'₹ ' || ${col}::numeric::text`);
      if (p.is_customer) {
        if (can(READ.quotation)) add({ id: 'quotations', title: LABEL.quotation, href: PAGE.quotation, rows: rows('quotation', await this.q(sql`select id::text as id, number, status || ' · ' || ${money('grand_total')} as detail from quotation where customer_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`)) });
        if (can(READ.sales_order)) add({ id: 'sales-orders', title: LABEL.sales_order, href: PAGE.sales_order, rows: rows('sales_order', await this.q(sql`select id::text as id, number, status || ' · ' || ${money('grand_total')} as detail from sales_order where customer_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`)) });
        if (can(READ.sales_invoice)) add({ id: 'sales-invoices', title: LABEL.sales_invoice, href: PAGE.sales_invoice, rows: rows('sales_invoice', await this.q(sql`select id::text as id, number, status || ' · ' || ${money('grand_total')} as detail from sales_invoice where customer_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`)) });
        if (can(READ.sales_note)) add({ id: 'sales-notes', title: LABEL.sales_note, href: PAGE.sales_note, rows: rows('sales_note', await this.q(sql`select id::text as id, number, kind || ' · ' || status as detail from sales_note where customer_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`)) });
      }
      if (p.is_supplier || p.is_job_worker) {
        if (can(READ.purchase_order)) add({ id: 'purchase-orders', title: LABEL.purchase_order, href: PAGE.purchase_order, rows: rows('purchase_order', await this.q(sql`select id::text as id, number, status || ' · ' || ${money('grand_total')} as detail from purchase_order where supplier_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`)) });
        if (can(READ.stock_entry)) add({ id: 'receipts', title: 'Receipts', href: PAGE.stock_entry, rows: rows('stock_entry', await this.q(sql`select id::text as id, number, status || ' · ' || to_char(posting_date, 'DD-MM-YYYY') as detail from stock_entry where party_id = ${id} and entity_id = ${entityId} and purpose = 'receipt' order by created_at desc limit ${LIMIT}`)) });
        if (can(READ.purchase_invoice)) add({ id: 'purchase-invoices', title: LABEL.purchase_invoice, href: PAGE.purchase_invoice, rows: rows('purchase_invoice', await this.q(sql`select id::text as id, number, status || ' · ' || ${money('grand_total')} as detail from purchase_invoice where supplier_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`)) });
        if (can(READ.supplier_note)) add({ id: 'supplier-notes', title: LABEL.supplier_note, href: PAGE.supplier_note, rows: rows('supplier_note', await this.q(sql`select id::text as id, number, kind || ' · ' || status as detail from supplier_note where supplier_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`)) });
        if (can(READ.return_claim)) add({ id: 'return-claims', title: LABEL.return_claim, href: PAGE.return_claim, rows: rows('return_claim', await this.q(sql`select id::text as id, number, status as detail from supplier_return_claim where supplier_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`)) });
        if (can(READ.job_work_order)) add({ id: 'job-work', title: LABEL.job_work_order, href: PAGE.job_work_order, rows: rows('job_work_order', await this.q(sql`select id::text as id, number, kind || ' · ' || status as detail from job_work_order where supplier_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`)) });
      }
      if (can('accounts.settlement.read')) {
        const pay = await this.q(sql`select id::text as id, number, direction || ' · ' || status || ' · ' || ${money('amount')} as detail from party_settlement where party_id = ${id} and entity_id = ${entityId} order by created_at desc limit ${LIMIT}`);
        add({ id: 'settlements', title: 'Receipts and payments', href: '/app/accounts/settlements', rows: pay.map((r) => ({ id: r.id, number: r.number ?? 'Draft', detail: r.detail ?? '', href: `/app/accounts/settlements/${r.id}` })) });
      }
    }
    return {
      needsEntity: !entityId,
      // What is outstanding is computed by the Outstanding report; the page links to it rather than repeating the sum.
      outstandingHref: can('accounts.report.read') ? '/app/accounts/outstanding' : null,
      sections,
    };
  }

  // ───────────────────────── related chain ─────────────────────────

  @Get('related/:type/:id')
  @TenantScoped()
  async related(@Ctx() ctx: TenantRequestContext, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string) {
    const can = (p: string) => ctx.tenant.permissions.has(p);
    const entityId = ctx.tenant.activeEntityId;
    if (!entityId) return { sections: [] as Section[] };
    const e = sql`entity_id = ${entityId}`;
    const groups: { kind: Kind; title: string; run: () => Promise<Raw[]> }[] = [];
    const g = (kind: Kind, title: string, run: () => Promise<Raw[]>) => groups.push({ kind, title, run });
    const t = parse(z.enum(['quotation', 'sales_order', 'sales_invoice', 'purchase_order', 'stock_entry', 'purchase_invoice', 'work_order', 'maintenance_order', 'job_work_order']), type);
    // Payments reach an invoice through the bills it created.
    const settlementsOf = (source: string) => () => this.q(sql`select distinct s.id::text as id, s.number, s.direction || ' · ' || s.status as detail, s.created_at from trade_bill b join trade_bill_effect f on f.bill_id = b.id and f.source_type = 'settlement' join party_settlement s on s.id = f.source_id where b.source_type = ${source} and b.source_id = ${id} and s.entity_id = ${entityId} order by s.created_at desc limit ${LIMIT}`);
    switch (t) {
      case 'quotation':
        g('sales_order', 'Sales orders', () => this.q(sql`select id::text as id, number, status as detail from sales_order where quotation_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        g('sales_invoice', 'Sales invoices', () => this.q(sql`select i.id::text as id, i.number, i.status as detail from sales_invoice i join sales_order o on o.id = i.sales_order_id where o.quotation_id = ${id} and i.${e} order by i.created_at desc limit ${LIMIT}`));
        break;
      case 'sales_order':
        g('quotation', 'Quotation', () => this.q(sql`select q.id::text as id, q.number, q.status as detail from quotation q join sales_order o on o.quotation_id = q.id where o.id = ${id} and o.${e}`));
        g('sales_invoice', 'Sales invoices', () => this.q(sql`select id::text as id, number, status as detail from sales_invoice where sales_order_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        g('work_order', 'Work orders', () => this.q(sql`select id::text as id, number, status as detail from work_order where sales_order_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        break;
      case 'sales_invoice':
        g('sales_order', 'Sales order', () => this.q(sql`select o.id::text as id, o.number, o.status as detail from sales_order o join sales_invoice i on i.sales_order_id = o.id where i.id = ${id} and i.${e}`));
        g('quotation', 'Quotation', () => this.q(sql`select q.id::text as id, q.number, q.status as detail from quotation q join sales_order o on o.quotation_id = q.id join sales_invoice i on i.sales_order_id = o.id where i.id = ${id} and i.${e}`));
        g('sales_note', 'Credit and debit notes', () => this.q(sql`select id::text as id, number, kind || ' · ' || status as detail from sales_note where original_invoice_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        break;
      case 'purchase_order':
        g('stock_entry', 'Receipts', () => this.q(sql`select id::text as id, number, status as detail from stock_entry where purchase_order_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        g('purchase_invoice', 'Purchase invoices', () => this.q(sql`select id::text as id, number, status as detail from purchase_invoice where purchase_order_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        break;
      case 'stock_entry':
        g('purchase_order', 'Purchase order', () => this.q(sql`select o.id::text as id, o.number, o.status as detail from purchase_order o join stock_entry s on s.purchase_order_id = o.id where s.id = ${id} and s.${e}`));
        g('purchase_invoice', 'Purchase invoices', () => this.q(sql`select i.id::text as id, i.number, i.status as detail from purchase_invoice i join stock_entry s on s.purchase_order_id = i.purchase_order_id where s.id = ${id} and s.${e} order by i.created_at desc limit ${LIMIT}`));
        g('work_order', 'Work order', () => this.q(sql`select w.id::text as id, w.number, w.status as detail from work_order w join stock_entry s on s.work_order_id = w.id where s.id = ${id} and s.${e}`));
        break;
      case 'purchase_invoice':
        g('purchase_order', 'Purchase order', () => this.q(sql`select o.id::text as id, o.number, o.status as detail from purchase_order o join purchase_invoice i on i.purchase_order_id = o.id where i.id = ${id} and i.${e}`));
        g('supplier_note', 'Supplier notes', () => this.q(sql`select id::text as id, number, kind || ' · ' || status as detail from supplier_note where original_invoice_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        g('return_claim', 'Return claims', () => this.q(sql`select id::text as id, number, status as detail from supplier_return_claim where original_invoice_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        break;
      case 'work_order':
        g('sales_order', 'Sales order', () => this.q(sql`select o.id::text as id, o.number, o.status as detail from sales_order o join work_order w on w.sales_order_id = o.id where w.id = ${id} and w.${e}`));
        g('stock_entry', 'Issues and output', () => this.q(sql`select id::text as id, number, purpose || ' · ' || status as detail from stock_entry where work_order_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        g('job_work_order', 'Job work', () => this.q(sql`select id::text as id, number, kind || ' · ' || status as detail from job_work_order where work_order_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        g('ncr', 'NCRs', () => this.q(sql`select id::text as id, number, status as detail from ncr where work_order_id = ${id} and ${e} order by created_at desc limit ${LIMIT}`));
        break;
      case 'maintenance_order':
        g('machine', 'Machine', () => this.q(sql`select m.id::text as id, m.code as number, m.name as detail from machine m join maintenance_order o on o.machine_id = m.id where o.id = ${id} and o.${e}`));
        g('stock_entry', 'Spares issues', () => this.q(sql`select s.id::text as id, s.number, s.status as detail from maintenance_spare ms join stock_entry s on s.id = ms.stock_entry_id where ms.order_id = ${id} and s.${e} order by s.created_at desc limit ${LIMIT}`));
        break;
      case 'job_work_order':
        g('work_order', 'Work order', () => this.q(sql`select w.id::text as id, w.number, w.status as detail from work_order w join job_work_order j on j.work_order_id = w.id where j.id = ${id} and j.${e}`));
        break;
    }
    // Payments and vouchers use their own pages and permissions.
    const sections: Section[] = [];
    for (const grp of groups) {
      if (!can(READ[grp.kind])) continue;
      const list = rows(grp.kind, await grp.run());
      if (list.length) sections.push({ id: grp.kind, title: grp.title, rows: list });
    }
    if ((t === 'sales_invoice' || t === 'purchase_invoice') && can('accounts.settlement.read')) {
      const pay = await settlementsOf(t)();
      if (pay.length) sections.push({ id: 'settlement', title: 'Receipts and payments', rows: pay.map((r) => ({ id: r.id, number: r.number ?? 'Draft', detail: r.detail ?? '', href: `/app/accounts/settlements/${r.id}` })) });
    }
    return { sections };
  }

  // ───────────────────────── record search ─────────────────────────

  @Get('search')
  @TenantScoped()
  async search(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(60) }), query);
    const can = (p: string) => ctx.tenant.permissions.has(p);
    const tenantId = ctx.tenant.tenantId;
    const entityId = ctx.tenant.activeEntityId;
    const pat = like(q);
    const exact = q.toLowerCase();
    type Hit = RecordRow & { type: Kind; label: string; rank: number };
    const tasks: Promise<Hit[]>[] = [];
    const find = (kind: Kind, query: SQL) => {
      if (!can(READ[kind])) return;
      tasks.push(
        this.q(query).then((list) =>
          list.map((r) => ({ id: r.id, number: r.number ?? 'Draft', detail: r.detail ?? '', href: `${PAGE[kind]}/${r.id}`, type: kind, label: LABEL[kind], rank: (r.number ?? '').toLowerCase() === exact ? 0 : 1 })),
        ),
      );
    };
    // Documents are per legal entity; with "All entities" selected only the workspace-wide records are searched.
    if (entityId) {
      const docs: [Kind, string][] = [
        ['quotation', 'quotation'], ['sales_order', 'sales_order'], ['sales_invoice', 'sales_invoice'], ['sales_note', 'sales_note'],
        ['purchase_order', 'purchase_order'], ['purchase_invoice', 'purchase_invoice'], ['supplier_note', 'supplier_note'],
        ['stock_entry', 'stock_entry'], ['work_order', 'work_order'], ['job_work_order', 'job_work_order'], ['ncr', 'ncr'], ['maintenance_order', 'maintenance_order'],
      ];
      for (const [kind, table] of docs) {
        find(kind, sql`select id::text as id, number, status as detail from ${sql.raw(table)} where entity_id = ${entityId} and number ilike ${pat} order by created_at desc limit 5`);
      }
      find('voucher', sql`select id::text as id, number, coalesce(narration, status::text) as detail from journal_voucher where entity_id = ${entityId} and number ilike ${pat} order by posting_date desc limit 5`);
      find('machine', sql`select id::text as id, code as number, name as detail from machine where entity_id = ${entityId} and (code ilike ${pat} or name ilike ${pat}) order by code limit 5`);
    }
    find('item', sql`select id::text as id, code as number, name as detail from item where tenant_id = ${tenantId} and (code ilike ${pat} or name ilike ${pat} or drawing_no ilike ${pat}) order by (lower(code) = ${exact}) desc, code limit 5`);
    find('party', sql`select id::text as id, name as number, coalesce(gstin, code) as detail from party where tenant_id = ${tenantId} and (name ilike ${pat} or code ilike ${pat} or gstin ilike ${pat}) order by name limit 5`);
    find('batch', sql`select b.id::text as id, b.batch_no as number, i.code || ' · ' || b.kind as detail from batch b join item i on i.id = b.item_id where b.tenant_id = ${tenantId} and b.batch_no ilike ${pat} order by b.created_at desc limit 5`);
    const hits = (await Promise.all(tasks)).flat().sort((a, b) => a.rank - b.rank);
    return { results: hits.slice(0, 20) };
  }
}
