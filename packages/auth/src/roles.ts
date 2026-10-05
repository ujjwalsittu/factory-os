import { ALL_PERMISSIONS, type Permission } from './permissions.js';

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  permissions: readonly Permission[];
}

const all = (predicate: (p: Permission) => boolean): Permission[] => ALL_PERMISSIONS.filter(predicate);
const inModule = (...modules: string[]) => (p: Permission) => modules.some((m) => p.startsWith(`${m}.`));
const readOnly = (p: Permission) => p.endsWith('.read');

/**
 * Seeded into every tenant. System roles can be copied but not edited, so upgrades can extend them.
 * See docs/15-tenancy-rbac-auth.md §3.
 */
export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full access to the tenant, including deleting entities.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'administrator',
    name: 'Administrator',
    description: 'Users, roles, entities and settings. No statutory filing.',
    permissions: all((p) => inModule('settings', 'masters')(p) || readOnly(p)),
  },
  {
    key: 'finance_controller',
    name: 'Finance Controller',
    description: 'All accounts and compliance, including filing GST returns.',
    permissions: all((p) => inModule('accounts', 'compliance')(p) || p.startsWith('selling.sales_note.') || readOnly(p)),
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Vouchers and invoices; prepares returns but cannot approve or file them.',
    permissions: all(
      (p) =>
        readOnly(p) ||
        (inModule('accounts', 'selling', 'buying')(p) && /\.(create|submit|export)$/.test(p)) ||
        p === 'compliance.gst_return.create' ||
        p === 'compliance.gst_return.export' ||
        p === 'compliance.einvoice.create',
    ),
  },
  {
    key: 'purchase',
    name: 'Purchase',
    description: 'Suppliers, purchase orders and receipts.',
    permissions: all((p) => p.startsWith('buying.') || p.startsWith('masters.') || p === 'inventory.stock_entry.read'),
  },
  {
    key: 'sales',
    name: 'Sales',
    description: 'Customers, quotations, orders and draft invoices.',
    permissions: all(
      (p) =>
        p.startsWith('masters.party.') ||
        p.startsWith('selling.quotation.') ||
        ['selling.sales_note.read', 'selling.sales_note.create', 'selling.sales_note.update', 'selling.sales_order.read', 'selling.sales_order.create', 'selling.sales_order.submit', 'selling.sales_invoice.read', 'selling.sales_invoice.create'].includes(p),
    ),
  },
  {
    key: 'stores',
    name: 'Stores',
    description: 'Stock receipts, issues, transfers, counts and the waste register.',
    permissions: all((p) => p.startsWith('inventory.') || p.startsWith('ehs.') || p === 'masters.item.read' || p === 'masters.party.read'),
  },
  {
    key: 'production_planner',
    name: 'Production Planner',
    description: 'BOMs, routings, work orders and scheduling.',
    permissions: all((p) => p.startsWith('manufacturing.') || p === 'masters.item.read' || p === 'inventory.stock_entry.read'),
  },
  {
    key: 'operator',
    name: 'Operator',
    description: 'Own job cards on the shop floor.',
    permissions: ['manufacturing.job_card.read', 'manufacturing.job_card.update', 'manufacturing.job_card.submit'],
  },
  {
    key: 'quality',
    name: 'Quality',
    description: 'Inspections, NCR, FAI, calibration and recording scrap/waste.',
    permissions: all((p) => p.startsWith('quality.') || p === 'masters.item.read' || p === 'ehs.waste.read' || p === 'ehs.waste.create'),
  },
  {
    key: 'auditor',
    name: 'Auditor (read-only)',
    description: 'Read and export everything. No changes.',
    permissions: all((p) => readOnly(p) || p.endsWith('.export')),
  },
];
