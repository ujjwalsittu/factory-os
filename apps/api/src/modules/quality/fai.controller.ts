// FAI (AS9102) and certificate packs (decision 048).
import { batch, type Database, fai, item, user } from '@factoryos/db';
import { Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { zipSync } from 'fflate';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { StorageService } from '../storage/storage.service.js';
import { FaiService } from './fai.service.js';
import { QualityService } from './quality.service.js';

const faiInput = z.object({
  itemId: z.uuid(),
  batchId: z.uuid().nullable().optional(),
  inspectionRecordId: z.uuid().nullable().optional(),
  reason: z.enum(['first_build', 'revision_change', 'process_change', 'lapse']).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
});

@Controller('quality')
export class FaiController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly fais: FaiService,
    private readonly quality: QualityService,
    private readonly storage: StorageService,
  ) {}

  @Get('fais')
  @RequirePermission('quality.fai.read')
  list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(z.object({ status: z.enum(['draft', 'submitted', 'approved', 'rejected']).optional(), itemId: z.uuid().optional() }), query);
    const where: SQL[] = [eq(fai.entityId, entityOf(ctx))];
    if (q.status) where.push(eq(fai.status, q.status));
    if (q.itemId) where.push(eq(fai.itemId, q.itemId));
    return this.db
      .select({ f: fai, itemCode: item.code, itemName: item.name, batchNo: batch.batchNo })
      .from(fai)
      .innerJoin(item, eq(item.id, fai.itemId))
      .leftJoin(batch, eq(batch.id, fai.batchId))
      .where(and(...where))
      .orderBy(desc(fai.createdAt))
      .limit(500)
      .then((rows) => rows.map(({ f: { forms: _forms, ...f }, ...x }) => ({ ...f, ...x })));
  }

  /** Whether an item needs an FAI now, and why. */
  @Get('fai-requirement')
  @RequirePermission('quality.fai.read')
  async requirement(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const { itemId } = parse(z.object({ itemId: z.uuid() }), query);
    const [it] = await this.db.select().from(item).where(and(eq(item.id, itemId), eq(item.tenantId, ctx.tenant.tenantId)));
    if (!it) throw new NotFoundException('Item not found');
    return { itemId, revision: it.revision, requiresFai: it.requiresFai, reason: await this.fais.requirement(this.db, entityOf(ctx), it) };
  }

  @Get('fais/:id')
  @RequirePermission('quality.fai.read')
  async get(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    const [x] = await this.db
      .select({ f: fai, itemCode: item.code, itemName: item.name, batchNo: batch.batchNo })
      .from(fai)
      .innerJoin(item, eq(item.id, fai.itemId))
      .leftJoin(batch, eq(batch.id, fai.batchId))
      .where(and(eq(fai.id, id), eq(fai.entityId, entityId)));
    if (!x) throw new NotFoundException('FAI not found');
    const people = new Map((await this.db.select({ id: user.id, name: user.name }).from(user)).filter((u) => [x.f.createdBy, x.f.submittedBy, x.f.decidedBy].includes(u.id)).map((u) => [u.id, u.name]));
    return {
      ...x.f,
      itemCode: x.itemCode,
      itemName: x.itemName,
      batchNo: x.batchNo,
      preparedBy: people.get(x.f.submittedBy ?? x.f.createdBy) ?? null,
      decidedByName: x.f.decidedBy ? (people.get(x.f.decidedBy) ?? null) : null,
      forms: x.f.status === 'draft' ? await this.fais.forms(ctx, entityId, x.f) : x.f.forms,
    };
  }

  @Post('fais')
  @RequirePermission('quality.fai.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(faiInput, body);
    const f = await this.quality.run(entityId, (tx) => this.fais.createIn(tx, ctx, entityId, input));
    return this.get(ctx, f.id);
  }

  @Put('fais/:id')
  @RequirePermission('quality.fai.create')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(faiInput.omit({ itemId: true, reason: true }), body);
    await this.quality.run(entityId, (tx) => this.fais.updateIn(tx, ctx, entityId, id, input));
    return this.get(ctx, id);
  }

  @Post('fais/:id/submit')
  @RequirePermission('quality.fai.submit')
  async submit(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string) {
    const entityId = entityOf(ctx);
    await this.quality.run(entityId, (tx) => this.fais.submitIn(tx, ctx, entityId, id));
    return this.get(ctx, id);
  }

  @Post('fais/:id/approve')
  @RequirePermission('quality.fai.approve')
  async approve(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { note } = parse(z.object({ note: z.string().trim().max(1000).nullable().optional() }), body ?? {});
    await this.quality.run(entityId, (tx) => this.fais.decideIn(tx, ctx, entityId, id, 'approved', note ?? null));
    return this.get(ctx, id);
  }

  @Post('fais/:id/reject')
  @RequirePermission('quality.fai.approve')
  async reject(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { note } = parse(z.object({ note: z.string().trim().min(5, 'Give the reason (at least 5 characters)').max(1000) }), body);
    await this.quality.run(entityId, (tx) => this.fais.decideIn(tx, ctx, entityId, id, 'rejected', note));
    return this.get(ctx, id);
  }

  /** The files along a lot's genealogy, listed (JSON) or zipped with a manifest. */
  @Get('certificate-pack/:batchId')
  @RequirePermission('quality.attachment.read')
  async pack(@Ctx() ctx: TenantRequestContext, @Param('batchId', ParseUUIDPipe) batchId: string, @Query() query: unknown, @Res() res: Response) {
    const entityId = entityOf(ctx);
    const { format } = parse(z.object({ format: z.enum(['json', 'zip']).default('json') }), query);
    const { root, files } = await this.fais.packAttachments(ctx, entityId, batchId);
    const list = files.map(({ objectKey: _key, ...f }) => f);
    if (format === 'json') return res.json({ batchNo: root.batchNo, item: `${root.itemCode} ${root.itemName}`, files: list });
    const entries: Record<string, Uint8Array> = {};
    const manifest = [`Certificate pack for ${root.itemCode} ${root.batchNo}`, `Generated ${new Date().toISOString()}`, '', 'File\tKind\tAttached to\tSHA-256'];
    const used = new Set<string>();
    for (const f of files) {
      let name = `${f.kind}/${f.fileName}`;
      for (let k = 2; used.has(name); k++) name = `${f.kind}/${k}-${f.fileName}`;
      used.add(name);
      entries[name] = new Uint8Array(await this.storage.get(f.objectKey));
      manifest.push(`${name}\t${f.kind}\t${f.ownerType}\t${f.sha256}`);
    }
    entries['manifest.txt'] = new TextEncoder().encode(manifest.join('\n') + '\n');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`certificates-${root.batchNo}.zip`)}`);
    return res.send(Buffer.from(zipSync(entries, { level: 6 })));
  }
}
