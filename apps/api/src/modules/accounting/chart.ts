import {
  glAccount as account,
  accountGroup,
  accountingSettings,
} from '@factoryos/db';
import { and, eq } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import type { Tx } from './accounting-lock.js';
/**
 * Decision 071: Tally's standard groups as [name, root, parent]. A parent shares its child's root; primaries come
 * first so their ids exist when sub-groups are added. Input taxes have their own asset group because a group has one root.
 */
export const STANDARD_GROUPS = [
  ['Capital Account', 'equity', null],
  ['Reserves & Surplus', 'equity', 'Capital Account'],
  ['Loans (Liability)', 'liability', null],
  ['Bank OD A/c', 'liability', 'Loans (Liability)'],
  ['Secured Loans', 'liability', 'Loans (Liability)'],
  ['Unsecured Loans', 'liability', 'Loans (Liability)'],
  ['Current Liabilities', 'liability', null],
  ['Duties & Taxes', 'liability', 'Current Liabilities'],
  ['Provisions', 'liability', 'Current Liabilities'],
  ['Sundry Creditors', 'liability', 'Current Liabilities'],
  ['Suspense A/c', 'liability', null],
  ['Fixed Assets', 'asset', null],
  ['Investments', 'asset', null],
  ['Current Assets', 'asset', null],
  ['Bank Accounts', 'asset', 'Current Assets'],
  ['Cash-in-Hand', 'asset', 'Current Assets'],
  ['Deposits (Asset)', 'asset', 'Current Assets'],
  ['Loans & Advances (Asset)', 'asset', 'Current Assets'],
  ['Stock-in-Hand', 'asset', 'Current Assets'],
  ['Sundry Debtors', 'asset', 'Current Assets'],
  ['Input tax credits', 'asset', 'Current Assets'],
  ['Sales Accounts', 'income', null],
  ['Direct Incomes', 'income', null],
  ['Indirect Incomes', 'income', null],
  ['Purchase Accounts', 'expense', null],
  ['Direct Expenses', 'expense', null],
  ['Indirect Expenses', 'expense', null],
] as const;
export const DEFAULT_ACCOUNTS = [
  ['tds_payable', 'TDS payable', 'Duties & Taxes', 'liability'],
  ['tds_receivable', 'TDS receivable', 'Loans & Advances (Asset)', 'asset'],
  ['tcs_payable', 'TCS payable', 'Duties & Taxes', 'liability'],
  ['tcs_recoverable', 'TCS recoverable', 'Loans & Advances (Asset)', 'asset'],
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
  ['purchases', 'Service purchases', 'Purchase Accounts', 'expense'],
  ['production', 'Cost of production', 'Direct Expenses', 'expense'],
  ['wip', 'Work in progress', 'Stock-in-Hand', 'asset'],
  ['overhead_absorbed', 'Manufacturing overhead absorbed', 'Direct Expenses', 'expense'],
  ['production_variance', 'Manufacturing variance', 'Direct Expenses', 'expense'],
  ['cogs', 'Cost of goods sold', 'Direct Expenses', 'expense'],
  ['scrap', 'Scrap expense', 'Direct Expenses', 'expense'],
  /** Decision 069: the default ledger for asset purchases; a purchase invoice line can name another. */
  ['fixed_assets', 'Fixed assets', 'Fixed Assets', 'asset'],
  /** Decision 066: spares issued to maintenance orders. */
  ['maintenance', 'Repairs and maintenance (machinery)', 'Indirect Expenses', 'expense'],
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
    [`input_${t}`, `Input ${t.toUpperCase()}`, 'Input tax credits', 'asset'],
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
      'Input tax credits',
      'asset',
    ],
  ]),
] as const;
export async function seedChart(
  tx: Tx,
  ctx: TenantRequestContext,
  entityId: string,
  /** Only these roles are added (first-use steps such as the first asset invoice); all roles when omitted. */
  onlyRoles?: readonly string[],
) {
  const scope = { tenantId: ctx.tenant.tenantId, entityId };
  const groupIds = new Map(
    (await tx.select().from(accountGroup).where(eq(accountGroup.entityId, entityId))).map((g) => [g.key, g.id]),
  );
  const groupId = async (name: string, root: string, parentId: string | null) => {
    const key = `${name}:${root}`;
    if (!groupIds.has(key)) {
      // A new group gets its standard parent; an existing one keeps wherever people moved it.
      await tx.insert(accountGroup).values({ ...scope, key, name, root, parentId }).onConflictDoNothing();
      const [g] = await tx
        .select()
        .from(accountGroup)
        .where(and(eq(accountGroup.key, key), eq(accountGroup.entityId, entityId)));
      if (!g) throw new Error('Account group seed failed');
      groupIds.set(key, g.id);
    }
    return groupIds.get(key)!;
  };
  for (const [name, root, parent] of STANDARD_GROUPS)
    await groupId(name, root, parent ? await groupId(parent, root, null) : null);
  for (const [key, name, group, root] of DEFAULT_ACCOUNTS) {
    if (onlyRoles && !onlyRoles.includes(key)) continue;
    const g = { id: await groupId(group, root, null) };
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
