'use client';
import { cn, Logo } from '@factoryos/ui';
import {
  ArrowLeftRight,
  Boxes,
  Contact,
  Handshake,
  Package,
  Ruler,
  Warehouse,
  Building2,
  ChevronDown,
  ClipboardCheck,
  Cpu,
  Factory,
  FileSpreadsheet,
  Home,
  KeyRound,
  Landmark,
  LogOut,
  Menu,
  type LucideIcon,
  Recycle,
  ScrollText,
  Search,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wrench,
  X,
  ReceiptText,
  ScanSearch,
  Banknote,
  Clock,
  Ship,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { fyLabel, initials } from '@/lib/format';
import { CommandPalette } from './command-palette';
import { ThemeToggle } from './theme';
import { useWorkspace } from './workspace';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown disabled with the phase it arrives in (docs/09). */
  phase?: number;
  permission?: string;
  /** Permission is evaluated for the active entity (inventory, masters) rather than tenant-wide. */
  entityScoped?: boolean;
}

export const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ href: '/app', label: 'Home', icon: Home }] },
  {
    section: 'Operations',
    items: [
      { href: '/app/manufacturing', label: 'Manufacturing', icon: Factory, phase: 2 },
      { href: '/app/quality', label: 'Quality', icon: ClipboardCheck, phase: 2 },
      { href: '/app/services', label: 'Services', icon: Wrench, phase: 3 },
    ],
  },
  {
    section: 'Sales',
    items: [
      { href: '/app/selling/quotations', label: 'Quotations', icon: FileSpreadsheet, permission: 'selling.quotation.read', entityScoped: true },
      { href: '/app/selling/orders', label: 'Sales orders', icon: Truck, permission: 'selling.sales_order.read', entityScoped: true },
      { href: '/app/selling/notes', label: 'Credit/debit notes', icon: ReceiptText, permission: 'selling.sales_note.read', entityScoped: true },
      { href: '/app/selling/invoices', label: 'Sales invoices', icon: ReceiptText, permission: 'selling.sales_invoice.read', entityScoped: true },
    ],
  },
  {
    section: 'Buying',
    items: [
      { href: '/app/buying/orders', label: 'Purchase orders', icon: ShoppingCart, permission: 'buying.purchase_order.read', entityScoped: true },
      { href: '/app/buying/inspections', label: 'Incoming inspection', icon: ScanSearch, permission: 'quality.inspection.read', entityScoped: true },
      { href: '/app/buying/invoices', label: 'Purchase invoices', icon: ReceiptText, permission: 'buying.purchase_invoice.read', entityScoped: true },
      { href: '/app/buying/landed-costs', label: 'Landed cost', icon: Ship, permission: 'buying.landed_cost.read', entityScoped: true },
    ],
  },
  {
    section: 'Inventory',
    items: [
      { href: '/app/inventory/entries', label: 'Stock entries', icon: ArrowLeftRight, permission: 'inventory.stock_entry.read', entityScoped: true },
      { href: '/app/inventory/balance', label: 'Stock balance', icon: Boxes, permission: 'inventory.report.read', entityScoped: true },
      { href: '/app/inventory/customer-material', label: 'Customer material', icon: Handshake, permission: 'inventory.report.read', entityScoped: true },
      { href: '/app/inventory/warehouses', label: 'Warehouses', icon: Warehouse, permission: 'inventory.warehouse.read', entityScoped: true },
    ],
  },
  {
    section: 'Masters',
    items: [
      { href: '/app/masters/items', label: 'Items', icon: Package, permission: 'masters.item.read', entityScoped: true },
      { href: '/app/masters/parties', label: 'Customers & suppliers', icon: Contact, permission: 'masters.party.read', entityScoped: true },
      { href: '/app/masters/units', label: 'Units & HSN/SAC', icon: Ruler, permission: 'masters.uom.read', entityScoped: true },
    ],
  },
  {
    section: 'Finance',
    items: [
      { href: '/app/accounts/setup', label: 'Accounting setup', icon: Landmark, permission: 'accounts.setup.read', entityScoped: true },
      { href: '/app/accounts/chart', label: 'Chart of accounts', icon: ScrollText, permission: 'accounts.account.read', entityScoped: true },
      { href: '/app/accounts/journals', label: 'Journals', icon: ReceiptText, permission: 'accounts.voucher.read', entityScoped: true },
      { href: '/app/accounts/settlements', label: 'Receipts & payments', icon: Banknote, permission: 'accounts.settlement.read', entityScoped: true },
      { href: '/app/accounts/outstanding', label: 'Outstanding', icon: Clock, permission: 'accounts.report.read', entityScoped: true },
      { href: '/app/accounts/day-book', label: 'Day book', icon: FileSpreadsheet, permission: 'accounts.report.read', entityScoped: true },
      { href: '/app/accounts/trial-balance', label: 'Trial balance', icon: FileSpreadsheet, permission: 'accounts.report.read', entityScoped: true },
      { href: '/app/compliance', label: 'Compliance', icon: FileSpreadsheet, phase: 1 },
    ],
  },
  {
    section: 'Plant',
    items: [
      { href: '/app/machines', label: 'Machines', icon: Cpu, phase: 5 },
      { href: '/app/ehs/waste', label: 'Waste register', icon: Recycle, permission: 'ehs.waste.read', entityScoped: true },
    ],
  },
  {
    section: 'Settings',
    items: [
      { href: '/app/settings/entities', label: 'Entities & GST', icon: Building2, permission: 'settings.entity.read' },
      { href: '/app/settings/number-series', label: 'Number series', icon: FileSpreadsheet, permission: 'settings.entity.read', entityScoped: true },
      { href: '/app/settings/users', label: 'Users', icon: Users, permission: 'settings.user.read' },
      { href: '/app/settings/roles', label: 'Roles', icon: KeyRound, permission: 'settings.role.read' },
      { href: '/app/settings/audit', label: 'Audit log', icon: ScrollText, permission: 'settings.audit.read' },
      { href: '/app/settings/security', label: 'My security', icon: ShieldCheck },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 print:!hidden shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-14 items-center px-4">
          <Link href="/app" aria-label="FactoryOS home">
            <Logo />
          </Link>
        </div>
        <SideNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 print:hidden items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur md:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <EntitySwitcher />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-2 hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 text-[13px] text-subtle hover:border-line-strong sm:flex"
          >
            <Search className="size-4" />
            Search or jump to…
            <kbd className="ml-auto rounded border border-line bg-surface px-1.5 font-mono text-[11px]">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden text-[12px] text-muted lg:inline">{fyLabel()}</span>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-2xl">
            <div className="flex h-14 items-center justify-between px-4">
              <Logo />
              <button type="button" onClick={() => setMenuOpen(false)} className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <SideNav onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  return (
    <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Main">
          {NAV.map((group, i) => (
            <div key={i} className="mt-3">
              {group.section && <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">{group.section}</p>}
              {group.items
                .filter((item) => !item.permission || (item.entityScoped ? ws.can(item.permission) : ws.canTenant(item.permission)))
                .map((item) => {
                  const active = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  if (item.phase) {
                    return (
                      <span
                        key={item.href}
                        title={`Arrives in Phase ${item.phase}`}
                        className="flex h-8 cursor-not-allowed items-center gap-2.5 rounded-lg px-3 text-[13px] text-subtle"
                      >
                        <Icon className="size-4" />
                        {item.label}
                        <span className="ml-auto rounded bg-surface-2 px-1.5 text-[10px] font-medium">P{item.phase}</span>
                      </span>
                    );
                  }
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
                        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                      )}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </Link>
                  );
                })}
            </div>
          ))}
          {ws.me.platformAdmin === 'superadmin' && (
            <div className="mt-3 border-t border-line pt-3">
              <Link href="/platform" onClick={onNavigate} className="flex h-8 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
                <ShieldCheck className="size-4" /> Platform console
              </Link>
            </div>
          )}
    </nav>
  );
}

function EntitySwitcher() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, () => setOpen(false));
  const entities = ws.tenantCtx.entities;
  const active = entities.find((e) => e.id === ws.entityId);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
      >
        <Building2 className="size-4 text-muted" />
        <span className="max-w-48 truncate">{active ? active.shortName : 'All entities'}</span>
        <span className="hidden text-subtle sm:inline">· {ws.tenantName}</span>
        <ChevronDown className="size-3.5 text-subtle" />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-11 z-30 w-72 rounded-xl border border-line bg-surface p-1 shadow-xl">
          {ws.me.tenants.length > 1 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">Tenant</p>
              {ws.me.tenants.map((t) => (
                <Option key={t.id} selected={t.id === ws.tenantId} onClick={() => (ws.setTenantId(t.id), setOpen(false))}>
                  {t.name}
                </Option>
              ))}
              <div className="my-1 border-t border-line" />
            </>
          )}
          <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">Legal entity</p>
          {ws.tenantCtx.allEntities && (
            <Option selected={!ws.entityId} onClick={() => (ws.setEntityId(null), setOpen(false))}>
              All entities
            </Option>
          )}
          {entities.map((e) => (
            <Option key={e.id} selected={e.id === ws.entityId} onClick={() => (ws.setEntityId(e.id), setOpen(false))}>
              <span className="truncate">{e.shortName}</span>
              <span className="ml-auto font-mono text-[11px] text-subtle">{e.code}</span>
            </Option>
          ))}
          {entities.length === 0 && <p className="px-3 py-2 text-[13px] text-muted">No entities yet</p>}
        </div>
      )}
    </div>
  );
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2', selected && 'bg-accent-soft text-accent')}
    >
      {children}
    </button>
  );
}

function UserMenu() {
  const ws = useWorkspace();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, () => setOpen(false));
  const signOut = async () => {
    await authClient.signOut();
    router.replace('/sign-in');
  };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent"
      >
        {initials(ws.me.user.name)}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-64 rounded-xl border border-line bg-surface p-1 shadow-xl">
          <div className="px-3 py-2">
            <p className="truncate text-[13px] font-medium">{ws.me.user.name}</p>
            <p className="truncate text-[12px] text-muted">{ws.me.user.email}</p>
          </div>
          <div className="my-1 border-t border-line" />
          <Link href="/app/settings/security" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] hover:bg-surface-2">
            <ShieldCheck className="size-4 text-muted" /> Security & two-factor
          </Link>
          <button type="button" onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-surface-2">
            <LogOut className="size-4 text-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function useOutsideClick(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onOutside();
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [ref, onOutside]);
}
