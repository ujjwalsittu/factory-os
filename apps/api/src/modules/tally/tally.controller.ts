import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { TallyService } from './tally.service.js';

const KINDS = ['group', 'ledger', 'party', 'stockgroup', 'unit', 'godown', 'stockitem', 'opening', 'stock'] as const;
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

  @Post(':id/discard')
  @RequirePermission('accounts.tally.import')
  discard(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tally.discard(ctx, entityOf(ctx), id);
  }
}
