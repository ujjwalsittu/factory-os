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
  { module: 'settings', resource: 'entity', label: 'Legal entities & GST registrations', actions: ['read', 'create', 'update', 'delete'] },
  { module: 'settings', resource: 'user', label: 'Users & invitations', actions: ['read', 'create', 'update', 'delete'] },
  { module: 'settings', resource: 'role', label: 'Roles & permissions', actions: ['read', 'create', 'update', 'delete'] },
  { module: 'settings', resource: 'audit', label: 'Audit log', actions: ['read', 'export'] },
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
  { module: 'buying', resource: 'landed_cost', label: 'Landed cost & Bill of Entry', actions: ['read', 'create', 'submit', 'cancel'] },
  { module: 'selling', resource: 'quotation', label: 'Quotations', actions: ['read', 'create', 'submit', 'cancel', 'export'] },
  { module: 'selling', resource: 'sales_order', label: 'Sales orders', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'selling', resource: 'sales_invoice', label: 'Sales invoices', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'manufacturing', resource: 'work_order', label: 'Work orders', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'manufacturing', resource: 'job_card', label: 'Job cards', actions: ['read', 'create', 'update', 'submit'] },
  { module: 'quality', resource: 'inspection', label: 'Inspections, NCR, FAI', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'accounts', resource: 'voucher', label: 'Accounting vouchers', actions: ['read', 'create', 'submit', 'cancel', 'approve', 'export'] },
  { module: 'compliance', resource: 'gst_return', label: 'GST returns', actions: ['read', 'create', 'approve', 'file', 'export'] },
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
