// Audited support access (decision 050): tenant-side controls. Normal native actor and tenant context; consent and
// policy controls need tenant-wide authority, so an x-entity-id header is refused rather than narrowing the scope.
import { type SupportGrantPage, type SupportGrantSummary, type SupportPolicy } from '@factoryos/auth';
import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { Ctx, type TenantRequestContext, TenantScoped } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { SupportProofService } from './support-access.proof.js';
import { SupportAccessStore, SupportError } from './support-access.store.js';
import { parseSupportApproval, parseSupportList, parseSupportPolicy, SupportInputError } from './support-access.types.js';

const STATUS: Record<SupportError['code'], number> = {
  SUPPORT_NOT_FOUND: 404,
  SUPPORT_INVALID_INPUT: 400,
  SUPPORT_REAUTHENTICATE: 403,
  SUPPORT_UNAVAILABLE: 403,
  SUPPORT_ENDED: 403,
  SUPPORT_CONFLICT: 409,
};

/** Only the four public codes ever leave the API; database and native errors are never echoed. */
@Catch()
export class SupportExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof SupportError) {
      const code = error.code === 'SUPPORT_NOT_FOUND' || error.code === 'SUPPORT_CONFLICT' ? 'SUPPORT_UNAVAILABLE' : error.code;
      return res.status(STATUS[error.code]).json({ code, ...(error.code === 'SUPPORT_REAUTHENTICATE' && error.reasonCode ? { reason: error.reasonCode } : {}) });
    }
    if (error instanceof SupportInputError) return res.status(400).json({ code: 'SUPPORT_INVALID_INPUT' });
    if (error instanceof HttpException) {
      const status = error.getStatus();
      return res.status(status).json({ code: status === 401 ? 'SUPPORT_REAUTHENTICATE' : status === 400 ? 'SUPPORT_INVALID_INPUT' : 'SUPPORT_UNAVAILABLE' });
    }
    if (process.env.SUPPORT_DEBUG) console.error(error);
    return res.status(503).json({ code: 'SUPPORT_UNAVAILABLE' });
  }
}

type Permission = 'read' | 'configure' | 'approve' | 'cancel';
/** Tenant-wide authority only: entity-scoped roles can never approve tenant support access. */
export function requireTenantWide(ctx: TenantRequestContext, req: Request, permission: Permission) {
  if (req.get('x-entity-id') !== undefined) throw new SupportError('SUPPORT_INVALID_INPUT', 'entity-header');
  if (ctx.tenant.activeEntityId !== null || !ctx.tenant.permissions.has(`settings.support_access.${permission}`)) throw new SupportError('SUPPORT_UNAVAILABLE', 'permission');
}

@Controller('support-access')
@UseFilters(SupportExceptionFilter)
export class SupportAccessController {
  constructor(
    private readonly store: SupportAccessStore,
    private readonly proof: SupportProofService,
    private readonly audit: AuditService,
  ) {}

  @Get('policy')
  @TenantScoped()
  async policy(@Ctx() ctx: TenantRequestContext, @Req() req: Request): Promise<SupportPolicy> {
    requireTenantWide(ctx, req, 'read');
    return this.store.getPolicy(ctx.tenant.tenantId);
  }

  @Patch('policy')
  @TenantScoped()
  async setPolicy(@Ctx() ctx: TenantRequestContext, @Req() req: Request, @Body() body: unknown): Promise<SupportPolicy> {
    requireTenantWide(ctx, req, 'configure');
    const { password, ...input } = parseSupportPolicy(body);
    const proof = input.enabled ? await this.proof.confirm(fromNodeHeaders(req.headers), password ?? '', ctx.user.id) : null;
    return this.store.setPolicy(ctx, input, proof, this.audit);
  }

  @Get('grants')
  @TenantScoped()
  async grants(@Ctx() ctx: TenantRequestContext, @Req() req: Request, @Query() query: unknown): Promise<SupportGrantPage> {
    requireTenantWide(ctx, req, 'read');
    return this.store.listTenant(ctx.tenant.tenantId, parseSupportList(query));
  }

  @Post('grants')
  @TenantScoped()
  @HttpCode(201)
  async approve(@Ctx() ctx: TenantRequestContext, @Req() req: Request, @Body() body: unknown): Promise<SupportGrantSummary> {
    requireTenantWide(ctx, req, 'approve');
    const input = parseSupportApproval(body);
    const proof = await this.proof.confirm(fromNodeHeaders(req.headers), input.password, ctx.user.id);
    return this.store.approve(ctx, input, proof, this.audit);
  }
}
