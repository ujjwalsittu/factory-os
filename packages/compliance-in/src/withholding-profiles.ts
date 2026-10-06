/** Primary-source verification is a release gate, not a Finance checkbox. */
export type LegalPredicate = 'applicability' | 'rate' | 'threshold' | 'gstBase' | 'timing' | 'certificate' | 'precedence';
export interface VerifiedProfileDefinition {
  readonly id: string;
  readonly status: 'verified';
  readonly act: '1961' | '2025';
  readonly section: string;
  readonly tableItem: string;
  readonly legacyAlias: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly sourceUrl: string;
  readonly sourceDigest: string;
  readonly paragraph: string;
  readonly verifiedPredicates: readonly LegalPredicate[];
  readonly boundaryVectors: readonly { name: string; input: Readonly<Record<string, string>>; expectedTax: string }[];
}
export interface DraftProfileTemplate {
  readonly id: string;
  readonly status: 'draft';
  readonly section: '393' | '394';
  readonly legacyAlias: string;
  readonly effectiveFrom: '2026-04-01';
  readonly blockedReason: string;
}
const DRAFTS: readonly DraftProfileTemplate[] = Object.freeze(
  ['194C', '194J', '194I', '194H', '194Q', '195', '206C(1)-scrap'].map(alias => Object.freeze({
    id: `2025-${alias}`, status: 'draft' as const, section: alias.startsWith('206C') ? '394' as const : '393' as const,
    legacyAlias: alias, effectiveFrom: '2026-04-01' as const,
    blockedReason: 'Individual primary provision, amendments, applicability, base, rate, threshold, certificate and precedence vectors are not yet fully verified.',
  })),
);
/** No partially verified legal template is a calculable statutory default. */
export function profileTemplates(): readonly DraftProfileTemplate[] { return DRAFTS; }
export function verifiedProfileCatalog(): readonly VerifiedProfileDefinition[] { return Object.freeze([]); }

export interface TaxFormLabels {
  readonly act: '1961' | '2025';
  readonly resident: '26Q' | '140';
  readonly nonresident: '27Q' | '144';
  readonly tcs: '27EQ' | '143';
  readonly certificate: '16A' | '131';
}
/** Select by the original earlier-event date; correction date must not relabel history. */
export function taxFormLabels(eventDate: string): TaxFormLabels {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new Error('Invalid tax event date');
  const parsed = new Date(`${eventDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== eventDate) throw new Error('Invalid tax event date');
  return eventDate < '2026-04-01'
    ? { act: '1961', resident: '26Q', nonresident: '27Q', tcs: '27EQ', certificate: '16A' }
    : { act: '2025', resident: '140', nonresident: '144', tcs: '143', certificate: '131' };
}
