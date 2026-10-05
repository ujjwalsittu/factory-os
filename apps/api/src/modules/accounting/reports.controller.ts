import { Dec } from '@factoryos/core';
import {
  glAccount as account,
  glEntry,
  journalVoucher,
  type Database,
} from '@factoryos/db';
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  Ctx,
  RequirePermission,
  type TenantRequestContext,
} from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { entityOf } from './accounting-lock.js';
const filters = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    partyId: z.uuid().optional(),
    accountId: z.uuid().optional(),
  })
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    'Start date must not be after end date',
  );
@Controller('accounts/reports')
export class AccountingReportsController {
  constructor(@Inject(DB) private readonly db: Database) {}
  async rows(ctx: TenantRequestContext) {
    return this.db
      .select({ entry: glEntry, voucher: journalVoucher })
      .from(glEntry)
      .innerJoin(journalVoucher, eq(journalVoucher.id, glEntry.voucherId))
      .where(eq(glEntry.entityId, entityOf(ctx)))
      .orderBy(
        asc(glEntry.postingDate),
        asc(glEntry.createdAt),
        asc(glEntry.id),
      );
  }
  @Get('trial-balance')
  @RequirePermission('accounts.report.read')
  async trial(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(filters, query),
      accounts = await this.db
        .select()
        .from(account)
        .where(eq(account.entityId, entityOf(ctx))),
      rows = await this.rows(ctx);
    let debit = Dec.ZERO,
      credit = Dec.ZERO;
    const result = accounts.map((a) => {
      let opening = Dec.ZERO,
        dr = Dec.ZERO,
        cr = Dec.ZERO;
      for (const { entry: e } of rows.filter(
        (r) =>
          r.entry.accountId === a.id &&
          (!q.partyId || r.entry.partyId === q.partyId) &&
          (!q.to || r.entry.postingDate <= q.to),
      )) {
        if (q.from && e.postingDate < q.from)
          opening = opening.add(e.debit).sub(e.credit);
        else {
          dr = dr.add(e.debit);
          cr = cr.add(e.credit);
        }
      }
      const balance = opening.add(dr).sub(cr);
      if (balance.gt('0')) debit = debit.add(balance);
      else credit = credit.sub(balance);
      return {
        ...a,
        opening: opening.toString(),
        debit: dr.toString(),
        credit: cr.toString(),
        balance: balance.toString(),
      };
    });
    return {
      accounts: result,
      debit: debit.toString(),
      credit: credit.toString(),
      from: q.from ?? null,
      to: q.to ?? null,
      currency: 'INR',
      precision: 6,
    };
  }
  @Get('ledger')
  @RequirePermission('accounts.report.read')
  async ledger(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(filters, query);
    if (!q.accountId) throw new NotFoundException('Choose an account');
    const [a] = await this.db
      .select()
      .from(account)
      .where(
        and(eq(account.id, q.accountId), eq(account.entityId, entityOf(ctx))),
      );
    if (!a) throw new NotFoundException('Account not found');
    const rows = (await this.rows(ctx)).filter(
      (r) =>
        r.entry.accountId === q.accountId &&
        (!q.partyId || r.entry.partyId === q.partyId) &&
        (!q.to || r.entry.postingDate <= q.to),
    );
    let opening = Dec.ZERO;
    for (const r of rows)
      if (q.from && r.entry.postingDate < q.from)
        opening = opening.add(r.entry.debit).sub(r.entry.credit);
    let balance = opening;
    const entries = rows
      .filter((r) => !q.from || r.entry.postingDate >= q.from)
      .map(({ entry, voucher }) => {
        balance = balance.add(entry.debit).sub(entry.credit);
        return {
          ...entry,
          number: voucher.number,
          narration: voucher.narration,
          sourceType: voucher.sourceType,
          sourceId: voucher.sourceId,
          reversalOf: voucher.reversalOf,
          balance: balance.toString(),
        };
      });
    return {
      account: a,
      entries,
      opening: opening.toString(),
      closing: balance.toString(),
      currency: 'INR',
      precision: 6,
      from: q.from ?? null,
      to: q.to ?? null,
    };
  }
  @Get('day-book')
  @RequirePermission('accounts.report.read')
  async dayBook(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const q = parse(filters, query),
      vouchers = await this.db
        .select()
        .from(journalVoucher)
        .where(
          and(
            eq(journalVoucher.entityId, entityOf(ctx)),
            ne(journalVoucher.status, 'draft'),
          ),
        )
        .orderBy(
          asc(journalVoucher.postingDate),
          asc(journalVoucher.submittedAt),
        );
    const rows = await this.rows(ctx);
    return vouchers
      .filter(
        (v) =>
          (!q.from || v.postingDate >= q.from) &&
          (!q.to || v.postingDate <= q.to),
      )
      .filter(
        (v) =>
          !q.partyId ||
          rows.some(
            (r) => r.entry.voucherId === v.id && r.entry.partyId === q.partyId,
          ),
      )
      .map((v) => ({
        ...v,
        debit: rows
          .filter((r) => r.entry.voucherId === v.id)
          .reduce((s, r) => s.add(r.entry.debit), Dec.ZERO)
          .toString(),
        credit: rows
          .filter((r) => r.entry.voucherId === v.id)
          .reduce((s, r) => s.add(r.entry.credit), Dec.ZERO)
          .toString(),
      }));
  }
  @Get('trial-balance/export')
  @RequirePermission('accounts.report.export')
  exportTrial(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.trial(ctx, query);
  }
  @Get('ledger/export')
  @RequirePermission('accounts.report.export')
  exportLedger(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.ledger(ctx, query);
  }
  @Get('day-book/export')
  @RequirePermission('accounts.report.export')
  exportDayBook(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.dayBook(ctx, query);
  }
}
