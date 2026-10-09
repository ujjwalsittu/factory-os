// Certificates and attachments (decision 048): files live in object storage (R2), metadata here.
import { randomUUID } from 'node:crypto';
import {
  attachment,
  batch,
  calibrationEvent,
  type Database,
  fai,
  gauge,
  inspectionRecord,
  jobWorkReceipt,
  ncr,
  qualityInspection,
} from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf } from '../accounting/accounting-lock.js';
import { ALLOWED_TYPES, MAX_ATTACHMENT_BYTES, StorageService } from './storage.service.js';

export const OWNER_TYPES = ['batch', 'inspection_record', 'quality_inspection', 'fai', 'ncr', 'gauge', 'calibration_event', 'job_work_receipt'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
const KINDS = ['mtc', 'coc', 'coa', 'fai', 'cmm', 'photo', 'calibration', 'drawing', 'other'] as const;

const ownerQuery = z.object({ ownerType: z.enum(OWNER_TYPES), ownerId: z.uuid() });
const uploadQuery = ownerQuery.extend({
  kind: z.enum(KINDS),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((n) => !/[\\/\u0000-\u001f]/.test(n), 'File names cannot contain slashes or control characters'),
});

@Controller('attachments')
export class AttachmentsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('quality.attachment.read')
  async list(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const { ownerType, ownerId } = parse(ownerQuery, query);
    await assertOwner(this.db, ctx, entityId, ownerType, ownerId);
    const rows = await this.db
      .select()
      .from(attachment)
      .where(and(eq(attachment.entityId, entityId), eq(attachment.ownerType, ownerType), eq(attachment.ownerId, ownerId)))
      .orderBy(asc(attachment.createdAt));
    return { storage: this.storage.enabled, rows: rows.map(({ objectKey: _key, ...r }) => r) };
  }

  @Post()
  @RequirePermission('quality.attachment.create')
  async upload(@Ctx() ctx: TenantRequestContext, @Query() query: unknown, @Req() req: Request) {
    const entityId = entityOf(ctx);
    const input = parse(uploadQuery, query);
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('Send the file as the request body');
    if (body.length > MAX_ATTACHMENT_BYTES) throw new BadRequestException('Files are limited to 25 MB');
    const contentType = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) throw new BadRequestException(`${contentType} files are not accepted; use PDF, images, CSV/TXT, XML, XLSX or ZIP`);
    if (contentType === 'application/pdf' && body.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('This is not a PDF file');
    await assertOwner(this.db, ctx, entityId, input.ownerType, input.ownerId);
    const id = randomUUID();
    const stored = await this.storage.put(`${ctx.tenant.tenantId}/${entityId}/${input.ownerType}/${id}`, body, contentType);
    const [row] = await this.db
      .insert(attachment)
      .values({ id, tenantId: ctx.tenant.tenantId, entityId, ownerType: input.ownerType, ownerId: input.ownerId, kind: input.kind, fileName: input.fileName, contentType, size: stored.size, sha256: stored.sha256, objectKey: stored.key, createdBy: ctx.user.id })
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'attachment.upload', targetType: input.ownerType, targetId: input.ownerId, after: { attachment: id, kind: input.kind, fileName: input.fileName, size: stored.size, sha256: stored.sha256 } });
    const { objectKey: _key, ...out } = row!;
    return out;
  }

  /** S3: `{ url }`, a five-minute presigned link. Local driver: the file itself. */
  @Get(':id/download')
  @RequirePermission('quality.attachment.read')
  async download(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const a = await this.find(ctx, id);
    if (a.withdrawnAt) throw new ConflictException('This attachment was withdrawn');
    const url = await this.storage.presign(a.objectKey, a.fileName, a.contentType);
    if (url) return res.json({ url });
    res.setHeader('Content-Type', a.contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(await this.storage.get(a.objectKey));
  }

  @Post(':id/withdraw')
  @RequirePermission('quality.attachment.cancel')
  async withdraw(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) }), body);
    const a = await this.find(ctx, id);
    if (a.withdrawnAt) throw new ConflictException('Already withdrawn');
    const [row] = await this.db
      .update(attachment)
      .set({ withdrawnAt: new Date(), withdrawnBy: ctx.user.id, withdrawReason: reason })
      .where(and(eq(attachment.id, id), isNull(attachment.withdrawnAt)))
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId: a.entityId, action: 'attachment.withdraw', targetType: a.ownerType, targetId: a.ownerId, reason, after: { attachment: id } });
    const { objectKey: _key, ...out } = row!;
    return out;
  }

  private async find(ctx: TenantRequestContext, id: string) {
    const [a] = await this.db.select().from(attachment).where(and(eq(attachment.id, id), eq(attachment.entityId, entityOf(ctx))));
    if (!a) throw new NotFoundException('Attachment not found');
    return a;
  }
}

/** The owner must exist in this tenant and entity (batches are tenant-wide). */
export async function assertOwner(db: Database, ctx: TenantRequestContext, entityId: string, type: OwnerType, id: string) {
  const one = async (rows: Promise<{ id: string }[]>) => (await rows).length > 0;
  const found =
    type === 'batch'
      ? await one(db.select({ id: batch.id }).from(batch).where(and(eq(batch.id, id), eq(batch.tenantId, ctx.tenant.tenantId))))
      : type === 'inspection_record'
        ? await one(db.select({ id: inspectionRecord.id }).from(inspectionRecord).where(and(eq(inspectionRecord.id, id), eq(inspectionRecord.entityId, entityId))))
        : type === 'quality_inspection'
          ? await one(db.select({ id: qualityInspection.id }).from(qualityInspection).where(and(eq(qualityInspection.id, id), eq(qualityInspection.entityId, entityId))))
          : type === 'fai'
            ? await one(db.select({ id: fai.id }).from(fai).where(and(eq(fai.id, id), eq(fai.entityId, entityId))))
            : type === 'ncr'
              ? await one(db.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, id), eq(ncr.entityId, entityId))))
              : type === 'gauge'
                ? await one(db.select({ id: gauge.id }).from(gauge).where(and(eq(gauge.id, id), eq(gauge.entityId, entityId))))
                : type === 'calibration_event'
                  ? await one(db.select({ id: calibrationEvent.id }).from(calibrationEvent).where(and(eq(calibrationEvent.id, id), eq(calibrationEvent.entityId, entityId))))
                  : await one(db.select({ id: jobWorkReceipt.id }).from(jobWorkReceipt).where(and(eq(jobWorkReceipt.id, id), eq(jobWorkReceipt.entityId, entityId))));
  if (!found) throw new NotFoundException('The document to attach to was not found in this entity');
}
