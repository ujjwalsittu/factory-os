import { isValidPan, validateGstin } from '@factoryos/compliance-in';
import { type Database, hsnCode, item, party, uom } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../common/access.js';
import { AuditService } from '../common/audit.service.js';
import { DB } from '../common/tokens.js';
import { parse } from '../common/validation.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a non-negative number with up to 6 decimals'));

const uomInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, '1–8 letters or digits'),
  name: z.string().trim().min(1).max(60),
  decimals: z.number().int().min(0).max(6),
});

const hsnInput = z.object({
  code: z.string().trim().regex(/^\d{4,8}$/, 'HSN/SAC codes are 4–8 digits'),
  kind: z.enum(['hsn', 'sac']),
  description: z.string().trim().min(2).max(500),
  gstRate: z.enum(['0', '0.1', '0.25', '1.5', '3', '5', '6', '7.5', '12', '18', '28', '40']),
  cessRate: decimalString.optional(),
  effectiveFrom: z.string().date(),
});

const ITEM_TYPES = ['raw_material', 'powder', 'component', 'consumable', 'sub_assembly', 'finished_good', 'kit', 'tool', 'gauge', 'service', 'scrap'] as const;
const itemInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._/-]{0,39}$/, 'Up to 40 letters, digits, . _ / -'),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(ITEM_TYPES),
  tracking: z.enum(['none', 'batch', 'serial']).default('none'),
  stockUomId: z.string().uuid(),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/).optional().nullable(),
  revision: z.string().trim().max(10).optional().nullable(),
  /** Serial-tracked items: prefix for generated serial numbers (decision 046). */
  /** Sec 143: moulds and dies, jigs and fixtures, or tools sent as capital goods have no return limit (decision 047). */
  jobWorkExemptTool: z.boolean().optional(),
  serialPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9/-]{0,20}$/, 'Up to 20 letters, digits, - or /').optional().nullable(),
  drawingNo: z.string().trim().max(60).optional().nullable(),
  shelfLifeDays: z.number().int().positive().max(36500).optional().nullable(),
  mslLevel: z.enum(['1', '2', '2a', '3', '4', '5', '5a', '6']).optional().nullable(),
  requiresIncomingInspection: z.boolean().default(false),
  /** Decision 048: output waits in Quarantine for a final inspection; invoicing needs an approved FAI. */
  requiresFinalInspection: z.boolean().default(false),
  requiresFai: z.boolean().default(false),
  faiProcessChange: z.boolean().default(false),
  exportControlled: z.boolean().default(false),
  reorderLevel: decimalString.optional().nullable(),
  attributes: z.record(z.string(), z.string().max(200)).default({}),
  isActive: z.boolean().default(true),
});

const addressInput = z.object({
  label: z.string().trim().min(1).max(40),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(80),
  stateCode: z.string().regex(/^\d{2}$/),
  pincode: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  country: z.string().length(2).default('IN'),
});
const partyInput = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,29}$/, 'Up to 30 letters, digits, . _ -'),
    name: z.string().trim().min(2).max(200),
    isCustomer: z.boolean().default(false),
    isSupplier: z.boolean().default(false),
    isJobWorker: z.boolean().default(false),
    gstTreatment: z.enum(['registered', 'unregistered', 'composition', 'sez', 'overseas', 'deemed_export']).default('registered'),
    gstin: z.string().trim().toUpperCase().optional().nullable(),
    pan: z.string().trim().toUpperCase().optional().nullable(),
    stateCode: z.string().regex(/^\d{2}$/).optional().nullable(),
    msmeUdyam: z.string().trim().toUpperCase().regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, 'Format: UDYAM-XX-00-0000000').optional().nullable(),
    msmeCategory: z.enum(['micro', 'small', 'medium']).optional().nullable(),
    creditDays: z.number().int().min(0).max(365).optional().nullable(),
    creditLimit: z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Credit limit in rupees'))
      .optional()
      .nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().trim().max(20).optional().nullable(),
    addresses: z.array(addressInput).max(20).default([]),
    isActive: z.boolean().default(true),
  })
  .refine((p) => p.isCustomer || p.isSupplier, { message: 'Mark the party as a customer, a supplier, or both', path: ['isCustomer'] });

/** GST rules for a party: registered/SEZ/composition need a valid GSTIN; state and PAN come from it. */
function normaliseParty<T extends z.infer<typeof partyInput>>(p: T): T {
  if (p.isJobWorker && !p.isSupplier) throw new BadRequestException({ message: 'A job worker is a supplier', issues: [{ path: 'isJobWorker', message: 'Mark as supplier too' }] });
  const needsGstin = ['registered', 'composition', 'sez'].includes(p.gstTreatment);
  if (needsGstin || p.gstin) {
    if (!p.gstin) throw new BadRequestException({ message: 'GSTIN is required', issues: [{ path: 'gstin', message: 'Required for this GST treatment' }] });
    const g = validateGstin(p.gstin);
    if (!g.valid) throw new BadRequestException({ message: 'Invalid GSTIN', issues: [{ path: 'gstin', message: g.reason }] });
    return { ...p, gstin: g.gstin, stateCode: g.stateCode, pan: g.pan };
  }
  if (p.pan && !isValidPan(p.pan)) throw new BadRequestException({ message: 'Invalid PAN', issues: [{ path: 'pan', message: 'Format: ABCDE1234F' }] });
  if (p.msmeUdyam && !p.isSupplier) throw new BadRequestException({ message: 'MSME details apply to suppliers', issues: [{ path: 'msmeUdyam', message: 'Mark as supplier' }] });
  return p;
}

const pageQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Masters are tenant-wide (shared by all legal entities, docs/02). */
@Controller()
export class MastersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---- Units of measure ----
  @Get('uoms')
  @RequirePermission('masters.uom.read')
  uoms(@Ctx() ctx: TenantRequestContext) {
    return this.db.select().from(uom).where(eq(uom.tenantId, ctx.tenant.tenantId)).orderBy(asc(uom.code));
  }

  @Post('uoms')
  @RequirePermission('masters.uom.create')
  async createUom(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const input = parse(uomInput, body);
    return this.insertAudited(ctx, 'uom', (tx) => tx.insert(uom).values({ ...input, tenantId: ctx.tenant.tenantId }).onConflictDoNothing().returning(), 'A unit with this code exists');
  }

  // ---- HSN / SAC ----
  @Get('hsn-codes')
  @RequirePermission('masters.hsn.read')
  hsn(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const { q } = parse(pageQuery, query);
    const where = [eq(hsnCode.tenantId, ctx.tenant.tenantId)];
    if (q) where.push(or(ilike(hsnCode.code, `${q}%`), ilike(hsnCode.description, `%${q}%`))!);
    return this.db.select().from(hsnCode).where(and(...where)).orderBy(asc(hsnCode.code), desc(hsnCode.effectiveFrom)).limit(500);
  }

  @Post('hsn-codes')
  @RequirePermission('masters.hsn.create')
  async createHsn(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const input = parse(hsnInput, body);
    return this.insertAudited(
      ctx,
      'hsn_code',
      (tx) => tx.insert(hsnCode).values({ ...input, cessRate: input.cessRate ?? '0', tenantId: ctx.tenant.tenantId }).onConflictDoNothing().returning(),
      'This code already has a rate from that date',
    );
  }

  // ---- Items ----
  @Get('items')
  @RequirePermission('masters.item.read')
  async items(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const { q, limit, offset, type, stockOnly } = parse(pageQuery.extend({ type: z.enum(ITEM_TYPES).optional(), stockOnly: z.enum(['true', 'false']).optional() }), query);
    const where: SQL[] = [eq(item.tenantId, ctx.tenant.tenantId)];
    if (q) where.push(or(ilike(item.code, `%${q}%`), ilike(item.name, `%${q}%`), ilike(item.drawingNo, `%${q}%`))!);
    if (type) where.push(eq(item.type, type));
    if (stockOnly === 'true') where.push(eq(item.isStockItem, true));
    return this.db
      .select({ item, uomCode: uom.code, uomDecimals: uom.decimals })
      .from(item)
      .innerJoin(uom, eq(uom.id, item.stockUomId))
      .where(and(...where))
      .orderBy(asc(item.code))
      .limit(limit)
      .offset(offset)
      .then((rows) => rows.map((r) => ({ ...r.item, uomCode: r.uomCode, uomDecimals: r.uomDecimals })));
  }

  @Get('items/:id')
  @RequirePermission('masters.item.read')
  async getItem(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.db.select().from(item).where(and(eq(item.id, id), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!row) throw new NotFoundException('Item not found');
    return row;
  }

  @Post('items')
  @RequirePermission('masters.item.create')
  async createItem(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const input = parse(itemInput, body);
    await this.assertUom(ctx, input.stockUomId);
    const values = { ...input, isStockItem: input.type !== 'service', tracking: input.type === 'service' ? ('none' as const) : input.tracking, tenantId: ctx.tenant.tenantId };
    return this.insertAudited(ctx, 'item', (tx) => tx.insert(item).values(values).onConflictDoNothing().returning(), 'An item with this code exists');
  }

  @Patch('items/:id')
  @RequirePermission('masters.item.update')
  async updateItem(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = parse(itemInput.partial().omit({ code: true }), body);
    // Zod 4 fills .default() values even in .partial(): keep only the fields the caller sent, so a PATCH
    // neither resets omitted flags nor "changes" tracking to its default.
    const sent = body && typeof body === 'object' ? body : {};
    const input = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in sent)) as Partial<typeof parsed>;
    const before = await this.getItem(ctx, id);
    if (input.stockUomId && input.stockUomId !== before.stockUomId) {
      throw new BadRequestException({ message: 'Stock unit cannot change once set', issues: [{ path: 'stockUomId', message: 'Create a new item instead' }] });
    }
    if (input.tracking && input.tracking !== before.tracking) {
      throw new BadRequestException({ message: 'Tracking cannot change once set', issues: [{ path: 'tracking', message: 'Create a new item instead' }] });
    }
    return this.db.transaction(async (tx) => {
      const [after] = await tx.update(item).set({ ...input, updatedAt: new Date() }).where(eq(item.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, action: 'item.update', targetType: 'item', targetId: id, before, after }, tx);
      return after;
    });
  }

  // ---- Parties ----
  @Get('parties')
  @RequirePermission('masters.party.read')
  parties(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const { q, limit, offset, role } = parse(pageQuery.extend({ role: z.enum(['customer', 'supplier', 'job_worker']).optional() }), query);
    const where: SQL[] = [eq(party.tenantId, ctx.tenant.tenantId)];
    if (q) where.push(or(ilike(party.code, `%${q}%`), ilike(party.name, `%${q}%`), ilike(party.gstin, `%${q}%`))!);
    if (role === 'customer') where.push(eq(party.isCustomer, true));
    if (role === 'supplier') where.push(eq(party.isSupplier, true));
    if (role === 'job_worker') where.push(eq(party.isJobWorker, true));
    return this.db.select().from(party).where(and(...where)).orderBy(asc(party.name)).limit(limit).offset(offset);
  }

  @Get('parties/:id')
  @RequirePermission('masters.party.read')
  async getParty(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.db.select().from(party).where(and(eq(party.id, id), eq(party.tenantId, ctx.tenant.tenantId)));
    if (!row) throw new NotFoundException('Party not found');
    return row;
  }

  @Post('parties')
  @RequirePermission('masters.party.create')
  async createParty(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const input = normaliseParty(parse(partyInput, body));
    return this.insertAudited(ctx, 'party', (tx) => tx.insert(party).values({ ...input, tenantId: ctx.tenant.tenantId }).onConflictDoNothing().returning(), 'A party with this code exists');
  }

  @Patch('parties/:id')
  @RequirePermission('masters.party.update')
  async updateParty(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const before = await this.getParty(ctx, id);
    const merged = parse(partyInput, { ...stripNulls(before), ...(body as object), code: before.code });
    const input = normaliseParty(merged);
    return this.db.transaction(async (tx) => {
      const [after] = await tx.update(party).set({ ...input, code: before.code, updatedAt: new Date() }).where(eq(party.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, action: 'party.update', targetType: 'party', targetId: id, before, after }, tx);
      return after;
    });
  }

  private async assertUom(ctx: TenantRequestContext, id: string) {
    const [u] = await this.db.select({ id: uom.id }).from(uom).where(and(eq(uom.id, id), eq(uom.tenantId, ctx.tenant.tenantId)));
    if (!u) throw new BadRequestException({ message: 'Unknown unit', issues: [{ path: 'stockUomId', message: 'Pick a unit' }] });
  }

  /** Insert-or-conflict with an audit record in one transaction. */
  private insertAudited<T extends { id: string }>(ctx: TenantRequestContext, targetType: string, insert: (tx: Tx) => Promise<T[]>, conflictMessage: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await insert(tx);
      if (!row) throw new ConflictException(conflictMessage);
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, action: `${targetType}.create`, targetType, targetId: row.id, after: row }, tx);
      return row;
    });
  }
}

/** DB rows carry nulls and system columns; strip them before re-validating a merged update. */
function stripNulls(row: Record<string, unknown>) {
  const { id: _id, tenantId: _t, createdAt: _c, updatedAt: _u, ...rest } = row;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
}
