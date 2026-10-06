import {
  glAccount as account,
  accountGroup,
  accountingSettings,
} from '@factoryos/db';
import { and, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { Tx } from './accounting-lock.js';
export const DEFAULT_ACCOUNTS = [
  ['tds_payable', 'TDS payable', 'Duties & Taxes', 'liability'],
  ['tds_receivable', 'TDS receivable', 'Current Assets', 'asset'],
  ['tcs_payable', 'TCS payable', 'Duties & Taxes', 'liability'],
  ['tcs_recoverable', 'TCS recoverable', 'Current Assets', 'asset'],
  ['bank_charges', 'Bank charges', 'Indirect Expenses', 'expense'],
  ['cash', 'Cash', 'Cash-in-Hand', 'asset'],
  ['bank', 'Bank', 'Bank Accounts', 'asset'],
  ['pending_returns', 'Pending supplier returns', 'Current Assets', 'asset'],
  ['return_variance', 'Purchase return variance', 'Direct Expenses', 'expense'],
  ['inventory', 'Inventory', 'Stock-in-Hand', 'asset'],
  ['debtors', 'Trade receivables', 'Sundry Debtors', 'asset'],
  ['creditors', 'Trade payables', 'Sundry Creditors', 'liability'],
  ['grni', 'Goods received not invoiced', 'Current Liabilities', 'liability'],
  ['equity', 'Opening capital', 'Capital Account', 'equity'],
  ['sales', 'Sales', 'Sales Accounts', 'income'],
  ['purchases', 'Service purchases', 'Direct Expenses', 'expense'],
  ['production', 'Cost of production', 'Direct Expenses', 'expense'],
  ['cogs', 'Cost of goods sold', 'Direct Expenses', 'expense'],
  ['scrap', 'Scrap expense', 'Direct Expenses', 'expense'],
  ['adjustment', 'Stock adjustments', 'Indirect Expenses', 'expense'],
  ['price_variance', 'Purchase price variance', 'Direct Expenses', 'expense'],
  ['forex', 'Foreign exchange gain or loss', 'Indirect Expenses', 'expense'],
  ['rounding', 'Rounding adjustment', 'Indirect Expenses', 'expense'],
  ['noncreditable_tax', 'Non-creditable tax', 'Indirect Expenses', 'expense'],
  [
    'landed_clearing',
    'Landed cost clearing',
    'Current Liabilities',
    'liability',
  ],
  [
    'customs_clearing',
    'Customs tax clearing',
    'Current Liabilities',
    'liability',
  ],
  ...['cgst', 'sgst', 'igst', 'cess'].flatMap((t) => [
    [`input_${t}`, `Input ${t.toUpperCase()}`, 'Duties & Taxes', 'asset'],
    [`output_${t}`, `Output ${t.toUpperCase()}`, 'Duties & Taxes', 'liability'],
    [
      `rcm_${t}`,
      `RCM payable ${t.toUpperCase()}`,
      'Duties & Taxes',
      'liability',
    ],
    [
      `pending_${t}`,
      `RCM credit pending ${t.toUpperCase()}`,
      'Current Assets',
      'asset',
    ],
  ]),
] as const;
export async function seedChart(
  tx: Tx,
  ctx: TenantRequestContext,
  entityId: string,
) {
  const scope = { tenantId: ctx.tenant.tenantId, entityId };
  for (const [key, name, group, root] of DEFAULT_ACCOUNTS) {
    const groupKey = `${group}:${root}`;
    await tx
      .insert(accountGroup)
      .values({ ...scope, key: groupKey, name: group, root })
      .onConflictDoNothing();
    const [g] = await tx
      .select()
      .from(accountGroup)
      .where(
        and(
          eq(accountGroup.key, groupKey),
          eq(accountGroup.entityId, entityId),
        ),
      );
    if (!g) throw new Error('Account group seed failed');
    await tx
      .insert(account)
      .values({
        ...scope,
        code: key.toUpperCase(),
        role: key,
        name,
        groupId: g.id,
      })
      .onConflictDoNothing();
  }
  const rows = await tx
    .select()
    .from(account)
    .where(eq(account.entityId, entityId));
  const mappings = Object.fromEntries(
    rows.filter((a) => a.role).map((a) => [a.role!, a.id]),
  );
  await tx
    .insert(accountingSettings)
    .values({ ...scope, mappings })
    .onConflictDoNothing();
  const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
  if (settings && Object.keys(mappings).some(role => !settings.mappings[role]))
    await tx.update(accountingSettings).set({ mappings: { ...mappings, ...settings.mappings } }).where(eq(accountingSettings.entityId, entityId));
  return rows;
}
