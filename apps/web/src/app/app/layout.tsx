'use client';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { FullPageLoading } from '@/components/loading';
import { WorkspaceProvider } from '@/components/workspace';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider fallback={<FullPageLoading />}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
