/**
 * Document number formatting. A series pattern uses tokens:
 *   {ENTITY} entity code, {FY} financial year like 26-27, {#####} zero-padded counter (width = #s).
 * Example: "{ENTITY}/GRN/{FY}/{#####}" → "AZ/GRN/26-27/00001".
 * GST tax-invoice numbers must be ≤ 16 characters and unique per FY (doc 05 §7); validated at series creation.
 */
export function formatSeries(pattern: string, ctx: { entityCode: string; fy: string; counter: number }): string {
  return pattern
    .replaceAll('{ENTITY}', ctx.entityCode)
    .replaceAll('{FY}', ctx.fy)
    .replace(/\{(#+)\}/, (_, h: string) => String(ctx.counter).padStart(h.length, '0'));
}

/** Indian FY label "26-27" for a date, with the FY starting in `startMonth` (1-12, default April). */
export function fyCode(date: Date, startMonth = 4): string {
  const y = date.getUTCMonth() + 1 >= startMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function isValidSeriesPattern(pattern: string): boolean {
  return /\{#{3,}\}/.test(pattern) && (pattern.match(/\{#+\}/g) ?? []).length === 1;
}
