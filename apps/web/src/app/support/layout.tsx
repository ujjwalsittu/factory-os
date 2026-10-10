'use client';
// Support console (decision 050): a separate shell for platform operators. It never mounts the ordinary workspace, so
// tenant/entity selection and caches of the operator's own tenants are left untouched.
import { Badge, buttonClass, Logo } from '@factoryos/ui';
import { ArrowLeft, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme';
import { useMe } from '@/components/workspace';

export default function SupportLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4 md:px-8">
        <Link href="/support" aria-label="Support inbox">
          <Logo />
        </Link>
        <Badge tone="info">
          <LifeBuoy className="size-3" /> Support
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          {me.data && me.data.tenants.length > 0 && (
            <Link href="/app" className={buttonClass('ghost', 'sm')}>
              <ArrowLeft className="size-3.5" /> Back to app
            </Link>
          )}
          {me.data?.platformAdmin === 'superadmin' && (
            <Link href="/platform" className={buttonClass('ghost', 'sm')}>
              Platform
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}
