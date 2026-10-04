import type { ReactNode } from 'react';
import { cn } from '../cn';

const tones = {
  info: 'border-info/30 bg-info-soft text-info',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
} as const;

export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof tones; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-lg border px-4 py-3 text-[13px]', tones[tone], className)}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5', 'text-fg/80')}>{children}</div>}
    </div>
  );
}
