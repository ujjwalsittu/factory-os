import {
  FileUp,
  Cable,
  History,
  Inbox,
  ArrowLeftRight,
  BadgePercent,
  Banknote,
  BarChart3,
  Boxes,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CircuitBoard,
  ClipboardCheck,
  Clock,
  Cog,
  Contact,
  Cpu,
  Factory,
  FileCheck2,
  FileSpreadsheet,
  FlaskConical,
  FolderKanban,
  GanttChart,
  Gauge,
  GitBranch,
  GraduationCap,
  Handshake,
  Home,
  IndianRupee,
  KeyRound,
  Landmark,
  LifeBuoy,
  ListChecks,
  ListTree,
  OctagonAlert,
  Package,
  ReceiptText,
  Recycle,
  Router,
  Ruler,
  Satellite,
  ScanSearch,
  ScrollText,
  SearchCheck,
  ShieldCheck,
  Ship,
  ShoppingCart,
  Store,
  Tags,
  Timer,
  Truck,
  Users,
  Wallet,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/** Menu area ids; the API accepts exactly these for closed areas (apps/api preferences.controller.ts). */
export type AreaId = 'sell' | 'buy' | 'stock' | 'make' | 'quality' | 'machines' | 'services' | 'accounts' | 'settings';

export interface NavItem {
  /** Menu link: a path, optionally with the parties role filter (`?role=customer`). */
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  /** Permission is evaluated for the active entity (inventory, masters) rather than tenant-wide. */
  entityScoped?: boolean;
}

export interface NavArea {
  id: AreaId;
  label: string;
  items: NavItem[];
}

export const HOME: NavItem = { href: '/app', label: 'My work', icon: Home };

/** Decision 076: everything waiting on me, across my entities. Anyone may open it; each source checks its own permission. */
export const APPROVALS: NavItem = { href: '/app/approvals', label: 'Approvals', icon: Inbox };

/** The menu, by area of work (decision 068). Every page a person opens from the menu appears here once. */
export const AREAS: NavArea[] = [
  {
    id: 'sell',
    label: 'Sell',
    items: [
      { href: '/app/selling/quotations', label: 'Quotations', icon: FileSpreadsheet, permission: 'selling.quotation.read', entityScoped: true },
      { href: '/app/selling/orders', label: 'Sales orders', icon: Truck, permission: 'selling.sales_order.read', entityScoped: true },
      { href: '/app/selling/invoices', label: 'Sales invoices', icon: ReceiptText, permission: 'selling.sales_invoice.read', entityScoped: true },
      { href: '/app/selling/notes', label: 'Credit/debit notes', icon: ReceiptText, permission: 'selling.sales_note.read', entityScoped: true },
      { href: '/app/masters/parties?role=customer', label: 'Customers', icon: Contact, permission: 'masters.party.read', entityScoped: true },
    ],
  },
  {
    id: 'buy',
    label: 'Buy',
    items: [
      { href: '/app/buying/orders', label: 'Purchase orders', icon: ShoppingCart, permission: 'buying.purchase_order.read', entityScoped: true },
      { href: '/app/buying/inspections', label: 'Incoming inspection', icon: ScanSearch, permission: 'quality.inspection.read', entityScoped: true },
      { href: '/app/buying/invoices', label: 'Purchase invoices', icon: ReceiptText, permission: 'buying.purchase_invoice.read', entityScoped: true },
      { href: '/app/buying/supplier-notes', label: 'Supplier notes', icon: ReceiptText, permission: 'buying.supplier_note.read', entityScoped: true },
      { href: '/app/buying/return-claims', label: 'Return claims', icon: ReceiptText, permission: 'buying.return_claim.read', entityScoped: true },
      { href: '/app/buying/landed-costs', label: 'Landed cost', icon: Ship, permission: 'buying.landed_cost.read', entityScoped: true },
      { href: '/app/masters/parties?role=supplier', label: 'Suppliers', icon: Store, permission: 'masters.party.read', entityScoped: true },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    items: [
      { href: '/app/inventory/entries', label: 'Stock entries', icon: ArrowLeftRight, permission: 'inventory.stock_entry.read', entityScoped: true },
      { href: '/app/inventory/balance', label: 'Stock balance', icon: Boxes, permission: 'inventory.report.read', entityScoped: true },
      { href: '/app/inventory/ledger', label: 'Stock ledger', icon: ScrollText, permission: 'inventory.report.read', entityScoped: true },
      { href: '/app/inventory/batches', label: 'Batches & serials', icon: Tags, permission: 'inventory.batch.read', entityScoped: true },
      { href: '/app/inventory/remnants', label: 'Remnants', icon: Ruler, permission: 'inventory.batch.read', entityScoped: true },
      { href: '/app/inventory/customer-material', label: 'Customer material', icon: Handshake, permission: 'inventory.report.read', entityScoped: true },
      { href: '/app/inventory/warehouses', label: 'Warehouses', icon: Warehouse, permission: 'inventory.warehouse.read', entityScoped: true },
      { href: '/app/masters/items', label: 'Items', icon: Package, permission: 'masters.item.read', entityScoped: true },
      { href: '/app/masters/units', label: 'Units & HSN/SAC', icon: Ruler, permission: 'masters.uom.read', entityScoped: true },
      { href: '/app/ehs/waste', label: 'Waste register', icon: Recycle, permission: 'ehs.waste.read', entityScoped: true },
    ],
  },
  {
    id: 'make',
    label: 'Make',
    items: [
      { href: '/app/manufacturing', label: 'Work orders', icon: Factory, permission: 'manufacturing.work_order.read', entityScoped: true },
      { href: '/app/manufacturing/shop-floor', label: 'Shop floor', icon: Timer, permission: 'manufacturing.job_card.read', entityScoped: true },
      { href: '/app/manufacturing/schedule', label: 'Schedule', icon: GanttChart, permission: 'manufacturing.schedule.read', entityScoped: true },
      { href: '/app/manufacturing/smt', label: 'SMT line', icon: CircuitBoard, permission: 'manufacturing.smt.read', entityScoped: true },
      { href: '/app/manufacturing/job-work', label: 'Job work', icon: Truck, permission: 'manufacturing.job_work.read', entityScoped: true },
      { href: '/app/manufacturing/boms', label: 'Bills of materials', icon: ListTree, permission: 'manufacturing.bom.read', entityScoped: true },
      { href: '/app/manufacturing/genealogy', label: 'Genealogy', icon: GitBranch, permission: 'manufacturing.genealogy.read', entityScoped: true },
    ],
  },
  {
    id: 'quality',
    label: 'Quality',
    items: [
      { href: '/app/quality/inspections', label: 'Inspections', icon: ClipboardCheck, permission: 'quality.inspection.read', entityScoped: true },
      { href: '/app/quality/ncrs', label: 'NCR / MRB', icon: OctagonAlert, permission: 'quality.ncr.read', entityScoped: true },
      { href: '/app/quality/capas', label: 'CAPA', icon: SearchCheck, permission: 'quality.capa.read', entityScoped: true },
      { href: '/app/quality/fai', label: 'First article', icon: FileCheck2, permission: 'quality.fai.read', entityScoped: true },
      { href: '/app/quality/plans', label: 'Inspection plans', icon: ListChecks, permission: 'quality.plan.read', entityScoped: true },
      { href: '/app/quality/gauges', label: 'Gauges', icon: Gauge, permission: 'quality.gauge.read', entityScoped: true },
      { href: '/app/quality/skills', label: 'Skill matrix', icon: GraduationCap, permission: 'quality.skill.read', entityScoped: true },
    ],
  },
  {
    id: 'machines',
    label: 'Machines',
    items: [
      { href: '/app/machines', label: 'Machines', icon: Cpu, permission: 'plant.machine_state.read', entityScoped: true },
      { href: '/app/maintenance', label: 'Maintenance', icon: Wrench, permission: 'maintenance.order.read', entityScoped: true },
      { href: '/app/maintenance/plans', label: 'Maintenance plans', icon: ListChecks, permission: 'maintenance.plan.read', entityScoped: true },
      { href: '/app/maintenance/reports', label: 'Reliability and cost', icon: BarChart3, permission: 'maintenance.order.read', entityScoped: true },
      { href: '/app/manufacturing/work-centres', label: 'Work centres', icon: Cog, permission: 'manufacturing.work_centre.read', entityScoped: true },
      { href: '/app/manufacturing/calendars', label: 'Calendars', icon: CalendarClock, permission: 'manufacturing.calendar.read', entityScoped: true },
      { href: '/app/plant/devices', label: 'Devices', icon: Router, permission: 'plant.device.read', entityScoped: true },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    items: [
      { href: '/app/services/bookings', label: 'Machine bookings', icon: CalendarCheck2, permission: 'services.booking.read', entityScoped: true },
      { href: '/app/services/memberships', label: 'Memberships', icon: BadgePercent, permission: 'services.membership.read', entityScoped: true },
      { href: '/app/services/campaigns', label: 'Test campaigns', icon: FlaskConical, permission: 'services.campaign.read', entityScoped: true },
      { href: '/app/services/subscriptions', label: 'Subscriptions', icon: Satellite, permission: 'services.subscription.read', entityScoped: true },
      { href: '/app/services/billing-runs', label: 'Billing runs', icon: ReceiptText, permission: 'services.billing_run.read', entityScoped: true },
      { href: '/app/services/projects', label: 'Projects', icon: FolderKanban, permission: 'services.project.read', entityScoped: true },
      { href: '/app/services/timesheets', label: 'Timesheets', icon: Clock, permission: 'services.timesheet.read', entityScoped: true },
      { href: '/app/services/cost-rates', label: 'Cost rates', icon: Wallet, permission: 'services.cost_rate.read', entityScoped: true },
      { href: '/app/services/rate-cards', label: 'Rate cards', icon: IndianRupee, permission: 'services.rate_card.read', entityScoped: true },
    ],
  },
  {
    id: 'accounts',
    label: 'Accounts & GST',
    items: [
      { href: '/app/accounts/setup', label: 'Accounting setup', icon: Landmark, permission: 'accounts.setup.read', entityScoped: true },
      { href: '/app/accounts/chart', label: 'Chart of accounts', icon: ScrollText, permission: 'accounts.account.read', entityScoped: true },
      { href: '/app/accounts/tally', label: 'Tally import', icon: FileUp, permission: 'accounts.tally.read', entityScoped: true },
      { href: '/app/accounts/tally/history', label: 'Tally history', icon: History, permission: 'accounts.tally.read', entityScoped: true },
      { href: '/app/accounts/journals', label: 'Journals', icon: ReceiptText, permission: 'accounts.voucher.read', entityScoped: true },
      { href: '/app/accounts/settlements', label: 'Receipts & payments', icon: Banknote, permission: 'accounts.settlement.read', entityScoped: true },
      { href: '/app/accounts/outstanding', label: 'Outstanding', icon: Clock, permission: 'accounts.report.read', entityScoped: true },
      { href: '/app/accounts/bank-reconciliation', label: 'Bank reconciliation', icon: Banknote, permission: 'accounts.bank_reconciliation.read', entityScoped: true },
      { href: '/app/accounts/bank-charges', label: 'Bank charges', icon: Banknote, permission: 'accounts.bank_charge.read', entityScoped: true },
      { href: '/app/accounts/day-book', label: 'Day book', icon: FileSpreadsheet, permission: 'accounts.report.read', entityScoped: true },
      { href: '/app/accounts/ledger', label: 'Account ledger', icon: ScrollText, permission: 'accounts.report.read', entityScoped: true },
      { href: '/app/accounts/trial-balance', label: 'Trial balance', icon: FileSpreadsheet, permission: 'accounts.report.read', entityScoped: true },
      { href: '/app/compliance/gst-returns', label: 'GST returns', icon: FileSpreadsheet, permission: 'compliance.gst_return.read', entityScoped: true },
      { href: '/app/compliance/itc04', label: 'ITC-04', icon: FileSpreadsheet, permission: 'compliance.job_work_return.read', entityScoped: true },
      { href: '/app/compliance/sandbox', label: 'GST sandbox', icon: ReceiptText, permission: 'compliance.sandbox_operation.read', entityScoped: true },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { href: '/app/settings/entities', label: 'Entities & GST', icon: Building2, permission: 'settings.entity.read' },
      { href: '/app/settings/users', label: 'Users', icon: Users, permission: 'settings.user.read' },
      { href: '/app/settings/roles', label: 'Roles', icon: KeyRound, permission: 'settings.role.read' },
      { href: '/app/settings/number-series', label: 'Number series', icon: FileSpreadsheet, permission: 'settings.entity.read', entityScoped: true },
      { href: '/app/settings/connections', label: 'Connections', icon: Cable, permission: 'settings.integration.read', entityScoped: true },
      { href: '/app/settings/gst-integrations', label: 'GST sandbox connections', icon: ReceiptText, permission: 'compliance.sandbox_connection.read', entityScoped: true },
      { href: '/app/settings/supplier-returns', label: 'Supplier return policies', icon: ReceiptText, permission: 'buying.return_policy.read', entityScoped: true },
      { href: '/app/settings/support-access', label: 'Support access', icon: LifeBuoy, permission: 'settings.support_access.read' },
      { href: '/app/settings/audit', label: 'Audit log', icon: ScrollText, permission: 'settings.audit.read' },
      { href: '/app/settings/security', label: 'My security', icon: ShieldCheck },
    ],
  },
];

/** Every menu link, flat. */
export const ALL_ITEMS: NavItem[] = [HOME, APPROVALS, ...AREAS.flatMap((a) => a.items)];

/** The path part of a menu href. */
export const pathOf = (href: string) => href.split('?')[0]!;

/** The most specific menu path wins when pages nest (/app/manufacturing/boms under /app/manufacturing). */
const PATHS = ALL_ITEMS.map((i) => pathOf(i.href));

/** Is this menu item the page being shown? Parties links also match on the role filter. */
export function isActive(item: NavItem, pathname: string, role: string | null): boolean {
  const path = pathOf(item.href);
  if (path === '/app') return pathname === '/app';
  const wanted = item.href.split('?role=')[1];
  if (wanted) return pathname === path && role === wanted;
  if (!pathname.startsWith(path)) return false;
  return !PATHS.some((p) => p.length > path.length && p.startsWith(path) && pathname.startsWith(p));
}

/** The area that holds a page, so it can stay open. */
export function areaOf(pathname: string, role: string | null): AreaId | null {
  for (const a of AREAS) if (a.items.some((i) => isActive(i, pathname, role))) return a.id;
  return null;
}
