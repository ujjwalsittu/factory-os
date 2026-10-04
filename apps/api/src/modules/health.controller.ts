import type { Database } from '@factoryos/db';
import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../common/access.js';
import { DB } from '../common/tokens.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @Public()
  async health() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
