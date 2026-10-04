import { Logo } from '@factoryos/ui';

export function FullPageLoading({ label = 'Loading your workspace…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4" role="status" aria-live="polite">
      <Logo withText={false} className="animate-pulse" />
      <p className="text-[13px] text-muted">{label}</p>
    </div>
  );
}
