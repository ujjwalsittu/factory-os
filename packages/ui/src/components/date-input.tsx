'use client';
import { type InputHTMLAttributes, useEffect, useRef, useState } from 'react';
import { cn } from '../cn';
import { control } from './field';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-13" → "13-10-2026"; anything else → "". */
export const formatDateIndian = (iso: string) => (ISO.test(iso) ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');

/**
 * A typed date to ISO: DD-MM-YYYY (also with / or .) as people in India write it, or YYYY-MM-DD when pasted. Returns ''
 * for an empty field and null for text that is not a real calendar date.
 */
export function parseDateIndian(text: string): string | null {
  const t = text.trim();
  if (!t) return '';
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return null;
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  return at.toISOString().slice(0, 10);
}

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
        value={ISO.test(value) ? value : ''}
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
