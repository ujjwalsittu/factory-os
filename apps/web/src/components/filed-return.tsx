'use client';
import { Field, Input } from '@factoryos/ui';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { FormDialog } from './form-dialog';

/** What a document action sends once the person confirms a change in a month whose GST return is filed. */
export interface FiledReturnConfirmation {
  confirmFiledReturn?: true;
  filedReturnReason?: string;
}

type Ask = (message: string, reason: string) => Promise<string | null>;
const Ctx = createContext<Ask | null>(null);

/**
 * Decision 074: a document dated in a filed month changes only after a warning. The API refuses with 409
 * `gst_return_filed`; this asks for confirmation and a reason, then repeats the call with them.
 */
export function FiledReturnProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ message: string; reason: string } | null>(null);
  const settle = useRef<((reason: string | null) => void) | null>(null);
  const ask = useCallback<Ask>(
    (message, reason) =>
      new Promise((resolve) => {
        settle.current = resolve;
        setOpen({ message, reason });
      }),
    [],
  );
  const done = (reason: string | null) => {
    settle.current?.(reason);
    settle.current = null;
    setOpen(null);
  };
  return (
    <Ctx.Provider value={ask}>
      {children}
      {open && (
        <FormDialog
          title="This month's GST return is filed"
          description={open.message}
          onClose={() => done(null)}
          onSubmit={() => done(open.reason.trim())}
          pending={false}
          error={null}
          submitLabel="Change anyway"
          submitDisabled={open.reason.trim().length < 5}
        >
          <Field label="Reason for changing a filed month" hint="Recorded in the audit trail. Correct it in a later return or an amendment.">
            {(f) => <Input {...f} value={open.reason} onChange={(e) => setOpen({ ...open, reason: e.target.value })} autoFocus required minLength={5} />}
          </Field>
        </FormDialog>
      )}
    </Ctx.Provider>
  );
}

/**
 * Wraps a document action: `call` runs with no extra fields first, and again with the confirmation when the API
 * says the month is filed and the person agrees. Declining rethrows the API's refusal.
 */
export function useFiledReturnGuard() {
  const ask = useContext(Ctx);
  return useCallback(
    async <T,>(call: (extra: FiledReturnConfirmation) => Promise<T>, reason = ''): Promise<T> => {
      try {
        return await call({});
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409 || e.code !== 'gst_return_filed' || !ask) throw e;
        const given = await ask(e.message, reason);
        if (given === null) throw e;
        return call({ confirmFiledReturn: true, filedReturnReason: given });
      }
    },
    [ask],
  );
}
