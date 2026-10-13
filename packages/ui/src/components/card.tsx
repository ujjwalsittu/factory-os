import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 rounded-xl border border-line bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0 flex-1 basis-60">
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Title, one plain-words description, and the page's actions at the right (under the title on phones). */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-3xl flex-1 basis-64">
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * One empty state in two sizes: `full` for an empty page or card, `compact` for one line inside an empty table or list.
 */
export function EmptyState({ icon, title, description, action, size = 'full' }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; size?: 'full' | 'compact' }) {
  if (size === 'compact')
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 text-[13px]">
        {icon && <span className="text-subtle [&>svg]:size-4">{icon}</span>}
        <span className="text-muted">
          <span className="font-medium text-fg">{title}</span>
          {description && <span> · {description}</span>}
        </span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
    );
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-xl bg-accent-soft p-3 text-accent">{icon}</div>}
      <p className="font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
