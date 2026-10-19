/**
 * Decision 071: plain names for the posting roles (the ledgers automatic postings use), grouped for Accounting setup
 * and shown as "Used for" on the chart. The role keys come from the API's default chart.
 */
type Role = { label: string; hint: string };
const TAXES = ['cgst', 'sgst', 'igst', 'cess'] as const;
const tax = (t: string) => t.toUpperCase();

export const ROLE_SECTIONS: { title: string; roles: Record<string, Role> }[] = [
  {
    title: 'Cash and bank',
    roles: {
      cash: { label: 'Cash', hint: 'Cash receipts and payments' },
      bank: { label: 'Bank', hint: 'Default bank for receipts and payments' },
      bank_charges: { label: 'Bank charges', hint: 'Fees the bank deducts' },
    },
  },
  {
    title: 'Sales and receivables',
    roles: {
      sales: { label: 'Sales', hint: 'Income from sales invoices' },
      debtors: { label: 'Trade receivables', hint: 'What customers owe' },
    },
  },
  {
    title: 'Purchases and payables',
    roles: {
      creditors: { label: 'Trade payables', hint: 'What suppliers are owed' },
      purchases: { label: 'Service purchases', hint: 'Purchase invoice lines that are not stock' },
      fixed_assets: { label: 'Fixed assets', hint: 'Default ledger for asset purchases' },
      grni: { label: 'Goods received not invoiced', hint: 'Receipts waiting for the supplier invoice' },
      price_variance: { label: 'Purchase price variance', hint: 'Invoice price different from the receipt' },
      pending_returns: { label: 'Pending supplier returns', hint: 'Goods sent back, credit not yet received' },
      return_variance: { label: 'Purchase return variance', hint: 'Return value different from its cost' },
      landed_clearing: { label: 'Landed cost clearing', hint: 'Freight and duty waiting to be added to stock' },
      customs_clearing: { label: 'Customs tax clearing', hint: 'Import tax paid at customs' },
    },
  },
  {
    title: 'GST and other taxes',
    roles: {
      ...Object.fromEntries(
        [
          ...TAXES.map((t) => [`input_${t}`, { label: `Input ${tax(t)}`, hint: `${tax(t)} credit on purchases` }]),
          ...TAXES.map((t) => [`output_${t}`, { label: `Output ${tax(t)}`, hint: `${tax(t)} charged on sales` }]),
          ...TAXES.map((t) => [`rcm_${t}`, { label: `RCM payable ${tax(t)}`, hint: `${tax(t)} you pay under reverse charge` }]),
          ...TAXES.map((t) => [
            `pending_${t}`,
            { label: `RCM credit pending ${tax(t)}`, hint: `Reverse-charge ${tax(t)} credit not yet claimable` },
          ]),
        ],
      ),
      noncreditable_tax: { label: 'Non-creditable tax', hint: 'Tax that cannot be claimed as credit' },
      tds_payable: { label: 'TDS payable', hint: 'Tax deducted from payments to others' },
      tds_receivable: { label: 'TDS receivable', hint: 'Tax customers deducted from your receipts' },
      tcs_payable: { label: 'TCS payable', hint: 'Tax collected on sales' },
      tcs_recoverable: { label: 'TCS recoverable', hint: 'Tax suppliers collected from you' },
    },
  },
  {
    title: 'Stock and production',
    roles: {
      inventory: { label: 'Inventory', hint: 'Value of stock on hand' },
      wip: { label: 'Work in progress', hint: 'Material issued to open work orders' },
      cogs: { label: 'Cost of goods sold', hint: 'Cost of stock shipped on invoices' },
      production: { label: 'Cost of production', hint: 'Material and labour used in production' },
      overhead_absorbed: { label: 'Manufacturing overhead absorbed', hint: 'Overhead charged into work orders' },
      production_variance: { label: 'Manufacturing variance', hint: 'Difference when a work order closes' },
      scrap: { label: 'Scrap expense', hint: 'Material written off as scrap' },
      adjustment: { label: 'Stock adjustments', hint: 'Count differences and write-offs' },
      maintenance: { label: 'Repairs and maintenance', hint: 'Spares used on maintenance orders' },
    },
  },
  {
    title: 'Other adjustments',
    roles: {
      equity: { label: 'Opening capital', hint: 'Balancing side of opening balances' },
      forex: { label: 'Foreign exchange gain or loss', hint: 'Rate differences on foreign bills' },
      rounding: { label: 'Rounding adjustment', hint: 'Paise rounding on invoices' },
    },
  },
];

const ALL: Record<string, Role> = Object.assign({}, ...ROLE_SECTIONS.map((s) => s.roles));

/** The plain name for a posting role; unknown roles fall back to a readable form of the key. */
export function roleLabel(role: string) {
  return ALL[role]?.label ?? role.replaceAll('_', ' ');
}

export const ROOTS = [
  { key: 'asset', label: 'Assets' },
  { key: 'liability', label: 'Liabilities' },
  { key: 'equity', label: 'Equity' },
  { key: 'income', label: 'Income' },
  { key: 'expense', label: 'Expenses' },
] as const;
