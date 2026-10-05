import { type Database } from '@factoryos/db';
import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Db = Database | Tx;
export function entityOf(ctx: TenantRequestContext): string {
  if (!ctx.tenant.activeEntityId) throw new BadRequestException('Select a legal entity first');
  return ctx.tenant.activeEntityId;
}
export function businessDate(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export async function lockAccounting(tx: Tx, entityId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`accounting:${entityId}`}))`);
}
