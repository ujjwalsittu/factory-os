import { gstr1Sheets, gstr3bSheet, type Gstr1, type Gstr3b, type DocSummaryRow } from '@factoryos/core/gst-returns';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { zipSync } from 'fflate';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { GstReturnsService } from './gst-returns.service.js';

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const periodInput = z.object({ gstRegistrationId: z.uuid(), period });

/** Decision 074: GST returns per GSTIN and month, from the books, with maker-checker and sheet exports. */
@Controller('gst-returns')
export class GstReturnsController {
  constructor(private readonly returns: GstReturnsService) {}

  @Get()
  @RequirePermission('compliance.gst_return.read')
  list(@Ctx() ctx: TenantRequestContext) {
    return this.returns.list(entityOf(ctx));
  }

  /** The entity's GSTINs, for choosing which one a return is for. */
  @Get('registrations')
  @RequirePermission('compliance.gst_return.read')
  registrations(@Ctx() ctx: TenantRequestContext) {
    return this.returns.registrations(entityOf(ctx));
  }

  /** What the books give for a GSTIN and month right now, without saving anything. */
  @Get('preview')
  @RequirePermission('compliance.gst_return.read')
  async preview(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const { gstRegistrationId, period: p } = parse(periodInput, query);
    const { sources: _sources, ...prepared } = await this.returns.computeNow(entityOf(ctx), gstRegistrationId, p);
    return prepared;
  }

  @Post('prepare')
  @HttpCode(200)
  @RequirePermission('compliance.gst_return.create')
  prepare(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const { gstRegistrationId, period: p } = parse(periodInput, body);
    return this.returns.prepare(ctx, entityOf(ctx), gstRegistrationId, p);
  }

  @Get(':id')
  @RequirePermission('compliance.gst_return.read')
  get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.get(entityOf(ctx), id);
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequirePermission('compliance.gst_return.create')
  review(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.review(ctx, entityOf(ctx), id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('compliance.gst_return.approve')
  approve(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.returns.approve(ctx, entityOf(ctx), id);
  }

  @Post(':id/file')
  @HttpCode(200)
  @RequirePermission('compliance.gst_return.file')
  file(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { arn, filedOn } = parse(z.object({ arn: z.string().trim().min(5).max(40), filedOn: z.iso.date() }), body);
    return this.returns.file(ctx, entityOf(ctx), id, arn, filedOn);
  }

  /** Decision 074b: include a proposed amendment, or drop it with a reason. The month's returns are prepared again. */
  @Post(':id/amendments/:amendmentId/:decision')
  @HttpCode(200)
  @RequirePermission('compliance.gst_return.create')
  decide(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('amendmentId', ParseUUIDPipe) amendmentId: string, @Param('decision') decision: string, @Body() body: unknown) {
    const d = parse(z.enum(['include', 'drop']), decision);
    const { reason } = parse(z.object({ reason: z.string().trim().max(500).optional() }), body ?? {});
    return this.returns.decideAmendment(ctx, entityOf(ctx), id, amendmentId, d, reason ?? null);
  }

  /** The return's snapshot as sheets: one CSV per GSTR-1 section, or the 3B sheet, in a zip. */
  @Get(':id/export')
  @RequirePermission('compliance.gst_return.export')
  async export(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.returns.get(entityOf(ctx), id);
    const enc = new TextEncoder();
    const entries: Record<string, Uint8Array> = {};
    if (r.kind === 'gstr1') for (const s of gstr1Sheets((r.snapshot as { gstr1: Gstr1 & { documents: DocSummaryRow[] } }).gstr1)) entries[s.name] = enc.encode(s.csv);
    else entries['gstr3b.csv'] = enc.encode(gstr3bSheet((r.snapshot as { gstr3b: Gstr3b }).gstr3b));
    entries['README.txt'] = enc.encode(
      `${r.kind === 'gstr1' ? 'GSTR-1' : 'GSTR-3B'} for ${r.gstin}, ${r.period} (${r.status}).\nPrepared from FactoryOS documents; snapshot ${r.snapshotHash}.\n` +
        (r.kind === 'gstr1' ? 'The GST offline-tool JSON comes once its schema is pinned (decision 074a); key these sheets into the tool meanwhile.\n' : 'Key these figures into the GSTR-3B form on the portal.\n'),
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${r.kind}-${r.gstin}-${r.period}.zip`)}`);
    return res.send(Buffer.from(zipSync(entries, { level: 6 })));
  }
}
