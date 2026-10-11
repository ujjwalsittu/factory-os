// Audited support access (decision 050): the only two routes that accept the support selector header, both GET.
// The ordinary guard is bypassed on purpose: the real native actor is resolved here without cookie cache or session
// renewal, and nothing about the target is ever resolved through ordinary tenant shortcuts.
import { SUPPORT_HEADER, type SupportPanelResult, type SupportWorkspaceContext } from '@factoryos/auth';
import { Controller, Get, Param, Query, Req, UseFilters } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { Public } from '../../common/access.js';
import { SupportExceptionFilter } from './support-access.controller.js';
import { SupportProofService } from './support-access.proof.js';
import { SupportReadService } from './support-access.read.js';
import { SupportError } from './support-access.store.js';
import { isSupportArea, parseSupportQuery } from './support-access.types.js';

@Controller('support-access/workspace')
@UseFilters(SupportExceptionFilter)
export class SupportWorkspaceController {
  constructor(
    private readonly proof: SupportProofService,
    private readonly reads: SupportReadService,
  ) {}

  @Get('context')
  @Public()
  async context(@Req() req: Request, @Query() query: Record<string, unknown>): Promise<SupportWorkspaceContext> {
    if (Object.keys(query).length) throw new SupportError('SUPPORT_INVALID_INPUT', 'query');
    return this.reads.context(await this.proof.actor(fromNodeHeaders(req.headers)), this.selector(req));
  }

  @Get(':area')
  @Public()
  async panel(@Req() req: Request, @Param('area') area: string, @Query() query: unknown): Promise<SupportPanelResult> {
    if (!isSupportArea(area)) throw new SupportError('SUPPORT_NOT_FOUND');
    const parsed = parseSupportQuery(area, query);
    return this.reads.panel(await this.proof.actor(fromNodeHeaders(req.headers)), this.selector(req), parsed);
  }

  private selector(req: Request): string {
    const id = req.headers[SUPPORT_HEADER];
    if (typeof id !== 'string') throw new SupportError('SUPPORT_INVALID_INPUT', 'selector');
    return id;
  }
}
