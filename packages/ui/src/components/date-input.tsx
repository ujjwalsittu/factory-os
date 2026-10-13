'use client';
import { type InputHTMLAttributes, useEffect, useRef, useState } from 'react';
import { cn } from '../cn';
import { formatDateIndian, ISO_DATE, parseDateIndian } from '../date';
import { control } from './field';

export { formatDateIndian, parseDateIndian };

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  /** ISO date (YYYY-MM-DD) or ''. */
  value: string;
  /** Called with the ISO date (or '' when cleared), shaped like an input change so it drops in for `type="date"`. */
  onChange?: (e: { target: { value: string } }) => void;
  min?: string;
  max?: string;
};

/**
 * Date field shown and typed as DD-MM-YYYY, stored as ISO, with a calendar button. Replaces native date inputs, which
 * show the browser's own format (often mm/dd/yyyy).
 */
export function DateInput({ value, onChange, min, max, className, disabled, onBlur, ...rest }: Props) {
  const [text, setText] = useState(formatDateIndian(value));
  const last = useRef(value);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(formatDateIndian(value));
    }
  }, [value]);
  const emit = (iso: string) => {
    last.current = iso;
    onChange?.({ target: { value: iso } });
  };
  return (
    <div className="relative">
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={rest.placeholder ?? 'DD-MM-YYYY'}
        disabled={disabled}
        value={text}
        className={cn(control, 'pr-9 tabular-nums', className)}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const iso = parseDateIndian(t);
          const outside = iso && ((min && iso < min) || (max && iso > max));
          e.target.setCustomValidity(iso === null ? 'Enter a date as DD-MM-YYYY' : outside ? `Choose a date ${min && iso! < min ? `from ${formatDateIndian(min)}` : `up to ${formatDateIndian(max!)}`}` : '');
          if (iso !== null && iso !== last.current) emit(iso);
        }}
        onBlur={(e) => {
          const iso = parseDateIndian(text);
          if (iso) setText(formatDateIndian(iso));
          onBlur?.(e);
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        disabled={disabled}
        className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        onClick={() => {
          const p = picker.current;
          if (!p) return;
          try {
            p.showPicker();
          } catch {
            p.focus();
          }
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0"
        value={ISO_DATE.test(value) ? value : ''}
        min={min}
        max={max}
        onChange={(e) => {
          setText(formatDateIndian(e.target.value));
          emit(e.target.value);
        }}
      />
    </div>
  );
}
