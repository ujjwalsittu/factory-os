'use client';
import { cn, Logo } from '@factoryos/ui';
import { Building2, ChevronDown, LifeBuoy, LogOut, Menu, Search, ShieldCheck, Star, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { fyLabel, initials } from '@/lib/format';
import { CommandPalette } from './command-palette';
import { ALL_ITEMS, AREAS, areaOf, HOME, isActive, type NavItem } from './nav-data';
import { ThemeToggle } from './theme';
import { flushPendingPreferences, MAX_RECENT, usePreferences } from './use-preferences';
import { useWorkspace } from './workspace';

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
        <Suspense fallback={null}>
          <SideNav />
          <MenuTracker />
        </Suspense>
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
            <Suspense fallback={null}>
              <SideNav onNavigate={() => setMenuOpen(false)} />
            </Suspense>
          </div>
        </div>
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function visibleTo(ws: ReturnType<typeof useWorkspace>) {
  return (item: NavItem) => !item.permission || (item.entityScoped ? ws.can(item.permission) : ws.canTenant(item.permission));
}

/** Keeps "Recent" current and the area of the page being shown open. Renders nothing. */
function MenuTracker() {
  const pathname = usePathname();
  const role = useSearchParams().get('role');
  const { settled, visit, openArea } = usePreferences();
  const item = ALL_ITEMS.find((i) => isActive(i, pathname, role));
  const area = areaOf(pathname, role);
  useEffect(() => {
    if (!settled || !item) return;
    if (item.href !== HOME.href) visit(item.href);
    if (area) openArea(area);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, item?.href, area]);
  return null;
}

function NavLink({ item, active, starred, onStar, onNavigate }: { item: NavItem; active: boolean; starred?: boolean; onStar?: (href: string) => void; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <div className="group relative">
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors md:h-8',
          onStar && 'pr-9',
          active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
      {onStar && (
        <button
          type="button"
          aria-label={starred ? `Remove ${item.label} from favourites` : `Add ${item.label} to favourites`}
          aria-pressed={!!starred}
          onClick={() => onStar(item.href)}
          className={cn(
            'absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle hover:bg-surface hover:text-fg focus-visible:opacity-100',
            starred ? 'text-warning opacity-100' : 'md:opacity-0 md:group-hover:opacity-100',
          )}
        >
          <Star className={cn('size-3.5', starred && 'fill-current')} />
        </button>
      )}
    </div>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const role = useSearchParams().get('role');
  const { prefs, toggleFavourite, toggleArea } = usePreferences();
  const visible = visibleTo(ws);
  const byHref = new Map(ALL_ITEMS.map((i) => [i.href, i]));
  // Stored links the person can no longer open (permission removed) stay stored but are not shown.
  const pick = (hrefs: string[]) => hrefs.map((h) => byHref.get(h)).filter((i): i is NavItem => !!i && visible(i));
  const active = (i: NavItem) => isActive(i, pathname, role);
  const favourites = pick(prefs.favourites);
  const recent = pick(prefs.recent).filter((i) => !active(i)).slice(0, MAX_RECENT);
  return (
    <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Main">
      <div className="mt-3">
        <NavLink item={HOME} active={active(HOME)} onNavigate={onNavigate} />
      </div>
      {favourites.length > 0 && (
        <div className="mt-3" aria-label="Favourites">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">Favourites</p>
          {favourites.map((i) => (
            <NavLink key={i.href} item={i} active={active(i)} starred onStar={toggleFavourite} onNavigate={onNavigate} />
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="mt-3" aria-label="Recent">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">Recent</p>
          {recent.map((i) => (
            <NavLink key={i.href} item={i} active={false} starred={prefs.favourites.includes(i.href)} onStar={toggleFavourite} onNavigate={onNavigate} />
          ))}
        </div>
      )}
      {AREAS.map((area) => {
        const items = area.items.filter(visible);
        if (!items.length) return null;
        const open = !prefs.collapsed.includes(area.id);
        return (
          <div key={area.id} className="mt-3" data-area={area.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggleArea(area.id)}
              className="flex h-9 w-full items-center gap-1 rounded-lg px-3 text-left text-[11px] font-semibold tracking-wider text-subtle uppercase hover:bg-surface-2 hover:text-fg md:h-7"
            >
              {area.label}
              <ChevronDown className={cn('ml-auto size-3.5 transition-transform', !open && '-rotate-90')} />
            </button>
            {open &&
              items.map((i) => (
                <NavLink key={i.href} item={i} active={active(i)} starred={prefs.favourites.includes(i.href)} onStar={toggleFavourite} onNavigate={onNavigate} />
              ))}
          </div>
        );
      })}
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
    await flushPendingPreferences();
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
          {(ws.me.platformAdmin === 'superadmin' || ws.me.platformAdmin === 'support') && (
            <Link href="/support" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] hover:bg-surface-2">
              <LifeBuoy className="size-4 text-muted" /> Support inbox
            </Link>
          )}
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
