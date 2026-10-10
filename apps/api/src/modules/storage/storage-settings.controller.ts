import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { Ctx, PlatformAdmin, type RequestContext } from '../../common/access.js';
import { parse } from '../../common/validation.js';
import { StorageSettingsService, storageSettingsInput } from './storage-settings.service.js';

/** Platform → Storage (decision 051). SuperAdmin only; the secret is write-only. */
@Controller('platform/storage') @PlatformAdmin()
export class PlatformStorageController {
  constructor(private readonly settings: StorageSettingsService) {}

  @Get() view(@Ctx() ctx: RequestContext) {
    return this.settings.view(ctx);
  }

  @Post('test') @HttpCode(200) test(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.settings.test(ctx, parse(storageSettingsInput, body));
  }

  @Put() save(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.settings.save(ctx, parse(storageSettingsInput, body));
  }
}
