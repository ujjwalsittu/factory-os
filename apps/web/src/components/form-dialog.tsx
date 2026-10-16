'use client';
import { Alert, Button, Dialog } from '@factoryos/ui';
import { type FormEvent, type ReactNode, useId } from 'react';
import { ApiError } from '@/lib/api';

/** Dialog with a form, Save/Cancel footer, and a general error banner for non-field errors. */
export function FormDialog({
  title,
  description,
  onClose,
  onSubmit,
  pending,
  error,
  submitLabel = 'Save',
  wide,
  duplicate,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  error: unknown;
  submitLabel?: string;
  wide?: boolean;
  /** Offered when the save fails because the code is already used: selects the record that has it. */
  duplicate?: { label: string; onUse: () => void | Promise<void> };
  children: ReactNode;
}) {
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // A form opened from a field inside another form must not submit that outer form.
    e.stopPropagation();
    onSubmit();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      className={wide ? 'w-[min(860px,calc(100vw-2rem))]' : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={id} loading={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={submit} className="space-y-4">
        {error instanceof ApiError && !error.issues.length && (
          <Alert tone="danger">
            {error.message}
            {error.status === 409 && duplicate && (
              <Button type="button" variant="secondary" size="sm" className="ml-3" onClick={() => void duplicate.onUse()}>
                {duplicate.label}
              </Button>
            )}
          </Alert>
        )}
        {error instanceof Error && !(error instanceof ApiError) && <Alert tone="danger">{error.message}</Alert>}
        {children}
      </form>
    </Dialog>
  );
}

export const fieldErrors = (e: unknown): Record<string, string> => (e instanceof ApiError ? e.fieldErrors : {});
