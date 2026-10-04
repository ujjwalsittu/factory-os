import { Dec } from '@factoryos/core';
import { type Database, item, party, stockEntry, stockLedgerEntry, uom, user, warehouse, wasteMovement } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';
import { WASTE_CATEGORIES } from './inventory.controller.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const HAZARDOUS = new Set(['metal_powder', 'coolant_oil', 'solvent']);

const qtyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a number with up to 6 decimals'));

const movementInput = z.object({
  kind: z.enum(['generated', 'disposed']),
  movementDate: z.string().date(),
  category: z.enum(WASTE_CATEGORIES),
  material: z.string().trim().min(2).max(120),
  itemId: z.string().uuid().nullable().optional(),
  qty: qtyString,
  uomId: z.string().uuid(),
  ownerPartyId: z.string().uuid().nullable().optional(),
  hazardous: z.boolean().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  sourceRef: z.string().trim().max(100).nullable().optional(),
  disposalMethod: z.enum(['returned_to_customer', 'sold', 'authorised_recycler', 'tsdf', 'other']).nullable().optional(),
  counterpartyId: z.string().uuid().nullable().optional(),
  documentNo: z.string().trim().max(60).nullable().optional(),
  consentRef: z.string().trim().max(200).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
});

function entityOf(ctx: TenantRequestContext): string {
  if (!ctx.tenant.activeEntityId) throw new BadRequestException('Select a legal entity first (waste is recorded per entity)');
  return ctx.tenant.activeEntityId;
}

const counterparty = alias(party, 'counterparty');

/** Waste register (decision 025) and per-customer material statements (decision 024). */
@Controller()
export class WasteController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Get('waste')
  @RequirePermission('ehs.waste.read')
  async movements(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(
      z.object({
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        owner: z.union([z.literal('company'), z.string().uuid()]).optional(),
        category: z.enum(WASTE_CATEGORIES).optional(),
      }),
      query,
    );
    const where: SQL[] = [eq(wasteMovement.entityId, entityId)];
    if (q.from) where.push(gte(wasteMovement.movementDate, q.from));
    if (q.to) where.push(lte(wasteMovement.movementDate, q.to));
    if (q.category) where.push(eq(wasteMovement.category, q.category));
    if (q.owner === 'company') where.push(isNull(wasteMovement.ownerPartyId));
    else if (q.owner) where.push(eq(wasteMovement.ownerPartyId, q.owner));
    return this.db
      .select({
        movement: wasteMovement,
        uomCode: uom.code,
        ownerName: party.name,
        counterpartyName: counterparty.name,
        stockEntryNumber: stockEntry.number,
        createdByName: user.name,
      })
      .from(wasteMovement)
      .innerJoin(uom, eq(uom.id, wasteMovement.uomId))
      .innerJoin(user, eq(user.id, wasteMovement.createdBy))
      .leftJoin(party, eq(party.id, wasteMovement.ownerPartyId))
      .leftJoin(counterparty, eq(counterparty.id, wasteMovement.counterpartyId))
      .leftJoin(stockEntry, eq(stockEntry.id, wasteMovement.stockEntryId))
      .where(and(...where))
      .orderBy(desc(wasteMovement.movementDate), desc(wasteMovement.createdAt))
      .limit(1000)
      .then((rows) => rows.map((r) => ({ ...r.movement, uomCode: r.uomCode, ownerName: r.ownerName, counterpartyName: r.counterpartyName, stockEntryNumber: r.stockEntryNumber, createdByName: r.createdByName })));
  }

  /** Waste on hand by category × material × owner, with how long it has been held (hazardous storage limits). */
  @Get('waste/balances')
  @RequirePermission('ehs.waste.read')
  async balances(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const rows = await this.db.execute<{
      category: string;
      material: string;
      owner_party_id: string | null;
      owner_name: string | null;
      uom_code: string;
      hazardous: boolean;
      generated: string;
      disposed: string;
      balance: string;
      first_generated: string;
    }>(sql`
      select w.category, w.material, w.owner_party_id, p.name as owner_name, u.code as uom_code, bool_or(w.hazardous) as hazardous,
             sum(case when w.kind = 'generated' then w.qty else 0 end) as generated,
             sum(case when w.kind = 'disposed' then w.qty else 0 end) as disposed,
             sum(case when w.kind = 'generated' then w.qty else -w.qty end) as balance,
             min(w.movement_date) filter (where w.kind = 'generated') as first_generated
      from waste_movement w
      join uom u on u.id = w.uom_id
      left join party p on p.id = w.owner_party_id
      where w.entity_id = ${entityId} and w.cancelled_at is null
      group by w.category, w.material, w.owner_party_id, p.name, u.code
      order by w.category, w.material, p.name nulls first`);
    return rows.rows.map((r) => ({
      category: r.category,
      material: r.material,
      ownerPartyId: r.owner_party_id,
      ownerName: r.owner_name,
      uomCode: r.uom_code,
      hazardous: r.hazardous,
      generated: r.generated,
      disposed: r.disposed,
      balance: r.balance,
      firstGenerated: r.first_generated,
    }));
  }

  @Post('waste')
  @RequirePermission('ehs.waste.create')
  async record(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(movementInput, body);
    const tenantId = ctx.tenant.tenantId;
    const qty = Dec.of(input.qty);
    if (!qty.gt(Dec.ZERO)) throw new BadRequestException({ message: 'Quantity must be positive', issues: [{ path: 'qty', message: 'Must be more than 0' }] });

    const [u] = await this.db.select({ id: uom.id }).from(uom).where(and(eq(uom.id, input.uomId), eq(uom.tenantId, tenantId)));
    if (!u) throw new BadRequestException({ message: 'Unknown unit', issues: [{ path: 'uomId', message: 'Pick a unit' }] });
    if (input.ownerPartyId) {
      const [o] = await this.db.select({ isCustomer: party.isCustomer }).from(party).where(and(eq(party.id, input.ownerPartyId), eq(party.tenantId, tenantId)));
      if (!o?.isCustomer) throw new BadRequestException({ message: 'The owner must be a customer', issues: [{ path: 'ownerPartyId', message: 'Pick a customer' }] });
    }
    if (input.itemId) {
      const [i] = await this.db.select({ id: item.id }).from(item).where(and(eq(item.id, input.itemId), eq(item.tenantId, tenantId)));
      if (!i) throw new BadRequestException('Unknown item');
    }
    if (input.warehouseId) {
      const [w] = await this.db.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.id, input.warehouseId), eq(warehouse.entityId, entityId)));
      if (!w) throw new BadRequestException('Warehouse not in this entity');
    }

    if (input.kind === 'disposed') {
      if (!input.disposalMethod) throw new BadRequestException({ message: 'How was it disposed of?', issues: [{ path: 'disposalMethod', message: 'Required' }] });
      if (input.disposalMethod === 'returned_to_customer') {
        if (!input.ownerPartyId) throw new BadRequestException({ message: 'Only customer-owned waste can be returned to a customer', issues: [{ path: 'disposalMethod', message: 'Choose another method' }] });
        input.counterpartyId = input.ownerPartyId;
      } else if (input.ownerPartyId && !input.consentRef) {
        throw new BadRequestException({
          message: "Disposing of a customer's waste needs their consent",
          issues: [{ path: 'consentRef', message: 'Record the consent (email / letter reference)' }],
        });
      }
      if (input.counterpartyId) {
        const [c] = await this.db.select({ id: party.id }).from(party).where(and(eq(party.id, input.counterpartyId), eq(party.tenantId, tenantId)));
        if (!c) throw new BadRequestException('Unknown recipient');
      }
      if (['sold', 'authorised_recycler', 'tsdf'].includes(input.disposalMethod) && !input.documentNo) {
        throw new BadRequestException({ message: 'Record the invoice / challan / manifest number', issues: [{ path: 'documentNo', message: 'Required for this method' }] });
      }
    } else if (input.disposalMethod || input.counterpartyId || input.consentRef) {
      throw new BadRequestException('Disposal details only apply to disposals');
    }

    return this.db.transaction(async (tx) => {
      if (input.kind === 'disposed') {
        const bal = await this.balanceOf(tx, entityId, input.category, input.material, input.ownerPartyId ?? null);
        if (bal.lt(qty)) {
          throw new BadRequestException({ message: `Only ${bal.toFixed(3)} of this waste is on hand`, issues: [{ path: 'qty', message: `At most ${bal.toFixed(3)}` }] });
        }
      }
      const [row] = await tx
        .insert(wasteMovement)
        .values({
          ...input,
          qty: qty.toString(),
          hazardous: input.hazardous ?? HAZARDOUS.has(input.category),
          tenantId,
          entityId,
          createdBy: ctx.user.id,
        })
        .returning();
      await this.audit.record(ctx, { tenantId, entityId, action: `waste.${input.kind}`, targetType: 'waste_movement', targetId: row!.id, after: row }, tx);
      return row;
    });
  }

  @Post('waste/:id/cancel')
  @RequirePermission('ehs.waste.cancel')
  async cancel(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) }), body);
    return this.db.transaction(async (tx) => {
      const [w] = await tx.select().from(wasteMovement).where(and(eq(wasteMovement.id, id), eq(wasteMovement.entityId, entityId))).for('update');
      if (!w) throw new NotFoundException('Waste record not found');
      if (w.cancelledAt) throw new ConflictException('Already cancelled');
      if (w.stockEntryId) throw new ConflictException('This waste came from a scrap stock entry; cancel that entry instead');
      if (w.kind === 'generated') {
        const bal = await this.balanceOf(tx, entityId, w.category, w.material, w.ownerPartyId);
        if (bal.lt(w.qty)) throw new ConflictException('Some of this waste has already been disposed of. Cancel the disposal first.');
      }
      await tx.update(wasteMovement).set({ cancelledAt: new Date(), cancelledBy: ctx.user.id, cancelReason: reason }).where(eq(wasteMovement.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'waste.cancel', targetType: 'waste_movement', targetId: id, reason }, tx);
      return { ok: true };
    });
  }

  /**
   * Customer material statement for a period: what the customer sent, what was consumed, returned,
   * scrapped and adjusted, and what we still hold, per item and batch; plus their waste.
   */
  @Get('reports/customer-material')
  @RequirePermission('inventory.report.read')
  async statement(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { partyId, from, to } = parse(z.object({ partyId: z.string().uuid(), from: z.string().date(), to: z.string().date() }), query);
    if (from > to) throw new BadRequestException('"From" is after "to"');
    const [customer] = await this.db.select().from(party).where(and(eq(party.id, partyId), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!customer) throw new NotFoundException('Customer not found');

    // Transfers between our warehouses net to zero and are left out of the movement columns.
    const summary = await this.db.execute<Record<string, string>>(sql`
      select i.id as item_id, i.code as item_code, i.name as item_name, u.code as uom_code,
             s.batch_id, b.batch_no, b.heat_no,
             coalesce(sum(s.qty) filter (where s.posting_date < ${from}), 0) as opening,
             coalesce(sum(s.qty) filter (where s.posting_date between ${from} and ${to} and e.purpose = 'receipt'), 0) as received,
             coalesce(-sum(s.qty) filter (where s.posting_date between ${from} and ${to} and e.purpose = 'issue'), 0) as consumed,
             coalesce(-sum(s.qty) filter (where s.posting_date between ${from} and ${to} and e.purpose = 'return'), 0) as returned,
             coalesce(-sum(s.qty) filter (where s.posting_date between ${from} and ${to} and e.purpose = 'scrap'), 0) as scrapped,
             coalesce(sum(s.qty) filter (where s.posting_date between ${from} and ${to} and e.purpose = 'adjustment'), 0) as adjusted,
             coalesce(sum(s.qty) filter (where s.posting_date <= ${to}), 0) as closing
      from stock_ledger_entry s
      join stock_entry e on e.id = s.voucher_id
      join item i on i.id = s.item_id
      join uom u on u.id = i.stock_uom_id
      left join batch b on b.id = s.batch_id
      where s.entity_id = ${entityId} and s.owner_party_id = ${partyId} and s.posting_date <= ${to}
      group by i.id, i.code, i.name, u.code, s.batch_id, b.batch_no, b.heat_no
      order by i.code, b.batch_no`);

    const movements = await this.db
      .select({
        postingDate: stockLedgerEntry.postingDate,
        number: stockEntry.number,
        entryId: stockEntry.id,
        purpose: stockEntry.purpose,
        reference: stockEntry.reference,
        itemCode: item.code,
        batchNo: sql<string | null>`(select b.batch_no from batch b where b.id = "stock_ledger_entry"."batch_id")`,
        qty: stockLedgerEntry.qty,
        isReversal: stockLedgerEntry.isReversal,
      })
      .from(stockLedgerEntry)
      .innerJoin(stockEntry, eq(stockEntry.id, stockLedgerEntry.voucherId))
      .innerJoin(item, eq(item.id, stockLedgerEntry.itemId))
      .where(
        and(
          eq(stockLedgerEntry.entityId, entityId),
          eq(stockLedgerEntry.ownerPartyId, partyId),
          gte(stockLedgerEntry.postingDate, from),
          lte(stockLedgerEntry.postingDate, to),
          sql`${stockEntry.purpose} <> 'transfer'`,
        ),
      )
      .orderBy(asc(stockLedgerEntry.postingDate), asc(stockLedgerEntry.seq));

    const waste = await this.db.execute<Record<string, string>>(sql`
      select w.category, w.material, u.code as uom_code,
             coalesce(sum(case when w.kind = 'generated' then w.qty else -w.qty end) filter (where w.movement_date < ${from}), 0) as opening,
             coalesce(sum(w.qty) filter (where w.kind = 'generated' and w.movement_date between ${from} and ${to}), 0) as generated,
             coalesce(sum(w.qty) filter (where w.kind = 'disposed' and w.disposal_method = 'returned_to_customer' and w.movement_date between ${from} and ${to}), 0) as returned,
             coalesce(sum(w.qty) filter (where w.kind = 'disposed' and w.disposal_method <> 'returned_to_customer' and w.movement_date between ${from} and ${to}), 0) as disposed_with_consent,
             coalesce(sum(case when w.kind = 'generated' then w.qty else -w.qty end) filter (where w.movement_date <= ${to}), 0) as pending
      from waste_movement w join uom u on u.id = w.uom_id
      where w.entity_id = ${entityId} and w.owner_party_id = ${partyId} and w.cancelled_at is null and w.movement_date <= ${to}
      group by w.category, w.material, u.code
      order by w.category, w.material`);

    const camel = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()), v]));
    return {
      customer: { id: customer.id, name: customer.name, gstin: customer.gstin, code: customer.code },
      from,
      to,
      items: summary.rows.map(camel),
      movements,
      waste: waste.rows.map(camel),
    };
  }

  private async balanceOf(tx: Tx, entityId: string, category: string, material: string, owner: string | null): Promise<Dec> {
    // Serialise disposals of the same waste stream.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`waste:${entityId}:${category}:${material}:${owner ?? ''}`}))`);
    const [r] = await tx
      .execute<{ balance: string }>(sql`
        select coalesce(sum(case when kind = 'generated' then qty else -qty end), 0) as balance
        from waste_movement
        where entity_id = ${entityId} and category = ${category} and material = ${material}
          and owner_party_id is not distinct from ${owner} and cancelled_at is null`)
      .then((x) => x.rows);
    return Dec.of(r!.balance);
  }
}
