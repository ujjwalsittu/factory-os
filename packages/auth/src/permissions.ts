/**
 * Single catalog of permissions. Format: `module.resource.action`.
 * The roles UI renders its matrix from this list, and the API guard only accepts keys from it.
 * Add new permissions here (AGENTS.md definition of done).
 */

export const ACTIONS = [
  'read',
  'create',
  'update',
  'submit',
  'cancel',
  'approve',
  'delete',
  'export',
  'file',
  'manage',
  'configure',
  'correct',
  'retry',
] as const;
export type Action = (typeof ACTIONS)[number];

interface ResourceDef {
  module: string;
  resource: string;
  label: string;
  actions: readonly Action[];
}

/** Resources that exist today (Phase 0) plus the core ones the next phases build on. */
export const RESOURCES = [
  { module: 'settings', resource: 'email', label: 'Email delivery', actions: ['read', 'retry'] },
  { module:'accounts', resource:'withholding', label:'Withholding and TCS accounting', actions:['read','create','submit','cancel','export','configure','approve','correct'] },
  { module:'accounts', resource:'bank_reconciliation', label:'Bank reconciliation', actions:['read','create','submit','cancel','export','configure','approve'] },
  { module:'accounts', resource:'bank_charge', label:'Bank charges', actions:['read','create','submit','cancel','export'] },
  {module:'compliance',resource:'sandbox_operation',label:'Sandbox operations',actions:['read','export']},
  {module:'compliance',resource:'sandbox_connection',label:'Sandbox connections',actions:['read','manage']},
  {module:'compliance',resource:'sandbox_irn',label:'Sandbox IRN',actions:['create','submit','update','cancel']},
  {module:'compliance',resource:'sandbox_ewb',label:'Sandbox EWB',actions:['create','submit','update','cancel']},
  {module:'compliance',resource:'sandbox_partb',label:'Sandbox transport and Part B',actions:['create','update']},
  {module:'compliance',resource:'sandbox_extension',label:'Sandbox EWB extension',actions:['update']},
  {module:'compliance',resource:'sandbox_detachment',label:'Detach sandbox exercise',actions:['approve']},
  {module:'compliance',resource:'sandbox_valuation',label:'Sandbox return valuation',actions:['approve']},
  { module: 'settings', resource: 'entity', label: 'Legal entities & GST registrations', actions: ['read', 'create', 'update', 'delete'] },
  { module: 'settings', resource: 'user', label: 'Users & invitations', actions: ['read', 'create', 'update', 'delete'] },
  { module: 'settings', resource: 'role', label: 'Roles & permissions', actions: ['read', 'create', 'update', 'delete'] },
  { module: 'settings', resource: 'audit', label: 'Audit log', actions: ['read', 'export'] },
  { module: 'settings', resource: 'support_access', label: 'Support access (approve temporary read-only operator access)', actions: ['read', 'configure', 'approve', 'cancel'] },
  { module: 'settings', resource: 'integration', label: 'Integrations (GSP, Tally, IoT)', actions: ['read', 'manage'] },
  { module: 'masters', resource: 'item', label: 'Items', actions: ['read', 'create', 'update', 'delete', 'export'] },
  { module: 'masters', resource: 'party', label: 'Customers & suppliers', actions: ['read', 'create', 'update', 'delete', 'export'] },
  { module: 'masters', resource: 'uom', label: 'Units of measure', actions: ['read', 'create', 'update'] },
  { module: 'masters', resource: 'hsn', label: 'HSN / SAC codes & GST rates', actions: ['read', 'create', 'update'] },
  { module: 'inventory', resource: 'warehouse', label: 'Warehouses & locations', actions: ['read', 'create', 'update'] },
  { module: 'inventory', resource: 'batch', label: 'Batches & heat numbers', actions: ['read', 'update'] },
  { module: 'inventory', resource: 'stock_entry', label: 'Stock entries', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'inventory', resource: 'report', label: 'Stock balance, ledger & customer material statements', actions: ['read', 'export'] },
  { module: 'ehs', resource: 'waste', label: 'Waste register (generation & disposal)', actions: ['read', 'create', 'cancel', 'export'] },
  { module: 'buying', resource: 'purchase_order', label: 'Purchase orders', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'buying', resource: 'purchase_invoice', label: 'Purchase invoices', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'buying', resource: 'return_claim', label: 'Supplier return claims', actions: ['read','create','update','submit','approve','cancel','export'] },
  { module: 'buying', resource: 'return_movement', label: 'Supplier return dispatch and receipts', actions: ['read','create','cancel'] },
  { module: 'buying', resource: 'return_resolution', label: 'Supplier return resolutions', actions: ['read','create','cancel'] },
  { module: 'buying', resource: 'supplier_note', label: 'Supplier credit/debit notes', actions: ['read','create','update','submit','cancel'] },
  { module: 'buying', resource: 'return_policy', label: 'Supplier return policies', actions: ['read','update'] },
  { module: 'buying', resource: 'landed_cost', label: 'Landed cost & Bill of Entry', actions: ['read', 'create', 'submit', 'cancel'] },
  { module: 'selling', resource: 'quotation', label: 'Quotations', actions: ['read', 'create', 'submit', 'cancel', 'export'] },
  { module: 'selling', resource: 'sales_order', label: 'Sales orders', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'selling', resource: 'sales_note', label: 'Customer credit/debit notes', actions: ['read', 'create', 'update', 'submit', 'cancel'] },
  { module: 'selling', resource: 'sales_invoice', label: 'Sales invoices', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'manufacturing', resource: 'work_centre', label: 'Work centres and machines', actions: ['read', 'create', 'update'] },
  { module: 'manufacturing', resource: 'bom', label: 'Bills of materials', actions: ['read', 'create', 'update', 'submit', 'cancel'] },
  { module: 'manufacturing', resource: 'genealogy', label: 'Genealogy and recall', actions: ['read', 'export'] },
  { module: 'manufacturing', resource: 'work_order', label: 'Work orders', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'manufacturing', resource: 'job_card', label: 'Job cards', actions: ['read', 'create', 'update', 'submit'] },
  { module: 'manufacturing', resource: 'job_work', label: 'Job work (challans and receipts)', actions: ['read', 'create', 'submit', 'cancel'] },
  { module: 'manufacturing', resource: 'schedule', label: 'Production schedule (run, move, pin)', actions: ['read', 'update'] },
  { module: 'manufacturing', resource: 'calendar', label: 'Working calendars and machine downtime', actions: ['read', 'update'] },
  { module: 'quality', resource: 'inspection', label: 'Inspections', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'quality', resource: 'plan', label: 'Inspection plans', actions: ['read', 'create', 'update', 'submit'] },
  { module: 'quality', resource: 'fai', label: 'First article inspection (AS9102)', actions: ['read', 'create', 'submit', 'approve'] },
  { module: 'quality', resource: 'ncr', label: 'Nonconformance and MRB', actions: ['read', 'create', 'submit', 'approve', 'cancel'] },
  { module: 'quality', resource: 'gauge', label: 'Gauges and calibration', actions: ['read', 'create', 'update'] },
  { module: 'quality', resource: 'attachment', label: 'Certificates and attachments', actions: ['read', 'create', 'cancel'] },
  { module: 'accounts', resource: 'account', label: 'Chart of accounts', actions: ['read', 'create', 'update'] },
  { module: 'accounts', resource: 'setup', label: 'Accounting setup and cut-over', actions: ['read', 'create', 'update', 'approve'] },
  { module: 'accounts', resource: 'report', label: 'Day book, ledger and trial balance', actions: ['read', 'export'] },
  { module: 'accounts', resource: 'settlement', label: 'Customer receipts, supplier payments and allocations', actions: ['read', 'create', 'submit', 'cancel', 'export'] },
  { module: 'accounts', resource: 'voucher', label: 'Accounting vouchers', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'compliance', resource: 'gst_return', label: 'GST returns', actions: ['read', 'create', 'approve', 'file', 'export'] },
  { module: 'compliance', resource: 'job_work_return', label: 'ITC-04 (job work return) and deadlines', actions: ['read', 'export', 'update'] },
  { module: 'compliance', resource: 'einvoice', label: 'E-invoice & e-way bill', actions: ['read', 'create', 'cancel'] },
] as const satisfies readonly ResourceDef[];

type PermissionOf<T> = T extends {
  module: infer M extends string;
  resource: infer Res extends string;
  actions: readonly (infer A extends string)[];
}
  ? `${M}.${Res}.${A}`
  : never;
export type Permission = PermissionOf<(typeof RESOURCES)[number]>;

export const ALL_PERMISSIONS: readonly Permission[] = RESOURCES.flatMap((r) =>
  r.actions.map((a) => `${r.module}.${r.resource}.${a}` as Permission),
);

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}
