'use client';
import { Field, Input, Select } from '@factoryos/ui';

export type EwayBillReason = '' | 'job_worker_generates' | 'exempt';

/**
 * Rule 138 (decision 067): interstate job work needs an e-way bill at any value. Enter its number, or say why there is
 * none here: the registered job worker generates it, or the movement is exempt. Intrastate challans need neither.
 */
export function EwayBillFields({ no, reason, onNo, onReason, errors }: { no: string; reason: EwayBillReason; onNo: (v: string) => void; onReason: (v: EwayBillReason) => void; errors: Record<string, string | undefined> }) {
  return (
    <>
      <Field label="E-way bill no." error={errors.ewayBillNo} hint="12 digits; needed for interstate job work">
        {(f) => <Input {...f} inputMode="numeric" value={no} onChange={(e) => onNo(e.target.value)} />}
      </Field>
      <Field label="No number because" error={errors.ewayBillReason} hint="Interstate only">
        {(f) => (
          <Select {...f} value={reason} onChange={(e) => onReason(e.target.value as EwayBillReason)} disabled={!!no.trim()}>
            <option value="">—</option>
            <option value="job_worker_generates">The job worker generates it</option>
            <option value="exempt">Exempt movement (rule 138(14))</option>
          </Select>
        )}
      </Field>
    </>
  );
}
