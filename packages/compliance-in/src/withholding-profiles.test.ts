import { describe, expect, it } from 'vitest';
import { profileTemplates, taxFormLabels, verifiedProfileCatalog } from './withholding-profiles.js';

describe('withholding statutory evidence gate', () => {
  it('profile_catalog_requires_primary_evidence', () => {
    const catalog = verifiedProfileCatalog();
    expect(catalog.every(p => p.sourceDigest && p.boundaryVectors.length > 0)).toBe(true);
    for (const p of catalog) {
      expect(p.status).toBe('verified');
      expect(p.tableItem).toBeTruthy();
      expect(p.verifiedPredicates).toEqual(expect.arrayContaining([
        'applicability', 'rate', 'threshold', 'gstBase', 'timing', 'certificate', 'precedence',
      ]));
    }
    const drafts = profileTemplates().filter(p => p.status === 'draft');
    expect(drafts.length).toBeGreaterThan(0);
    expect(catalog.map(p => p.id)).not.toEqual(expect.arrayContaining(drafts.map(p => p.id)));
    expect(drafts.every(p => p.blockedReason.length > 0)).toBe(true);
  });
  it('historical_and_current_forms_are_distinct', () => {
    expect(taxFormLabels('2026-03-31')).toEqual({ act: '1961', resident: '26Q', nonresident: '27Q', tcs: '27EQ', certificate: '16A' });
    expect(taxFormLabels('2026-04-01')).toEqual({ act: '2025', resident: '140', nonresident: '144', tcs: '143', certificate: '131' });
    expect(taxFormLabels('2026-10-06')).toMatchObject({ act: '2025', nonresident: '144' });
  });
  it('invalid_event_dates_cannot_select_a_statutory_year', () => {
    for (const date of ['2026-02-30', '2026-13-01', 'bad', '2026-4-1']) {
      expect(() => taxFormLabels(date)).toThrow('date');
    }
  });
});
