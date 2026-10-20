import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import type { Database } from '@factoryos/db';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf } from '../accounting/accounting-lock.js';
import { AuditService } from '../../common/audit.service.js';
import { listBooks, setBook } from './tally-books.js';
import { DB } from '../../common/tokens.js';
import { TallyService } from './tally.service.js';
import { getVoucher, listVouchers } from './tally-vouchers.js';
import { listMappings, setLedgerItem, setVoucherType } from './tally-documents.js';
import { TALLY_DOCUMENT_KINDS } from '@factoryos/core/tally-documents';
import { ENTRY_KINDS } from './tally-entries.js';
import { switchBackPreview } from './tally-reversal.js';

const KINDS = ['group', 'ledger', 'party', 'stockgroup', 'unit', 'godown', 'stockitem', 'opening', 'stock', 'voucher', 'document'] as const;
const ACTIONS = ['new', 'link', 'update', 'unchanged', 'conflict', 'skip'] as const;
const rowsQuery = z.object({
  kind: z.enum(KINDS).optional(),
  action: z.enum(ACTIONS).optional(),
  q: z.string().trim().max(100).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const decisionsInput = z.object({
  decisions: z
    .array(z.object({ id: z.uuid(), action: z.enum(['new', 'link', 'update', 'unchanged', 'skip']), targetId: z.uuid().nullable().optional() }))
    .min(1)
    .max(2000),
});

/** Accepting Tally's opening difference names the amount, so a changed difference is never accepted blindly (decision 073). */
const commitInput = z.object({ acceptDifference: z.string().regex(/^-?\d+(\.\d{1,6})?$/).optional() });

/** Decision 072: Tally XML import for the active legal entity. */
@Controller('tally/imports')
export class TallyController {
  constructor(private readonly tally: TallyService) {}

  /** Up to 20 files of 100 MB each: XML exports, or zips of them. Nothing is written to masters here. */
  @Post()
  @RequirePermission('accounts.tally.import')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 50 * 1024 * 1024, files: 10 } }))
  read(@Ctx() ctx: TenantRequestContext, @UploadedFiles() files: { originalname: string; buffer: Buffer }[] | undefined) {
    return this.tally.read(ctx, entityOf(ctx), (files ?? []).map((f) => ({ name: f.originalname, bytes: new Uint8Array(f.buffer.buffer, f.buffer.byteOffset, f.buffer.byteLength) })));
  }

  @Get()
  @RequirePermission('accounts.tally.read')
  list(@Ctx() ctx: TenantRequestContext) {
    return this.tally.list(entityOf(ctx));
  }

  @Get(':id')
  @RequirePermission('accounts.tally.read')
  get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tally.get(entityOf(ctx), id);
  }

  @Get(':id/rows')
  @RequirePermission('accounts.tally.read')
  rows(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    return this.tally.rows(entityOf(ctx), id, parse(rowsQuery, query));
  }

  @Put(':id/rows')
  @RequirePermission('accounts.tally.import')
  decide(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tally.decide(ctx, entityOf(ctx), id, parse(decisionsInput, body).decisions);
  }

  @Post(':id/commit')
  @RequirePermission('accounts.tally.import')
  commit(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { acceptDifference } = parse(commitInput, body ?? {});
    return this.tally.commit(ctx, entityOf(ctx), id, acceptDifference);
  }

  @Post(':id/recheck')
  @RequirePermission('accounts.tally.import')
  recheck(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tally.recheck(ctx, entityOf(ctx), id);
  }

  @Post(':id/discard')
  @RequirePermission('accounts.tally.import')
  discard(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tally.discard(ctx, entityOf(ctx), id);
  }
}

const date = z.iso.date();
const historyQuery = z.object({
  from: date.optional(),
  to: date.optional(),
  type: z.string().trim().max(120).optional(),
  q: z.string().trim().max(100).optional(),
  accountId: z.uuid().optional(),
  partyId: z.uuid().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Decision 072: Tally history, read-only. These vouchers never reach the general ledger or GST. */
@Controller('tally/vouchers')
export class TallyHistoryController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @RequirePermission('accounts.tally.read')
  list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return listVouchers(this.db, entityOf(ctx), parse(historyQuery, query));
  }

  @Get(':id')
  @RequirePermission('accounts.tally.read')
  get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return getVoucher(this.db, entityOf(ctx), id);
  }
}

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const bookInput = z.object({ month: z.string().regex(monthPattern), book: z.enum(['tally', 'factoryos']), confirm: z.boolean().optional() });

/** Decision 075: which book each month is kept in, from the cut-over on. */
@Controller('tally/books')
export class TallyBooksController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly tally: TallyService,
  ) {}

  @Get()
  @RequirePermission('accounts.tally.read')
  list(@Ctx() ctx: TenantRequestContext) {
    return listBooks(this.db, entityOf(ctx), businessDate());
  }

  @Put()
  @RequirePermission('accounts.tally.import')
  set(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const { month, book, confirm } = parse(bookInput, body);
    return setBook(this.db, ctx, entityOf(ctx), this.audit, month, book, this.tally.reversal, confirm);
  }

  /** Decision 075b: the documents from Tally that switching the month back would reverse, and any that block it. */
  @Get(':month/switch-back')
  @RequirePermission('accounts.tally.read')
  switchBack(@Ctx() ctx: TenantRequestContext, @Param('month') month: string) {
    const m = parse(z.string().regex(monthPattern), month);
    return switchBackPreview(this.db, entityOf(ctx), m);
  }
}

const voucherTypeInput = z.object({ voucherType: z.string().trim().min(1).max(120), documentKind: z.enum([...TALLY_DOCUMENT_KINDS, ...ENTRY_KINDS, 'none']).nullable() });
const ledgerItemInput = z.object({ ledger: z.string().trim().min(1).max(200), itemId: z.uuid().nullable() });

/** Decision 075: what each Tally voucher type becomes, and which service item a ledger is booked as. */
@Controller('tally/mappings')
export class TallyMappingsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('accounts.tally.read')
  list(@Ctx() ctx: TenantRequestContext) {
    return listMappings(this.db, ctx.tenant.tenantId, entityOf(ctx));
  }

  @Put('voucher-types')
  @RequirePermission('accounts.tally.import')
  async voucherType(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const { voucherType, documentKind } = parse(voucherTypeInput, body);
    await this.db.transaction((tx) => setVoucherType(tx, ctx, entityOf(ctx), this.audit, voucherType, documentKind));
    return listMappings(this.db, ctx.tenant.tenantId, entityOf(ctx));
  }

  @Put('ledgers')
  @RequirePermission('accounts.tally.import')
  async ledger(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const { ledger, itemId } = parse(ledgerItemInput, body);
    await this.db.transaction((tx) => setLedgerItem(tx, ctx, entityOf(ctx), this.audit, ledger, itemId));
    return listMappings(this.db, ctx.tenant.tenantId, entityOf(ctx));
  }
}
