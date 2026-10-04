import { cn } from '../cn';

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight text-fg', className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-accent" />
        <path d="M9 10h14v3H12.5v2.5H21v3h-8.5V23H9z" className="fill-accent-fg" />
        <circle cx="23" cy="21" r="2.5" className="fill-accent-fg" />
      </svg>
      {withText && <span className="text-[17px]">FactoryOS</span>}
    </span>
  );
}
