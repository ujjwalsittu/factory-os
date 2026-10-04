'use client';
import { Card, CardHeader } from '@factoryos/ui';
import { errorText } from '@/lib/buying';
import { formatAmount } from '@/lib/format';
import type { TaxPreview } from '@/lib/types';

const KIND_LABEL: Record<TaxPreview['kind'], string> = {
  intra: 'Intra-state: CGST + SGST',
  inter: 'Inter-state: IGST',
  zero_rated: 'Zero-rated',
  customs: 'Import: IGST paid at customs',
};

type Amounts = { taxableValue: string | null; igst?: string | null; cgst?: string | null; sgst?: string | null; cess?: string | null; totalTax: string | null; grandTotal: string | null; reverseCharge?: boolean };

/** Totals panel. Draft documents show the server's live preview; posted ones show what was stored. */
export function TaxSummary({ preview, fixed, loading, error, currency = 'INR' }: { preview?: TaxPreview; fixed?: Amounts; loading?: boolean; error?: unknown; currency?: string }) {
  const a: Amounts | undefined = preview ? { ...preview, grandTotal: preview.invoiceTotal } : fixed;
  const row = (label: string, v: string | null | undefined, strong = false, always = false) =>
    v != null && (strong || always || Number(v) !== 0) ? (
      <div className={`flex justify-between py-1 text-[13px] ${strong ? 'border-t border-line pt-2 text-[15px] font-semibold' : ''}`}>
        <span className={strong ? '' : 'text-muted'}>{label}</span>
        <span className="tabular">{formatAmount(v, currency)}</span>
      </div>
    ) : null;
  return (
    <Card className="self-start" aria-live="polite">
      <CardHeader title="Totals" description={preview ? KIND_LABEL[preview.kind] : loading ? 'Calculating…' : fixed ? undefined : 'Choose a supplier and enter lines'} />
      <div className={`px-5 py-3 ${loading ? 'opacity-60' : ''}`}>
        {error ? <p className="text-[13px] text-danger">{errorText(error)}</p> : null}
        {a ? (
          <>
            {row('Taxable value', a.taxableValue ?? '0', false, true)}
            {row('CGST', a.cgst)}
            {row('SGST', a.sgst)}
            {row('IGST', a.igst)}
            {row('Cess', a.cess)}
            {fixed && !preview && row('Total tax', a.totalTax)}
            {row(a.reverseCharge ? 'Payable to supplier' : 'Total', a.grandTotal, true)}
            {a.reverseCharge && <p className="mt-2 text-[12px] text-warning">Reverse charge: the tax above is paid by us to the government, not to the supplier.</p>}
            {preview?.notes.map((n) => (
              <p key={n} className="mt-2 text-[12px] text-muted">
                {n}
              </p>
            ))}
          </>
        ) : (
          !error && <p className="text-[13px] text-subtle">—</p>
        )}
      </div>
    </Card>
  );
}
