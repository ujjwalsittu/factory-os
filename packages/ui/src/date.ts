export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-13" → "13-10-2026"; anything else → "". */
export const formatDateIndian = (iso: string) => (ISO_DATE.test(iso) ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');

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
